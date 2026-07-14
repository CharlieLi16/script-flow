import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assignSides,
  cleanupImageAssets,
  createCaptionId,
  createNodeId,
  getImagesDir,
  mutateTimeline,
  nodeImageAssetUrls,
  readTimeline,
  saveImageBuffer,
  sliceFlipbookSheet,
  timelineReferencedImageUrls,
  writeTimeline,
} from './store.js';
import {
  copyImageToRefs,
  getRefsDir,
  loadImageFromUrl,
  loadReferences,
  readLibrary,
  saveRefBuffer,
  writeLibrary,
} from './library.js';
import {
  createPromptId,
  fillPromptTemplate,
  getPromptById,
  getPromptByRole,
  PROMPT_IDS,
  readPromptLibrary,
  writePromptLibrary,
} from './prompt-library.js';
import {
  createGeneratedImageAsset,
  deleteGeneratedAsset,
  generatedAssetsReferencedUrls,
  generatedAssetUrls,
  initializeGeneratedAssets,
  mutateGeneratedAssets,
  readGeneratedAssets,
  upsertGeneratedAsset,
} from './generated-assets.js';
import { getProvider, listProviders } from './providers/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3847;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/images', express.static(getImagesDir()));
app.use('/refs', express.static(getRefsDir()));

function findNode(timeline, id) {
  return timeline.nodes.find((n) => n.id === id);
}

