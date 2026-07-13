import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assembleInterpolatedFrames,
  assignSides,
  cleanupImageAssets,
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
  loadReferences,
  readLibrary,
  saveRefBuffer,
  writeLibrary,
} from './library.js';
import {
  createPromptId,
  readPromptLibrary,
  writePromptLibrary,
} from './prompt-library.js';
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

app.get('/api/timeline', async (_req, res, next) => {
  try {
    const timeline = await readTimeline();
    const normalized = assignSides(timeline.nodes);
    const changed = JSON.stringify(normalized) !== JSON.stringify(timeline.nodes);
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
    const { title, nodes } = req.body;
    const timeline = await readTimeline();
    if (title !== undefined) timeline.title = title;
    if (nodes !== undefined) timeline.nodes = assignSides(nodes);
    await writeTimeline(timeline);
    res.json(timeline);
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
        : 2000,
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
    const timeline = await readTimeline();
    const before = timeline.nodes.length;
    timeline.nodes = timeline.nodes.filter((n) => n.id !== req.params.id);
    if (timeline.nodes.length === before) {
      return res.status(404).json({ error: 'Node not found' });
    }
    timeline.nodes = assignSides(timeline.nodes);
    await writeTimeline(timeline);
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
    await cleanupImageAssets(staleUrls, new Set(referencedUrls));
  } catch (err) {
    console.error('Failed to clean replaced images:', err);
  }
}

function normalizeFps(value, fallback = 4) {
  const fps = Number(value);
  if (!Number.isFinite(fps)) return fallback;
  return Math.min(30, Math.max(1, Math.round(fps)));
}

function parseGrid(body) {
  const frameCount = Number(body.frameCount);
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
  return { frameCount, columns, rows };
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
    const { nodeId, provider, model, prompt, size, referenceUrls, fps, templateId } = req.body;
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

    const animation = {
      sourceUrl,
      frameUrls: sliced.frameUrls,
      frameCount: sliced.frameCount,
      columns: sliced.columns,
      rows: sliced.rows,
      fps: normalizeFps(fps, 4),
      templateId: templateId || null,
      userPrompt: typeof req.body.userPrompt === 'string' ? req.body.userPrompt : '',
    };

    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      if (!latestNode) {
        throw new Error('Node was deleted while the animation was generating');
      }
      const staleUrls = [...nodeImageAssetUrls(latestNode)];
      latestNode.imageUrl = sliced.frameUrls[0] || sourceUrl;
      latestNode.imagePrompt = prompt;
      latestNode.animation = animation;
      return {
        node: structuredClone(latestNode),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);

    res.json({
      sourceUrl,
      imageUrl: replacement.node.imageUrl,
      animation,
      node: replacement.node,
    });
  } catch (err) {
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
      templateContent,
      chainId,
      segmentPrompts,
    } = req.body;
    const segmentIndex = Number(req.body.segmentIndex);
    if (!nodeId || !provider || !prompt || !chainId) {
      return res.status(400).json({ error: 'nodeId, provider, prompt, and chainId are required' });
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex > 3) {
      return res.status(400).json({ error: 'segmentIndex must be between 0 and 3' });
    }

    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

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
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);

    res.json({
      segmentIndex,
      completedSegments: replacement.animation.segments.length,
      complete: replacement.animation.segments.length >= 4,
      imageUrl: replacement.node.imageUrl,
      animation: replacement.animation,
      node: replacement.node,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate-interpolation/keyframes', async (req, res, next) => {
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
      chainId,
    } = req.body;
    if (!nodeId || !provider || !prompt || !chainId) {
      return res.status(400).json({ error: 'nodeId, provider, prompt, and chainId are required' });
    }
    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    if (node.animation?.mode === 'interpolate32' && node.animation.chainId === chainId) {
      return res.json({ reused: true, imageUrl: node.imageUrl, animation: node.animation, node });
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
    const sliced = await sliceFlipbookSheet(result.buffer, { columns: 4, rows: 2, nodeId });

    const replacement = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      if (!latestNode) throw new Error('Node was deleted while keyframes were generating');
      const staleUrls = [...nodeImageAssetUrls(latestNode)];
      const animation = {
        mode: 'interpolate32',
        chainId,
        keyframeSourceUrl: sourceUrl,
        keyframeUrls: sliced.frameUrls,
        interpolations: Array(7).fill(null),
        frameUrls: sliced.frameUrls,
        frameCount: 8,
        totalFrames: 32,
        fps: normalizeFps(fps, 8),
        templateId: templateId || null,
        templateContent: typeof templateContent === 'string' ? templateContent : '',
        userPrompt: typeof userPrompt === 'string' ? userPrompt : '',
      };
      latestNode.imageUrl = animation.keyframeUrls[0] || sourceUrl;
      latestNode.imagePrompt = animation.userPrompt || prompt;
      latestNode.animation = animation;
      return {
        node: structuredClone(latestNode),
        animation: structuredClone(animation),
        staleUrls,
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);
    res.json({
      imageUrl: replacement.node.imageUrl,
      animation: replacement.animation,
      node: replacement.node,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate-interpolation/gap', async (req, res, next) => {
  try {
    const { nodeId, provider, model, prompt, size, referenceUrls, chainId } = req.body;
    const gapIndex = Number(req.body.gapIndex);
    if (!nodeId || !provider || !prompt || !chainId) {
      return res.status(400).json({ error: 'nodeId, provider, prompt, and chainId are required' });
    }
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex > 6) {
      return res.status(400).json({ error: 'gapIndex must be between 0 and 6' });
    }
    const timeline = await readTimeline();
    const node = findNode(timeline, nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    const animation =
      node.animation?.mode === 'interpolate32' && node.animation.chainId === chainId
        ? node.animation
        : null;
    if (!animation?.keyframeUrls?.[gapIndex + 1]) {
      return res.status(409).json({ error: '关键帧尚未准备好或任务已被替换' });
    }
    if (animation.interpolations?.[gapIndex]) {
      const completedGaps = animation.interpolations.filter(Boolean).length;
      return res.json({
        reused: true,
        gapIndex,
        completedGaps,
        complete: completedGaps === 7,
        imageUrl: node.imageUrl,
        animation,
        node,
      });
    }

    const userReferenceUrls = Array.isArray(referenceUrls) ? referenceUrls.filter(Boolean) : [];
    const startUrl = animation.keyframeUrls[gapIndex];
    const endUrl = animation.keyframeUrls[gapIndex + 1];
    const allReferenceUrls = [...userReferenceUrls, startUrl, endUrl];
    const startAlias = `@${allReferenceUrls.length - 1}`;
    const endAlias = `@${allReferenceUrls.length}`;
    const references = await loadReferences(allReferenceUrls);
    const finalPrompt =
      `${prompt}\n\nINTERPOLATION REQUIREMENT: ${startAlias} is the exact start keyframe and ` +
      `${endAlias} is the exact end keyframe. Generate four NEW chronological in-between frames, ` +
      `strictly after ${startAlias} and before ${endAlias}. Do not repeat either endpoint. ` +
      'Keep identity, clothing, environment, lighting, camera, and motion direction consistent.';
    const p = getProvider(provider);
    const result = await p.generate({
      model,
      prompt: finalPrompt,
      size: size || '1024x1024',
      references,
    });
    const ext = result.ext || (result.mime?.includes('jpeg') ? 'jpg' : 'png');
    const sourceUrl = await saveImageBuffer(nodeId, result.buffer, ext);
    const sliced = await sliceFlipbookSheet(result.buffer, { columns: 2, rows: 2, nodeId });
    const interpolation = {
      gapIndex,
      sourceUrl,
      frameUrls: sliced.frameUrls,
      prompt: finalPrompt,
      startUrl,
      endUrl,
      createdAt: new Date().toISOString(),
    };

    const update = await mutateTimeline((latestTimeline) => {
      const latestNode = findNode(latestTimeline, nodeId);
      const latestAnimation =
        latestNode?.animation?.mode === 'interpolate32' &&
        latestNode.animation.chainId === chainId
          ? latestNode.animation
          : null;
      if (!latestAnimation) throw new Error('Interpolation task changed while generating');
      const interpolations = [...(latestAnimation.interpolations || Array(7).fill(null))];
      const duplicate = Boolean(interpolations[gapIndex]);
      if (!duplicate) interpolations[gapIndex] = interpolation;
      latestAnimation.interpolations = interpolations;
      latestAnimation.frameUrls = assembleInterpolatedFrames(
        latestAnimation.keyframeUrls,
        interpolations,
      );
      latestAnimation.frameCount = latestAnimation.frameUrls.length;
      latestNode.animation = latestAnimation;
      const completedGaps = interpolations.filter(Boolean).length;
      return {
        duplicate,
        node: structuredClone(latestNode),
        animation: structuredClone(latestAnimation),
        completedGaps,
        staleUrls: duplicate ? [sourceUrl, ...sliced.frameUrls] : [],
        referencedUrls: [...timelineReferencedImageUrls(latestTimeline)],
      };
    });
    await cleanupReplacedImages(update.staleUrls, update.referencedUrls);
    res.json({
      reused: update.duplicate,
      gapIndex,
      completedGaps: update.completedGaps,
      complete: update.completedGaps === 7,
      imageUrl: update.node.imageUrl,
      animation: update.animation,
      node: update.node,
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
    await cleanupReplacedImages(replacement.staleUrls, replacement.referencedUrls);

    res.json({ imageUrl, node: replacement.node });
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