function migrateLegacyCaptions(timeline) {
  if (Array.isArray(timeline.captions)) return false;
  timeline.captions = [];
  let cursor = 0;
  for (const node of timeline.nodes || []) {
    if (node.includeInPreview === false) continue;
    const durationMs = Math.max(500, Number(node.durationMs) || 2000);
    const text = String(node.subtitle || '').trim();
    if (text) {
      timeline.captions.push({
        id: createCaptionId(),
        text,
        startMs: cursor,
        endMs: cursor + durationMs,
        anchorNodeId: node.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    cursor += durationMs;
  }
  return true;
}

function normalizeCaption(input, current = null) {
  const text = input.text === undefined ? current?.text || '' : String(input.text).trim();
  const rawStart = input.startMs === undefined ? current?.startMs || 0 : Number(input.startMs);
  const startMs = Math.min(86400000, Math.max(0, Number.isFinite(rawStart) ? rawStart : 0));
  const rawEnd =
    input.endMs === undefined ? current?.endMs || startMs + 2000 : Number(input.endMs);
  const endMs = Math.min(
    86400000,
    Math.max(startMs + 100, Number.isFinite(rawEnd) ? rawEnd : startMs + 2000),
  );
  return {
    text,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    anchorNodeId:
      input.anchorNodeId === undefined
        ? current?.anchorNodeId || null
        : input.anchorNodeId
          ? String(input.anchorNodeId)
          : null,
  };
}

app.get('/api/timeline', async (_req, res, next) => {
  try {
    const timeline = await readTimeline();
    const normalized = assignSides(timeline.nodes);
    const captionsChanged = migrateLegacyCaptions(timeline);
    const changed =
      JSON.stringify(normalized) !== JSON.stringify(timeline.nodes) || captionsChanged;
    timeline.nodes = normalized;
    if (changed) {
      await writeTimeline(timeline);
    }
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

app.put('/api/timeline', async (req, res, next) => {
  try {
    const { title, nodes, captions } = req.body;
    const timeline = await readTimeline();
    if (title !== undefined) timeline.title = title;
    if (nodes !== undefined) timeline.nodes = assignSides(nodes);
    if (Array.isArray(captions)) {
      timeline.captions = captions
        .map((caption) => ({ ...caption, ...normalizeCaption(caption, caption) }))
        .filter((caption) => caption.text)
        .sort((a, b) => a.startMs - b.startMs);
    }
    await writeTimeline(timeline);
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

app.post('/api/captions', async (req, res, next) => {
  try {
    const normalized = normalizeCaption(req.body || {});
    if (!normalized.text) return res.status(400).json({ error: '字幕内容不能为空' });
    const caption = await mutateTimeline((timeline) => {
      if (!Array.isArray(timeline.captions)) migrateLegacyCaptions(timeline);
      const now = new Date().toISOString();
      const created = {
        id: createCaptionId(),
        ...normalized,
        createdAt: now,
        updatedAt: now,
      };
      timeline.captions.push(created);
      timeline.captions.sort((a, b) => a.startMs - b.startMs);
      return structuredClone(created);
    });
    res.status(201).json(caption);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/captions/:id', async (req, res, next) => {
  try {
    const caption = await mutateTimeline((timeline) => {
      if (!Array.isArray(timeline.captions)) migrateLegacyCaptions(timeline);
      const current = timeline.captions.find((entry) => entry.id === req.params.id);
      if (!current) return null;
      const normalized = normalizeCaption(req.body || {}, current);
      if (!normalized.text) return { error: '字幕内容不能为空' };
      Object.assign(current, normalized, { updatedAt: new Date().toISOString() });
      timeline.captions.sort((a, b) => a.startMs - b.startMs);
      return structuredClone(current);
    });
    if (!caption) return res.status(404).json({ error: '字幕不存在' });
    if (caption.error) return res.status(400).json(caption);
    res.json(caption);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/captions/:id', async (req, res, next) => {
  try {
    const removed = await mutateTimeline((timeline) => {
      if (!Array.isArray(timeline.captions)) migrateLegacyCaptions(timeline);
      const index = timeline.captions.findIndex((entry) => entry.id === req.params.id);
      if (index < 0) return null;
      return structuredClone(timeline.captions.splice(index, 1)[0]);
    });
    if (!removed) return res.status(404).json({ error: '字幕不存在' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/nodes', async (req, res, next) => {
  try {
    const timeline = await readTimeline();
    const node = {
      id: createNodeId(),
      title: req.body.title || '新节点',
      timeLabel: '',
      script: req.body.script || '',
      imageUrl: '',
      imagePrompt: '',
      referenceUrls: [],
      durationMs: Number.isFinite(Number(req.body.durationMs))
        ? Math.min(600000, Math.max(500, Number(req.body.durationMs)))
        : 1000,
      subtitle: '',
      cameraPreset: 'static',
      includeInPreview: req.body.includeInPreview !== false,
      side: undefined,
    };
    const index = req.body.index;
    if (typeof index === 'number' && index >= 0 && index <= timeline.nodes.length) {
      timeline.nodes.splice(index, 0, node);
    } else {
      timeline.nodes.push(node);
    }
    timeline.nodes = assignSides(timeline.nodes);
    await writeTimeline(timeline);
    res.status(201).json(timeline.nodes.find((n) => n.id === node.id));
  } catch (err) {
    next(err);
  }
});

app.patch('/api/nodes/:id', async (req, res, next) => {
  try {
    const timeline = await readTimeline();
    const node = findNode(timeline, req.params.id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const fields = [
      'title',
      'script',
      'imageUrl',
      'imagePrompt',
      'referenceUrls',
      'durationMs',
      'subtitle',
      'cameraPreset',
      'includeInPreview',
      'animation',
    ];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (field === 'durationMs') {
          const duration = Number(req.body[field]);
          node[field] = Number.isFinite(duration)
            ? Math.min(600000, Math.max(500, duration))
            : 2000;
        } else if (field === 'includeInPreview') {
          node[field] = req.body[field] !== false;
        } else if (field === 'animation') {
          if (req.body.animation === null) {
            delete node.animation;
          } else {
            node.animation = normalizeAnimationPatch(node.animation, req.body.animation);
          }
        } else {
          node[field] = req.body[field];
        }
      }
    }
    timeline.nodes = assignSides(timeline.nodes);
    await writeTimeline(timeline);
    res.json(timeline.nodes.find((n) => n.id === req.params.id));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/nodes/:id', async (req, res, next) => {
  try {
    const deletion = await mutateTimeline((timeline) => {
      const index = timeline.nodes.findIndex((node) => node.id === req.params.id);
      if (index < 0) return null;
      const [removed] = timeline.nodes.splice(index, 1);
      timeline.nodes = assignSides(timeline.nodes);
      return {
        staleUrls: [...nodeImageAssetUrls(removed)],
        referencedUrls: [...timelineReferencedImageUrls(timeline)],
      };
    });
    if (!deletion) {
      return res.status(404).json({ error: 'Node not found' });
    }
    await cleanupReplacedImages(deletion.staleUrls, deletion.referencedUrls);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/nodes/reorder', async (req, res, next) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array of node ids' });
    }
    const timeline = await readTimeline();
    const map = new Map(timeline.nodes.map((n) => [n.id, n]));
    const reordered = order.map((id) => map.get(id)).filter(Boolean);
    if (reordered.length !== timeline.nodes.length) {
      return res.status(400).json({ error: 'Invalid reorder: ids mismatch' });
    }
    timeline.nodes = assignSides(reordered);
    await writeTimeline(timeline);
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

app.get('/api/providers', (_req, res) => {
  res.json(listProviders());
});

app.get('/api/library', async (_req, res, next) => {
  try {
    const library = await readLibrary();
    res.json(library);
  } catch (err) {
    next(err);
  }
});

app.post('/api/library', upload.single('image'), async (req, res, next) => {
  try {
    const library = await readLibrary();
    const name = (req.body.name || '未命名参考').trim() || '未命名参考';

    let id;
    let imageUrl;

    if (req.file) {
      const ext = extFromMime(req.file.mimetype);
      ({ id, imageUrl } = await saveRefBuffer(req.file.buffer, ext));
    } else if (req.body.imageUrl) {
      ({ id, imageUrl } = await copyImageToRefs(req.body.imageUrl));
    } else {
      return res.status(400).json({ error: 'image file or imageUrl required' });
    }

    const item = { id, name, imageUrl, createdAt: new Date().toISOString() };
    library.items.unshift(item);
    await writeLibrary(library);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/library/:id', async (req, res, next) => {
  try {
    const library = await readLibrary();
    const item = library.items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.body.name !== undefined) item.name = req.body.name.trim() || item.name;
    await writeLibrary(library);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/library/:id', async (req, res, next) => {
  try {
    const library = await readLibrary();
    const before = library.items.length;
    library.items = library.items.filter((i) => i.id !== req.params.id);
    if (library.items.length === before) {
      return res.status(404).json({ error: 'Item not found' });
    }
    await writeLibrary(library);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/prompts', async (_req, res, next) => {
  try {
    res.json(await readPromptLibrary());
  } catch (err) {
    next(err);
  }
});

app.post('/api/prompts', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!name || !content) {
      return res.status(400).json({ error: '名称和 Prompt 内容不能为空' });
    }
    const library = await readPromptLibrary();
    const now = new Date().toISOString();
    const item = { id: createPromptId(), name, content, createdAt: now, updatedAt: now };
    library.items.unshift(item);
    await writePromptLibrary(library);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/prompts/:id', async (req, res, next) => {
  try {
    const library = await readPromptLibrary();
    const item = library.items.find((entry) => entry.id === req.params.id);
    if (!item) return res.status(404).json({ error: '提词不存在' });
    const name = req.body?.name === undefined ? item.name : String(req.body.name).trim();
    const content = req.body?.content === undefined ? item.content : String(req.body.content).trim();
    if (!name || !content) {
      return res.status(400).json({ error: '名称和 Prompt 内容不能为空' });
    }
    item.name = name;
    item.content = content;
    item.updatedAt = new Date().toISOString();
    await writePromptLibrary(library);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/prompts/:id', async (req, res, next) => {
  try {
    const library = await readPromptLibrary();
    const before = library.items.length;
    library.items = library.items.filter((entry) => entry.id !== req.params.id);
    if (library.items.length === before) {
      return res.status(404).json({ error: '提词不存在' });
    }
    await writePromptLibrary(library);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/generated-assets', async (_req, res, next) => {
  try {
    const timeline = await readTimeline();
    res.json(await initializeGeneratedAssets(timeline.nodes));
  } catch (err) {
    next(err);
  }
});

app.post('/api/generated-assets/from-frame', async (req, res, next) => {
  try {
    const imageUrl = String(req.body?.imageUrl || '');
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });
    const nodeId = String(req.body?.nodeId || '') || null;
    const timeline = nodeId ? await readTimeline() : null;
    const node = nodeId ? findNode(timeline, nodeId) : null;
    if (nodeId && !node) return res.status(404).json({ error: 'Node not found' });

    const loaded = await loadImageFromUrl(imageUrl);
    const ext = extFromMime(loaded.mime);
    const copiedUrl = await saveImageBuffer(nodeId || 'saved-frame', loaded.buffer, ext);
    const frameIndex = Number(req.body?.frameIndex);
    const asset = await createGeneratedImageAsset({
      imageUrl: copiedUrl,
      name: req.body?.name || `${node?.title || '动画'} - 已保存帧`,
      nodeId,
      prompt: node?.imagePrompt || req.body?.prompt || '',
      source: 'saved-frame',
      sourceAssetId: req.body?.sourceAssetId || null,
      frameIndex: Number.isInteger(frameIndex) ? frameIndex : null,
    });
    res.status(201).json(asset);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/generated-assets/:id', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: '素材名称不能为空' });
    const item = await mutateGeneratedAssets((repository) => {
      const match = repository.items.find((entry) => entry.id === req.params.id);
      if (!match) return null;
      match.name = name;
      match.updatedAt = new Date().toISOString();
      return structuredClone(match);
    });
    if (!item) return res.status(404).json({ error: '素材不存在' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

app.post('/api/generated-assets/:id/apply', async (req, res, next) => {
  try {
    const nodeId = String(req.body?.nodeId || '');
    const repository = await readGeneratedAssets();
    const asset = repository.items.find((entry) => entry.id === req.params.id);
    if (!asset) return res.status(404).json({ error: '素材不存在' });
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });
    const replacement = await mutateTimeline((timeline) => {
      const node = findNode(timeline, nodeId);
      if (!node) return null;
      const staleUrls = [...nodeImageAssetUrls(node)];
      node.imageUrl = asset.coverUrl || asset.imageUrl;
      node.imagePrompt = asset.prompt || '';
      if (asset.type === 'animation' && asset.animation) {
        node.animation = structuredClone(asset.animation);
      } else {
        delete node.animation;
      }
      return {
        node: structuredClone(node),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(timeline)],
      };
    });
    if (!replacement) return res.status(404).json({ error: 'Node not found' });
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);
    res.json({ node: replacement.node, asset });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/generated-assets/:id', async (req, res, next) => {
  try {
    const deletion = await deleteGeneratedAsset(req.params.id);
    if (!deletion) return res.status(404).json({ error: '素材不存在' });
    const timeline = await readTimeline();
    const referenced = new Set([
      ...timelineReferencedImageUrls(timeline),
      ...generatedAssetsReferencedUrls(deletion.repository),
    ]);
    await cleanupImageAssets(generatedAssetUrls(deletion.removed), referenced);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/refs/upload', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    const ext = extFromMime(req.file.mimetype);
    const { imageUrl } = await saveRefBuffer(req.file.buffer, ext);
    res.json({ imageUrl });
  } catch (err) {
    next(err);
  }
});

function extFromMime(mime) {
  if (mime?.includes('jpeg')) return 'jpg';
  if (mime?.includes('webp')) return 'webp';
  return 'png';
}

async function cleanupReplacedImages(staleUrls, referencedUrls) {
  try {
    const repository = await readGeneratedAssets();
    const referenced = new Set([
      ...referencedUrls,
      ...generatedAssetsReferencedUrls(repository),
    ]);
    await cleanupImageAssets(staleUrls, referenced);
  } catch (err) {
    console.error('Failed to clean replaced images:', err);
  }
}

async function recordGeneratedResult(node, request, generationKey = null) {
  try {
    return await upsertGeneratedAsset({
      node,
      provider: request.provider,
      model: request.model,
      size: request.size,
      prompt: request.userPrompt || request.prompt,
      generationKey,
    });
  } catch (err) {
    console.error('Failed to record generated asset:', err);
    return null;
  }
}

function normalizeFps(value, fallback = 4) {
  const fps = Number(value);
  if (!Number.isFinite(fps)) return fallback;
  return Math.min(32, Math.max(1, Math.round(fps)));
}

function parseGrid(body) {
  const frameCount = Number(body.frameCount);
  const outputFrameCount = body.outputFrameCount === undefined
    ? frameCount
    : Number(body.outputFrameCount);
  const columns = Number(body.columns);
  const rows = Number(body.rows);
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 64) {
    throw new Error('frameCount must be an integer between 1 and 64');
  }
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error('columns and rows must be positive integers');
  }
  if (columns * rows !== frameCount) {
    throw new Error(`columns × rows (${columns * rows}) must equal frameCount (${frameCount})`);
  }
  if (!Number.isInteger(outputFrameCount) || outputFrameCount < 1) {
    throw new Error('outputFrameCount must be a positive integer');
  }
  const dropsLeadingAnchor =
    frameCount === 9 && outputFrameCount === 8 && columns === 3 && rows === 3;
  if (outputFrameCount !== frameCount && !dropsLeadingAnchor) {
    throw new Error('Only a 3 × 3 sheet may discard its leading anchor to output 8 frames');
  }
  return { frameCount, outputFrameCount, columns, rows, dropsLeadingAnchor };
}

function frameAspectRatio(size) {
  if (size === '1024x1792') return '9:16（竖向矩形）';
  if (size === '1792x1024') return '16:9（横向矩形）';
  return '1:1（正方形）';
}

async function resolveFlipbookTemplate(templateId, templateContent) {
  if (typeof templateContent === 'string' && templateContent.trim()) return templateContent;
  if (templateId) {
    const selected = await getPromptById(templateId);
    if (selected?.content) return selected.content;
  }
  return (await getPromptByRole('flipbook'))?.content || '';
}

function composeFlipbookBatchPrompt({
  template,
  fallbackPrompt,
  userPrompt,
  size,
  plan,
  batchIndex,
  anchorAlias,
  endAnchorAlias,
}) {
  const batchNumber = batchIndex + 1;
  const firstFrame = batchIndex * plan.batchFrameCount + 1;
  const lastFrame = firstFrame + plan.batchFrameCount - 1;
  const startPercent = Math.round((batchIndex / plan.batchCount) * 100);
  const endPercent = Math.round((batchNumber / plan.batchCount) * 100);
  const isLast = batchNumber === plan.batchCount;
  const continuityRule = anchorAlias
    ? `${anchorAlias} 是上一批的最后一帧，只用于连续性参考。本批必须生成紧接其后的 4 个新画面，不得把该参考图重复画成第 1 格。`
    : '这是第一批，从动作起点开始生成 4 个连续的新画面。';
  const phaseRule = isLast
    ? `本批负责总动作 ${startPercent}% 到 100%，最后一格到达本段动作终点。`
    : `本批只负责总动作 ${startPercent}% 到 ${endPercent}%，不得提前完成整个动作。`;
  const endAnchorRule = endAnchorAlias
    ? `${endAnchorAlias} 是本段精确终点参考；仅最后一格可以到达它，前 3 格不得提前复制终点。`
    : '本批没有终点参考图，严格按阶段进度停止，不得自行完成后续动作。';
  const variables = {
    frameCount: 4,
    sheetFrameCount: 4,
    outputFrameCount: 4,
    totalOutputFrameCount: plan.outputFrameCount,
    columns: 2,
    rows: 2,
    columnsMinusOne: 1,
    rowsMinusOne: 1,
    frameCountMinusOne: 3,
    frameAspectRatio: frameAspectRatio(size),
    gridConstraint: '本批必须恰好 2 列、2 行，共 4 格；不得出现第 3 列或第 3 行。',
    frameSelectionRule: '本批 4 格全部保留，并按从左到右、从上到下的顺序播放。',
    userPrompt: userPrompt || fallbackPrompt || 'continuous action',
    segmentPrompt: userPrompt || fallbackPrompt || 'continuous action',
    batchCount: plan.batchCount,
    batchNumber,
    batchStartFrame: firstFrame,
    batchEndFrame: lastFrame,
    batchStartPercent: `${startPercent}%`,
    batchEndPercent: `${endPercent}%`,
    continuityRule,
    phaseRule,
    endAnchorRule,
    progress: `${endPercent}%`,
    phaseHint: phaseRule,
    startAlias: anchorAlias || '@1',
    endAlias: endAnchorAlias || '',
  };
  const shell = template
    ? fillPromptTemplate(template, variables)
    : String(fallbackPrompt || userPrompt || '').trim();
  return `${shell}\n\n【后端分批布局约束｜优先级最高】
这是第 ${batchNumber}/${plan.batchCount} 批，对应最终第 ${firstFrame}-${lastFrame} 帧。
${phaseRule}
${continuityRule}
${endAnchorRule}
只生成一张严格的 2×2 storyboard sheet：恰好两列、恰好两行、恰好四格。四个分格尺寸完全一致，按画布中线形成不可见的等分裁切边界。禁止可见分隔线、标题栏、边注、额外缩略图、第三列、第三行和留白占位格。`.trim();
}

async function generateFlipbookBatches({
  provider,
  model,
  size,
  nodeId,
  plan,
  template,
  fallbackPrompt,
  userPrompt,
  referenceUrls,
  generatedUrls,
  initialAnchorUrl = null,
  finalAnchorUrl = null,
}) {
  const batches = [];
  const frameUrls = [];
  const discardedUrls = [];
  let previousFrameUrl = initialAnchorUrl;

  for (let batchIndex = 0; batchIndex < plan.batchCount; batchIndex += 1) {
    const batchStartAnchorUrl = previousFrameUrl;
    const batchReferenceUrls = [...referenceUrls];
    if (previousFrameUrl && !batchReferenceUrls.includes(previousFrameUrl)) {
      batchReferenceUrls.push(previousFrameUrl);
    }
    const anchorAlias = previousFrameUrl ? `@${batchReferenceUrls.indexOf(previousFrameUrl) + 1}` : null;
    const isLast = batchIndex === plan.batchCount - 1;
    if (isLast && finalAnchorUrl && !batchReferenceUrls.includes(finalAnchorUrl)) {
      batchReferenceUrls.push(finalAnchorUrl);
    }
    const endAnchorAlias = finalAnchorUrl && isLast
      ? `@${batchReferenceUrls.indexOf(finalAnchorUrl) + 1}`
      : null;
    const batchPrompt = composeFlipbookBatchPrompt({
      template,
      fallbackPrompt,
      userPrompt,
      size,
      plan,
      batchIndex,
      anchorAlias,
      endAnchorAlias,
    });
    const references = await loadReferences(batchReferenceUrls);
    const result = await provider.generate({
      model,
      prompt: batchPrompt,
      size,
      references,
    });
    const ext = result.ext || (result.mime?.includes('jpeg') ? 'jpg' : 'png');
    const sourceUrl = await saveImageBuffer(nodeId, result.buffer, ext);
    generatedUrls.push(sourceUrl);
    const sliced = await sliceFlipbookSheet(result.buffer, {
      columns: plan.columns,
      rows: plan.rows,
      nodeId,
    });
    generatedUrls.push(...sliced.frameUrls);
    if (sliced.frameUrls.length !== plan.batchFrameCount) {
      throw new Error(`第 ${batchIndex + 1} 批期望 4 帧，实际 ${sliced.frameUrls.length}`);
    }
    let batchFrameUrls = sliced.frameUrls;
    if (isLast && finalAnchorUrl) {
      discardedUrls.push(sliced.frameUrls[sliced.frameUrls.length - 1]);
      batchFrameUrls = [...sliced.frameUrls.slice(0, -1), finalAnchorUrl];
    }
    frameUrls.push(...batchFrameUrls);
    previousFrameUrl = batchFrameUrls[batchFrameUrls.length - 1];
    batches.push({
      index: batchIndex,
      sourceUrl,
      frameUrls: batchFrameUrls,
      prompt: batchPrompt,
      anchorUrl: batchStartAnchorUrl,
      endAnchorUrl: isLast ? finalAnchorUrl : null,
      createdAt: new Date().toISOString(),
    });
  }

  return { batches, frameUrls, discardedUrls };
}

function normalizeAnimationPatch(current, patch) {
  if (patch === null) return undefined;
  if (!patch || typeof patch !== 'object') return current;
  const next = { ...(current || {}), ...patch };
  if (next.fps !== undefined) next.fps = normalizeFps(next.fps, current?.fps || 4);
  if (Array.isArray(next.frameUrls)) {
    next.frameCount = next.frameUrls.length;
  }
  return next;
}

function isAnchoredChain(animation) {
  return animation?.mode === 'anchored-chain32';
}

function emptyKeyframeUrls(k0 = null, k4 = null) {
  return [k0 || null, null, null, null, k4 || null];
}

function normalizeSegmentSlots(segments) {
  const slots = [null, null, null, null];
  if (!Array.isArray(segments)) return slots;
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const index = Number(segment.index);
    if (Number.isInteger(index) && index >= 0 && index <= 3) {
      slots[index] = segment;
    }
  }
  // Legacy chain32 stored dense sequential segments without sparse slots.
  if (!slots.some(Boolean) && segments.length > 0 && segments.every((s) => s?.frameUrls)) {
    for (let i = 0; i < Math.min(4, segments.length); i += 1) {
      slots[i] = { ...segments[i], index: i };
    }
  }
  return slots;
}

function mergeSegmentFrameUrls(slots) {
  const urls = [];
  for (const segment of slots) {
    if (!segment?.frameUrls?.length) break;
    urls.push(...segment.frameUrls);
  }
  // If later slots finished first, still include them only after a contiguous prefix exists;
  // once all four slots are ready, concatenate in strict 0→3 order.
  if (slots.every((segment) => segment?.frameUrls?.length)) {
    return slots.flatMap((segment) => segment.frameUrls);
  }
  return urls;
}

function midKeyframesReady(keyframeUrls) {
  return Boolean(keyframeUrls?.[1] && keyframeUrls?.[2] && keyframeUrls?.[3]);
}

function allKeyframesReady(keyframeUrls) {
  return Boolean(
    keyframeUrls?.[0] &&
      keyframeUrls?.[1] &&
      keyframeUrls?.[2] &&
      keyframeUrls?.[3] &&
      keyframeUrls?.[4],
  );
}

function anchoredPhase(animation) {
  if (!isAnchoredChain(animation)) return null;
  const slots = normalizeSegmentSlots(animation.segments);
  if (slots.every(Boolean) && animation.frameUrls?.length >= 32) return 'complete';
  if (animation.keyframesConfirmed) return 'segments';
  if (midKeyframesReady(animation.keyframeUrls)) return 'awaiting-confirm';
  return 'keyframes';
}

async function resolveAnchoredPrompt(role, preferredId) {
  if (preferredId) {
    const byId = await getPromptById(preferredId);
    if (byId?.content && byId.role === role) return byId;
  }
  const byRole = await getPromptByRole(role);
  if (byRole?.content) return byRole;
  const fallbackId =
    role === 'anchored-keyframe' ? PROMPT_IDS.anchoredKeyframe : PROMPT_IDS.anchoredSegment;
  return getPromptById(fallbackId);
}

async function composeAnchoredKeyframePrompt(
  userPrompt,
  keyframeIndex,
  segmentPrompts = [],
  templateId = null,
) {
  const progress = { 1: '25%', 2: '50%', 3: '75%' }[keyframeIndex] || '50%';
  const phaseHint = segmentPrompts[keyframeIndex - 1] || '保持动作连续，不要越界';
  const item = await resolveAnchoredPrompt('anchored-keyframe', templateId);
  if (!item?.content) {
    throw new Error('提词库缺少「32帧锚点·中间关键帧」模板，请在提词库中恢复或新建');
  }
  return fillPromptTemplate(item.content, {
    progress,
    userPrompt: userPrompt || 'continuous action',
    phaseHint,
  });
}

app.post('/api/generate', async (req, res, next) => {
  try {
    const { nodeId, provider, model, prompt, size, referenceUrls } = req.body;
    if (!nodeId || !provider || !prompt) {
      return res.status(400).json({ error: 'nodeId, provider, and prompt are required' });
    }

    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const references = await loadReferences(referenceUrls || []);
    const p = getProvider(provider);
    const result = await p.generate({
      model,
      prompt,
      size: size || '1024x1024',
      references,
    });
    const ext = result.ext || (result.mime?.includes('jpeg') ? 'jpg' : 'png');
    const imageUrl = await saveImageBuffer(nodeId, result.buffer, ext);

    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      if (!latestNode) {
        throw new Error('Node was deleted while the image was generating');
      }
      const staleUrls = [...nodeImageAssetUrls(latestNode)];
      latestNode.imageUrl = imageUrl;
      latestNode.imagePrompt = prompt;
      delete latestNode.animation;
      return {
        node: structuredClone(latestNode),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);

    res.json({ imageUrl, node: replacement.node });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate-animation', async (req, res, next) => {
  try {
    const {
      nodeId,
      provider,
      model,
      prompt,
      userPrompt,
      size,
      referenceUrls,
      fps,
      templateId,
      templateContent,
    } = req.body;
    if (!nodeId || !provider || !prompt) {
      return res.status(400).json({ error: 'nodeId, provider, and prompt are required' });
    }

    let grid;
    try {
      grid = parseGrid(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const references = await loadReferences(referenceUrls || []);
    const p = getProvider(provider);
    const result = await p.generate({
      model,
      prompt,
      size: size || '1024x1024',
      references,
    });
    const ext = result.ext || (result.mime?.includes('jpeg') ? 'jpg' : 'png');
    const sourceUrl = await saveImageBuffer(nodeId, result.buffer, ext);
    const sliced = await sliceFlipbookSheet(result.buffer, {
      columns: grid.columns,
      rows: grid.rows,
      nodeId,
    });
    const discardedFrameUrls = grid.dropsLeadingAnchor ? sliced.frameUrls.slice(0, 1) : [];
    const frameUrls = grid.dropsLeadingAnchor ? sliced.frameUrls.slice(1) : sliced.frameUrls;
    const generatedUrls = [sourceUrl, ...sliced.frameUrls];

    const animation = {
      sourceUrl,
      frameUrls,
      frameCount: frameUrls.length,
      sheetFrameCount: sliced.frameCount,
      droppedLeadingFrames: discardedFrameUrls.length,
      columns: sliced.columns,
      rows: sliced.rows,
      fps: normalizeFps(fps, 4),
      templateId: templateId || null,
      templateContent: typeof templateContent === 'string' ? templateContent : '',
      userPrompt: typeof userPrompt === 'string' ? userPrompt : '',
    };

    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      if (!latestNode) {
        throw new Error('Node was deleted while the animation was generating');
      }
      const staleUrls = [...nodeImageAssetUrls(latestNode)];
      latestNode.imageUrl = frameUrls[0] || sourceUrl;
      latestNode.imagePrompt = userPrompt || prompt;
      latestNode.animation = animation;
      return {
        node: structuredClone(latestNode),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });
    const asset = await recordGeneratedResult(replacement.node, req.body);
    await cleanupReplacedImages(
      [...replacement.staleUrls, ...discardedFrameUrls],
      replacement.referencedUrls,
    );

    res.json({
      sourceUrl,
      imageUrl: replacement.node.imageUrl,
      animation,
      node: replacement.node,
      asset,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate-animation-chain/keyframe', async (req, res, next) => {
  try {
    const {
      nodeId,
      provider,
      model,
      prompt,
      userPrompt,
      size,
      referenceUrls,
      fps,
      templateId,
      atlasTemplateId,
      keyframeTemplateId,
      segmentTemplateId,
      templateContent,
      chainId,
      segmentPrompts,
    } = req.body;
    const keyframeIndex = Number(req.body.keyframeIndex);
    if (!nodeId || !provider || !chainId) {
      return res.status(400).json({ error: 'nodeId, provider, and chainId are required' });
    }
    if (![1, 2, 3].includes(keyframeIndex)) {
      return res.status(400).json({ error: 'keyframeIndex must be 1, 2, or 3' });
    }

    const refs = Array.isArray(referenceUrls) ? referenceUrls.filter(Boolean) : [];
    if (refs.length < 2) {
      return res.status(400).json({ error: '需要至少两张参考图：@1 首帧 K0，@2 尾帧 K4' });
    }
    const k0 = refs[0];
    const k4 = refs[1];

    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const current =
      isAnchoredChain(node.animation) && node.animation.chainId === chainId
        ? node.animation
        : null;
    if (current?.keyframeUrls?.[keyframeIndex] && !req.body.force) {
      return res.json({
        reused: true,
        keyframeIndex,
        imageUrl: current.keyframeUrls[keyframeIndex],
        animation: current,
        node,
        phase: anchoredPhase(current),
      });
    }

    const finalPrompt = await composeAnchoredKeyframePrompt(
      typeof userPrompt === 'string' ? userPrompt : '',
      keyframeIndex,
      Array.isArray(segmentPrompts) ? segmentPrompts : [],
      keyframeTemplateId || PROMPT_IDS.anchoredKeyframe,
    );

    const references = await loadReferences([k0, k4]);
    const p = getProvider(provider);
    const result = await p.generate({
      model,
      prompt: finalPrompt,
      size: size || '1024x1024',
      references,
    });
    const ext = result.ext || (result.mime?.includes('jpeg') ? 'jpg' : 'png');
    const imageUrl = await saveImageBuffer(nodeId, result.buffer, ext);

    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      if (!latestNode) throw new Error('Node was deleted while the keyframe was generating');

      const previous =
        isAnchoredChain(latestNode.animation) && latestNode.animation.chainId === chainId
          ? latestNode.animation
          : null;
      const staleUrls = [];
      if (!previous) {
        staleUrls.push(...nodeImageAssetUrls(latestNode));
      } else if (previous.keyframeUrls?.[keyframeIndex]) {
        staleUrls.push(previous.keyframeUrls[keyframeIndex]);
      }
      if (previous?.keyframesConfirmed) {
        for (const segment of normalizeSegmentSlots(previous.segments)) {
          if (segment?.sourceUrl) staleUrls.push(segment.sourceUrl);
          for (const url of segment?.frameUrls || []) staleUrls.push(url);
        }
      }

      const keyframeUrls = emptyKeyframeUrls(k0, k4);
      if (previous?.keyframeUrls) {
        for (let i = 1; i <= 3; i += 1) {
          keyframeUrls[i] = previous.keyframeUrls[i] || null;
        }
      }
      keyframeUrls[0] = k0;
      keyframeUrls[4] = k4;
      keyframeUrls[keyframeIndex] = imageUrl;

      const animation = {
        mode: 'anchored-chain32',
        chainId,
        phase: midKeyframesReady(keyframeUrls) ? 'awaiting-confirm' : 'keyframes',
        keyframesConfirmed: false,
        keyframesConfirmedAt: null,
        keyframeUrls,
        sourceUrl: previous?.sourceUrl || imageUrl,
        frameUrls: [],
        frameCount: 0,
        columns: 3,
        rows: 3,
        fps: normalizeFps(fps, previous?.fps || 8),
        templateId: atlasTemplateId || templateId || previous?.templateId || null,
        templateBindings: {
          atlas: atlasTemplateId || templateId || previous?.templateBindings?.atlas || null,
          keyframe:
            keyframeTemplateId ||
            previous?.templateBindings?.keyframe ||
            PROMPT_IDS.anchoredKeyframe,
          segment:
            segmentTemplateId ||
            previous?.templateBindings?.segment ||
            PROMPT_IDS.anchoredSegment,
        },
        templateContent:
          typeof templateContent === 'string'
            ? templateContent
            : previous?.templateContent || '',
        userPrompt: typeof userPrompt === 'string' ? userPrompt : previous?.userPrompt || '',
        segmentPrompts: Array.isArray(segmentPrompts)
          ? segmentPrompts.slice(0, 4)
          : previous?.segmentPrompts || [],
        totalFrames: 32,
        segmentSize: 8,
        segments: [null, null, null, null],
      };
      animation.phase = anchoredPhase(animation);
      latestNode.imageUrl = imageUrl;
      latestNode.imagePrompt = animation.userPrompt || finalPrompt;
      latestNode.animation = animation;
      return {
        node: structuredClone(latestNode),
        animation: structuredClone(animation),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });

    const asset = await recordGeneratedResult(
      replacement.node,
      req.body,
      `chain:${nodeId}:${chainId}`,
    );
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);

    res.json({
      keyframeIndex,
      imageUrl,
      animation: replacement.animation,
      node: replacement.node,
      phase: anchoredPhase(replacement.animation),
      asset,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate-animation-chain/confirm-keyframes', async (req, res, next) => {
  try {
    const { nodeId, chainId } = req.body;
    if (!nodeId || !chainId) {
      return res.status(400).json({ error: 'nodeId and chainId are required' });
    }

    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      if (!latestNode) throw new Error('Node not found');
      const animation = latestNode.animation;
      if (!isAnchoredChain(animation) || animation.chainId !== chainId) {
        throw new Error('未找到对应的锚点接力动画');
      }
      if (!allKeyframesReady(animation.keyframeUrls)) {
        throw new Error('请先生成全部中间关键帧 K1、K2、K3');
      }
      if (animation.keyframesConfirmed) {
        return {
          node: structuredClone(latestNode),
          animation: structuredClone(animation),
          staleUrls: [],
          referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
          reused: true,
        };
      }
      animation.keyframesConfirmed = true;
      animation.keyframesConfirmedAt = new Date().toISOString();
      animation.phase = 'segments';
      animation.segments = normalizeSegmentSlots(animation.segments);
      latestNode.animation = animation;
      return {
        node: structuredClone(latestNode),
        animation: structuredClone(animation),
        staleUrls: [],
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
        reused: false,
      };
    });

    res.json({
      reused: Boolean(replacement.reused),
      animation: replacement.animation,
      node: replacement.node,
      phase: anchoredPhase(replacement.animation),
    });
  } catch (err) {
    if (err.message === 'Node not found') return res.status(404).json({ error: err.message });
    if (
      err.message.includes('未找到') ||
      err.message.includes('请先生成')
    ) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

app.post('/api/generate-animation-chain/segment', async (req, res, next) => {
  try {
    const {
      nodeId,
      provider,
      model,
      prompt,
      userPrompt,
      size,
      referenceUrls,
      fps,
      templateId,
      atlasTemplateId,
      keyframeTemplateId,
      segmentTemplateId,
      templateContent,
      chainId,
      segmentPrompts,
      mode,
    } = req.body;
    const segmentIndex = Number(req.body.segmentIndex);
    if (!nodeId || !provider || !chainId) {
      return res.status(400).json({ error: 'nodeId, provider, and chainId are required' });
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex > 3) {
      return res.status(400).json({ error: 'segmentIndex must be between 0 and 3' });
    }

    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const wantsAnchored =
      mode === 'anchored-chain32' ||
      (mode !== 'chain32' && isAnchoredChain(node.animation));

    if (wantsAnchored || isAnchoredChain(node.animation)) {
      if (!isAnchoredChain(node.animation) || node.animation.chainId !== chainId) {
        return res.status(400).json({ error: '请先生成并确认关键帧后再开始分段' });
      }
      const currentChain = node.animation;
      if (!currentChain.keyframesConfirmed) {
        return res.status(400).json({ error: '请先确认关键帧后再生成分段' });
      }
      if (!allKeyframesReady(currentChain.keyframeUrls)) {
        return res.status(400).json({ error: '关键帧不完整，无法生成分段' });
      }

      const slots = normalizeSegmentSlots(currentChain.segments);
      if (slots[segmentIndex] && !req.body.force) {
        const completedSegments = slots.filter(Boolean).length;
        return res.json({
          reused: true,
          segmentIndex,
          completedSegments,
          complete: slots.every(Boolean),
          imageUrl: node.imageUrl,
          animation: currentChain,
          node,
        });
      }

      const startAnchorUrl = currentChain.keyframeUrls[segmentIndex];
      const endAnchorUrl = currentChain.keyframeUrls[segmentIndex + 1];
      const segmentUserPrompt = Array.isArray(segmentPrompts)
        ? segmentPrompts[segmentIndex]
        : currentChain.segmentPrompts?.[segmentIndex];
      const masterPrompt =
        typeof userPrompt === 'string' ? userPrompt : currentChain.userPrompt || '';
      const p = getProvider(provider);
      const atlasTemplate = await resolveFlipbookTemplate(
        atlasTemplateId || templateId,
        templateContent || currentChain.templateContent || '',
      );
      const segmentTemplate = await resolveAnchoredPrompt(
        'anchored-segment',
        segmentTemplateId || PROMPT_IDS.anchoredSegment,
      );
      if (!segmentTemplate?.content) {
        throw new Error('提词库缺少「32帧锚点·分段约束」模板，请在提词库中恢复或新建');
      }
      const batchTemplate = [atlasTemplate, segmentTemplate.content].filter(Boolean).join('\n\n');
      const generatedUrls = [];
      let generated;
      try {
        generated = await generateFlipbookBatches({
          provider: p,
          model,
          size: size || '1024x1024',
          nodeId,
          plan: {
            outputFrameCount: 8,
            batchCount: 2,
            batchFrameCount: 4,
            columns: 2,
            rows: 2,
          },
          template: batchTemplate,
          fallbackPrompt: prompt,
          userPrompt: [masterPrompt, segmentUserPrompt].filter(Boolean).join('\n'),
          referenceUrls: [],
          generatedUrls,
          initialAnchorUrl: startAnchorUrl,
          finalAnchorUrl: endAnchorUrl,
        });
      } catch (err) {
        await cleanupReplacedImages(generatedUrls, [...timelineReferencedImageUrls(timeline)]);
        throw err;
      }
      const { batches, frameUrls, discardedUrls } = generated;
      const sourceUrls = batches.map((batch) => batch.sourceUrl);
      const sourceUrl = sourceUrls[0];
      const segment = {
        index: segmentIndex,
        sourceUrl,
        sourceUrls,
        frameUrls,
        prompt: batches.map((batch) => batch.prompt).join('\n\n--- NEXT BATCH ---\n\n'),
        startAnchorUrl,
        endAnchorUrl,
        anchorUrl: startAnchorUrl,
        batchCount: 2,
        batchSize: 4,
        batches,
        createdAt: new Date().toISOString(),
      };

      let replacement;
      try {
        replacement = await mutateTimeline((latestTimeline) => {
          const latestNode = findNode(latestTimeline, nodeId);
          if (!latestNode) throw new Error('Node was deleted while the animation was generating');
          const latestChain =
            isAnchoredChain(latestNode.animation) && latestNode.animation.chainId === chainId
              ? latestNode.animation
              : null;
          if (!latestChain?.keyframesConfirmed) {
            throw new Error('关键帧确认状态已变更，请重新确认后再生成');
          }

          const nextSlots = normalizeSegmentSlots(latestChain.segments);
          const staleUrls = [];
          if (nextSlots[segmentIndex]) {
            staleUrls.push(...nodeImageAssetUrls({
              animation: { segments: [nextSlots[segmentIndex]] },
            }));
          }
          nextSlots[segmentIndex] = segment;
          const complete = nextSlots.every(Boolean);
          const mergedFrames = mergeSegmentFrameUrls(nextSlots);
          const animation = {
          ...latestChain,
          sourceUrl: latestChain.sourceUrl || sourceUrl,
          frameUrls: mergedFrames,
          frameCount: mergedFrames.length,
          columns: 2,
          rows: 2,
          batchCount: 8,
          batchSize: 4,
          fps: normalizeFps(fps, latestChain.fps || 8),
          templateId: atlasTemplateId || templateId || latestChain.templateId || null,
          templateBindings: {
            atlas:
              atlasTemplateId ||
              templateId ||
              latestChain.templateBindings?.atlas ||
              latestChain.templateId ||
              null,
            keyframe:
              keyframeTemplateId ||
              latestChain.templateBindings?.keyframe ||
              PROMPT_IDS.anchoredKeyframe,
            segment:
              segmentTemplateId ||
              latestChain.templateBindings?.segment ||
              PROMPT_IDS.anchoredSegment,
          },
          templateContent:
            typeof templateContent === 'string'
              ? templateContent
              : latestChain.templateContent || '',
          userPrompt:
            typeof userPrompt === 'string' ? userPrompt : latestChain.userPrompt || '',
          segmentPrompts: Array.isArray(segmentPrompts)
            ? segmentPrompts.slice(0, 4)
            : latestChain.segmentPrompts || [],
          totalFrames: 32,
          segmentSize: 8,
          segments: nextSlots,
          phase: complete ? 'complete' : 'segments',
          keyframesConfirmed: true,
          };
          latestNode.imageUrl =
            animation.frameUrls[0] || animation.keyframeUrls?.[0] || sourceUrl;
          latestNode.imagePrompt = animation.userPrompt || segment.prompt;
          latestNode.animation = animation;
          return {
            node: structuredClone(latestNode),
            animation: structuredClone(animation),
            staleUrls,
            referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
          };
        });
      } catch (err) {
        await cleanupReplacedImages(generatedUrls, [...timelineReferencedImageUrls(timeline)]);
        throw err;
      }

      const asset = await recordGeneratedResult(
        replacement.node,
        req.body,
        `chain:${nodeId}:${chainId}`,
      );
      await cleanupReplacedImages(
        [...replacement.staleUrls, ...discardedUrls],
        replacement.referencedUrls,
      );
      const completedSegments = normalizeSegmentSlots(replacement.animation.segments).filter(
        Boolean,
      ).length;

      return res.json({
        segmentIndex,
        completedSegments,
        complete: completedSegments >= 4,
        imageUrl: replacement.node.imageUrl,
        animation: replacement.animation,
        node: replacement.node,
        asset,
      });
    }

    // Legacy sequential chain32 (read/continue only)
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required for legacy chain32' });
    }

    const currentChain =
      node.animation?.mode === 'chain32' && node.animation.chainId === chainId
        ? node.animation
        : null;
    const completedSegments = currentChain?.segments?.length || 0;
    if (currentChain && segmentIndex < completedSegments) {
      return res.json({
        reused: true,
        segmentIndex,
        completedSegments,
        complete: completedSegments >= 4,
        imageUrl: node.imageUrl,
        animation: currentChain,
        node,
      });
    }
    if (segmentIndex > 0 && (!currentChain || segmentIndex !== completedSegments)) {
      return res.status(409).json({ error: '接力段顺序不正确，请从未完成的段继续' });
    }

    const userReferenceUrls = Array.isArray(referenceUrls) ? referenceUrls.filter(Boolean) : [];
    const anchorUrl =
      segmentIndex > 0 ? currentChain.frameUrls[currentChain.frameUrls.length - 1] : null;
    const allReferenceUrls = anchorUrl ? [...userReferenceUrls, anchorUrl] : userReferenceUrls;
    const references = await loadReferences(allReferenceUrls);
    const anchorAlias = anchorUrl ? `@${allReferenceUrls.length}` : null;
    const finalPrompt = anchorAlias
      ? `${prompt}\n\nCONTINUITY REQUIREMENT: ${anchorAlias} is the exact final frame of the previous segment. Generate eight NEW chronological frames that happen immediately after ${anchorAlias}. Do not redraw or repeat the anchor as one of the eight cells. Keep identity, clothing, environment, lighting, camera direction, and motion continuous.`
      : prompt;

    const p = getProvider(provider);
    const result = await p.generate({
      model,
      prompt: finalPrompt,
      size: size || '1024x1024',
      references,
    });
    const ext = result.ext || (result.mime?.includes('jpeg') ? 'jpg' : 'png');
    const sourceUrl = await saveImageBuffer(nodeId, result.buffer, ext);
    const sliced = await sliceFlipbookSheet(result.buffer, {
      columns: 4,
      rows: 2,
      nodeId,
    });
    const segment = {
      index: segmentIndex,
      sourceUrl,
      frameUrls: sliced.frameUrls,
      prompt: finalPrompt,
      anchorUrl,
      createdAt: new Date().toISOString(),
    };

    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      if (!latestNode) throw new Error('Node was deleted while the animation was generating');
      const latestChain =
        latestNode.animation?.mode === 'chain32' && latestNode.animation.chainId === chainId
          ? latestNode.animation
          : null;
      const latestCompleted = latestChain?.segments?.length || 0;
      if (segmentIndex > 0 && (!latestChain || latestCompleted !== segmentIndex)) {
        throw new Error('Animation chain changed while this segment was generating');
      }

      const staleUrls = segmentIndex === 0 ? [...nodeImageAssetUrls(latestNode)] : [];
      const priorFrames = segmentIndex === 0 ? [] : latestChain.frameUrls;
      const priorSegments = segmentIndex === 0 ? [] : latestChain.segments;
      const animation = {
        mode: 'chain32',
        chainId,
        sourceUrl: segmentIndex === 0 ? sourceUrl : latestChain.sourceUrl,
        frameUrls: [...priorFrames, ...sliced.frameUrls],
        frameCount: priorFrames.length + sliced.frameUrls.length,
        columns: 4,
        rows: 2,
        fps: normalizeFps(fps, latestChain?.fps || 8),
        templateId: templateId || latestChain?.templateId || null,
        templateContent:
          typeof templateContent === 'string'
            ? templateContent
            : latestChain?.templateContent || '',
        userPrompt: typeof userPrompt === 'string' ? userPrompt : latestChain?.userPrompt || '',
        segmentPrompts: Array.isArray(segmentPrompts)
          ? segmentPrompts.slice(0, 4)
          : latestChain?.segmentPrompts || [],
        totalFrames: 32,
        segmentSize: 8,
        segments: [...priorSegments, segment],
      };
      latestNode.imageUrl = animation.frameUrls[0] || sourceUrl;
      latestNode.imagePrompt = animation.userPrompt || prompt;
      latestNode.animation = animation;
      return {
        node: structuredClone(latestNode),
        animation: structuredClone(animation),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });
    const asset = await recordGeneratedResult(
      replacement.node,
      req.body,
      `chain:${nodeId}:${chainId}`,
    );
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);

    res.json({
      segmentIndex,
      completedSegments: replacement.animation.segments.length,
      complete: replacement.animation.segments.length >= 4,
      imageUrl: replacement.node.imageUrl,
      animation: replacement.animation,
      node: replacement.node,
      asset,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/nodes/:id/upload', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const timeline = await readTimeline();
    if (!findNode(timeline, req.params.id)) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const ext = req.file.mimetype?.includes('jpeg') ? 'jpg' : 'png';
    const imageUrl = await saveImageBuffer(req.params.id, req.file.buffer, ext);
    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, req.params.id);
      if (!latestNode) throw new Error('Node was deleted while the image was uploading');
      const staleUrls = [...nodeImageAssetUrls(latestNode)];
      latestNode.imageUrl = imageUrl;
      delete latestNode.animation;
      return {
        node: structuredClone(latestNode),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });
    const asset = await recordGeneratedResult(replacement.node, req.body);
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);

    res.json({ imageUrl, node: replacement.node, asset });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  const configured = listProviders();
  console.log(`Script Flow running at http://localhost:${PORT}`);
  if (configured.length === 0) {
    console.log('No image providers configured. Copy .env.example to .env and add API keys.');
  } else {
    console.log(`Image providers: ${configured.map((p) => p.label).join(', ')}`);
  }
});
