import {
  assignSides,
  createCaptionId,
  createGeneratedAssetId,
  createLibraryId,
  createNodeId,
  createPromptId,
  ensureAnchoredDefaults,
  migrateLegacyCaptions,
  normalizeAnimationPatch,
  normalizeCaption,
  nodeImageAssetUrls,
  timelineReferencedImageUrls,
} from './timeline-utils.js';
import {
  extFromFile,
  getAssetBlob,
  makeImagePath,
  makeRefPath,
  storeAssetBlob,
  storeAssetFromFile,
  storeAssetFromUrl,
} from './assets.js';
import {
  getProject,
  saveProjectData,
  updateProject,
} from './projects.js';

let activeProjectId = null;
let mutationQueue = Promise.resolve();

function queueMutation(fn) {
  const task = mutationQueue.then(fn);
  mutationQueue = task.catch(() => {});
  return task;
}

export function setActiveProjectId(projectId) {
  activeProjectId = projectId;
}

export function getActiveProjectId() {
  return activeProjectId;
}

async function loadProject() {
  if (!activeProjectId) throw new Error('未选择项目');
  const project = await getProject(activeProjectId);
  if (!project) throw new Error('项目不存在');
  return project;
}

async function persist(project) {
  await saveProjectData(activeProjectId, {
    timeline: project.timeline,
    library: project.library,
    promptLibrary: project.promptLibrary,
    generatedAssets: project.generatedAssets,
  });
  return project;
}

async function mutateProject(mutator) {
  return queueMutation(async () => {
    const project = await loadProject();
    const result = await mutator(project);
    await persist(project);
    return result;
  });
}

async function copyLocalImageToRefs(projectId, imageUrl) {
  const blob = await getAssetBlob(projectId, imageUrl);
  if (!blob) throw new Error('Only local images can be added to the reference library');
  const ext = imageUrl.split('.').pop()?.split('?')[0] || 'png';
  const id = createLibraryId();
  const newUrl = makeRefPath(id, ext);
  await storeAssetBlob(projectId, newUrl, blob);
  return { id, imageUrl: newUrl };
}

// --- Timeline ---

export async function getTimeline() {
  const project = await loadProject();
  const timeline = project.timeline;
  const normalized = assignSides(timeline.nodes);
  const captionsChanged = migrateLegacyCaptions(timeline);
  timeline.nodes = normalized;
  if (captionsChanged || JSON.stringify(normalized) !== JSON.stringify(project.timeline.nodes)) {
    await persist(project);
  }
  return structuredClone(timeline);
}

export async function putTimeline(body) {
  return mutateProject(async (project) => {
    const { title, nodes, captions } = body;
    if (title !== undefined) project.timeline.title = title;
    if (nodes !== undefined) project.timeline.nodes = assignSides(nodes);
    if (Array.isArray(captions)) {
      project.timeline.captions = captions
        .map((c) => ({ ...c, ...normalizeCaption(c, c) }))
        .filter((c) => c.text)
        .sort((a, b) => a.startMs - b.startMs);
    }
    return structuredClone(project.timeline);
  });
}

// --- Captions ---

export async function postCaption(body) {
  return mutateProject(async (project) => {
    const normalized = normalizeCaption(body || {});
    if (!normalized.text) throw new Error('字幕内容不能为空');
    if (!Array.isArray(project.timeline.captions)) migrateLegacyCaptions(project.timeline);
    const now = new Date().toISOString();
    const created = { id: createCaptionId(), ...normalized, createdAt: now, updatedAt: now };
    project.timeline.captions.push(created);
    project.timeline.captions.sort((a, b) => a.startMs - b.startMs);
    return structuredClone(created);
  });
}

export async function patchCaption(id, body) {
  return mutateProject(async (project) => {
    if (!Array.isArray(project.timeline.captions)) migrateLegacyCaptions(project.timeline);
    const current = project.timeline.captions.find((e) => e.id === id);
    if (!current) throw new Error('字幕不存在');
    const normalized = normalizeCaption(body || {}, current);
    if (!normalized.text) throw new Error('字幕内容不能为空');
    Object.assign(current, normalized, { updatedAt: new Date().toISOString() });
    project.timeline.captions.sort((a, b) => a.startMs - b.startMs);
    return structuredClone(current);
  });
}

export async function deleteCaption(id) {
  return mutateProject(async (project) => {
    if (!Array.isArray(project.timeline.captions)) migrateLegacyCaptions(project.timeline);
    const index = project.timeline.captions.findIndex((e) => e.id === id);
    if (index < 0) throw new Error('字幕不存在');
    project.timeline.captions.splice(index, 1);
    return { ok: true };
  });
}

// --- Nodes ---

export async function postNode(body) {
  return mutateProject(async (project) => {
    const node = {
      id: createNodeId(),
      title: body.title || '新节点',
      timeLabel: '',
      script: body.script || '',
      imageUrl: '',
      imagePrompt: '',
      referenceUrls: [],
      durationMs: Number.isFinite(Number(body.durationMs))
        ? Math.min(600000, Math.max(500, Number(body.durationMs)))
        : 1000,
      subtitle: '',
      cameraPreset: 'static',
      includeInPreview: body.includeInPreview !== false,
    };
    const index = body.index;
    if (typeof index === 'number' && index >= 0 && index <= project.timeline.nodes.length) {
      project.timeline.nodes.splice(index, 0, node);
    } else {
      project.timeline.nodes.push(node);
    }
    project.timeline.nodes = assignSides(project.timeline.nodes);
    return structuredClone(project.timeline.nodes.find((n) => n.id === node.id));
  });
}

export async function patchNode(id, body) {
  return mutateProject(async (project) => {
    const node = project.timeline.nodes.find((n) => n.id === id);
    if (!node) throw new Error('Node not found');
    const fields = [
      'title', 'script', 'imageUrl', 'imagePrompt', 'referenceUrls',
      'durationMs', 'subtitle', 'cameraPreset', 'includeInPreview', 'animation',
    ];
    for (const field of fields) {
      if (body[field] === undefined) continue;
      if (field === 'durationMs') {
        const duration = Number(body[field]);
        node[field] = Number.isFinite(duration) ? Math.min(600000, Math.max(500, duration)) : 2000;
      } else if (field === 'includeInPreview') {
        node[field] = body[field] !== false;
      } else if (field === 'animation') {
        if (body.animation === null) delete node.animation;
        else node.animation = normalizeAnimationPatch(node.animation, body.animation);
      } else {
        node[field] = body[field];
      }
    }
    project.timeline.nodes = assignSides(project.timeline.nodes);
    return structuredClone(node);
  });
}

export async function deleteNode(id) {
  return mutateProject(async (project) => {
    const index = project.timeline.nodes.findIndex((n) => n.id === id);
    if (index < 0) throw new Error('Node not found');
    project.timeline.nodes.splice(index, 1);
    project.timeline.nodes = assignSides(project.timeline.nodes);
    return { ok: true };
  });
}

export async function reorderNodes(order) {
  return mutateProject(async (project) => {
    if (!Array.isArray(order)) throw new Error('order must be an array of node ids');
    const map = new Map(project.timeline.nodes.map((n) => [n.id, n]));
    const reordered = order.map((nodeId) => map.get(nodeId)).filter(Boolean);
    if (reordered.length !== project.timeline.nodes.length) {
      throw new Error('Invalid reorder: ids mismatch');
    }
    project.timeline.nodes = assignSides(reordered);
    return structuredClone(project.timeline);
  });
}

export async function uploadNodeImage(nodeId, file) {
  const ext = extFromFile(file);
  const imageUrl = makeImagePath(nodeId, ext);
  await storeAssetFromFile(activeProjectId, imageUrl, file);
  return patchNode(nodeId, { imageUrl });
}

// --- Library ---

export async function getLibrary() {
  const project = await loadProject();
  return structuredClone(project.library);
}

export async function postLibraryItem({ name, file, imageUrl }) {
  return mutateProject(async (project) => {
    const itemName = (name || '未命名参考').trim() || '未命名参考';
    let id;
    let url;
    if (file) {
      id = createLibraryId();
      const ext = extFromFile(file);
      url = makeRefPath(id, ext);
      await storeAssetFromFile(activeProjectId, url, file);
    } else if (imageUrl) {
      ({ id, imageUrl: url } = await copyLocalImageToRefs(activeProjectId, imageUrl));
    } else {
      throw new Error('image file or imageUrl required');
    }
    const item = { id, name: itemName, imageUrl: url, createdAt: new Date().toISOString() };
    project.library.items.unshift(item);
    return structuredClone(item);
  });
}

export async function patchLibraryItem(id, body) {
  return mutateProject(async (project) => {
    const item = project.library.items.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    if (body.name !== undefined) item.name = body.name.trim() || item.name;
    return structuredClone(item);
  });
}

export async function deleteLibraryItem(id) {
  return mutateProject(async (project) => {
    const before = project.library.items.length;
    project.library.items = project.library.items.filter((i) => i.id !== id);
    if (project.library.items.length === before) throw new Error('Item not found');
    return { ok: true };
  });
}

export async function uploadRef(file) {
  const id = createLibraryId();
  const ext = extFromFile(file);
  const imageUrl = makeRefPath(id, ext);
  await storeAssetFromFile(activeProjectId, imageUrl, file);
  return { imageUrl };
}

// --- Prompts ---

export async function getPromptLibrary() {
  const project = await loadProject();
  const library = project.promptLibrary?.items
    ? project.promptLibrary
    : { items: [] };
  ensureAnchoredDefaults(library);
  if (!project.promptLibrary?.modeMap) {
    project.promptLibrary = library;
    await persist(project);
  }
  return structuredClone(library);
}

export async function postPrompt(body) {
  return mutateProject(async (project) => {
    const name = String(body?.name || '').trim();
    const content = String(body?.content || '').trim();
    if (!name || !content) throw new Error('名称和 Prompt 内容不能为空');
    if (!project.promptLibrary) project.promptLibrary = { items: [] };
    ensureAnchoredDefaults(project.promptLibrary);
    const now = new Date().toISOString();
    const item = { id: createPromptId(), name, content, createdAt: now, updatedAt: now };
    project.promptLibrary.items.unshift(item);
    return structuredClone(item);
  });
}

export async function patchPrompt(id, body) {
  return mutateProject(async (project) => {
    ensureAnchoredDefaults(project.promptLibrary);
    const item = project.promptLibrary.items.find((e) => e.id === id);
    if (!item) throw new Error('提词不存在');
    const name = body?.name === undefined ? item.name : String(body.name).trim();
    const content = body?.content === undefined ? item.content : String(body.content).trim();
    if (!name || !content) throw new Error('名称和 Prompt 内容不能为空');
    item.name = name;
    item.content = content;
    item.updatedAt = new Date().toISOString();
    return structuredClone(item);
  });
}

export async function deletePrompt(id) {
  return mutateProject(async (project) => {
    ensureAnchoredDefaults(project.promptLibrary);
    const before = project.promptLibrary.items.length;
    project.promptLibrary.items = project.promptLibrary.items.filter((e) => e.id !== id);
    if (project.promptLibrary.items.length === before) throw new Error('提词不存在');
    return { ok: true };
  });
}

// --- Generated assets ---

function generatedAssetUrls(asset) {
  const urls = new Set();
  const add = (url) => { if (url?.startsWith('/images/')) urls.add(url); };
  add(asset?.imageUrl);
  add(asset?.coverUrl);
  const animation = asset?.animation;
  add(animation?.sourceUrl);
  for (const url of animation?.frameUrls || []) add(url);
  return [...urls];
}

export async function getGeneratedAssets() {
  const project = await loadProject();
  const repo = project.generatedAssets || { items: [], initialized: false };
  if (!repo.initialized) {
    const now = new Date().toISOString();
    for (const node of project.timeline.nodes) {
      if (!node?.imageUrl) continue;
      const animation = node.animation ? structuredClone(node.animation) : null;
      const exists = repo.items.some(
        (item) => item.coverUrl === node.imageUrl ||
          (animation?.sourceUrl && item.animation?.sourceUrl === animation.sourceUrl),
      );
      if (exists) continue;
      repo.items.push({
        id: createGeneratedAssetId(),
        type: animation ? 'animation' : 'image',
        name: node.title || (animation ? '未命名动画' : '未命名图片'),
        nodeId: node.id,
        coverUrl: node.imageUrl,
        imageUrl: animation ? null : node.imageUrl,
        animation,
        frameCount: animation?.frameUrls?.length || 1,
        fps: animation?.fps || null,
        prompt: node.imagePrompt || '',
        provider: '', model: '', size: '',
        source: 'timeline-import',
        generationKey: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    repo.initialized = true;
    project.generatedAssets = repo;
    await persist(project);
  }
  return structuredClone(repo);
}

export async function postGeneratedAssetFromFrame(body) {
  return mutateProject(async (project) => {
    const { imageUrl, name, nodeId, prompt, sourceAssetId, frameIndex } = body;
    if (!imageUrl?.startsWith('/images/')) throw new Error('Generated image asset requires a local image');
    const now = new Date().toISOString();
    const item = {
      id: createGeneratedAssetId(),
      type: 'image',
      name: String(name || '已保存帧').trim() || '已保存帧',
      nodeId: nodeId || null,
      coverUrl: imageUrl,
      imageUrl,
      animation: null,
      frameCount: 1,
      fps: null,
      prompt: String(prompt || ''),
      provider: '', model: '', size: '',
      source: 'saved-frame',
      sourceAssetId: sourceAssetId || null,
      frameIndex: Number.isInteger(frameIndex) ? frameIndex : null,
      generationKey: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!project.generatedAssets) project.generatedAssets = { items: [], initialized: true };
    project.generatedAssets.items.unshift(item);
    return structuredClone(item);
  });
}

export async function patchGeneratedAsset(id, body) {
  return mutateProject(async (project) => {
    const item = project.generatedAssets.items.find((e) => e.id === id);
    if (!item) throw new Error('Asset not found');
    if (body.name !== undefined) item.name = body.name.trim() || item.name;
    item.updatedAt = new Date().toISOString();
    return structuredClone(item);
  });
}

export async function applyGeneratedAsset(id, body) {
  return mutateProject(async (project) => {
    const item = project.generatedAssets.items.find((e) => e.id === id);
    if (!item) throw new Error('Asset not found');
    const node = project.timeline.nodes.find((n) => n.id === body.nodeId);
    if (!node) throw new Error('Node not found');
    if (item.type === 'animation' && item.animation) {
      node.imageUrl = item.coverUrl;
      node.imagePrompt = item.prompt || node.imagePrompt;
      node.animation = structuredClone(item.animation);
    } else {
      node.imageUrl = item.imageUrl || item.coverUrl;
      node.imagePrompt = item.prompt || node.imagePrompt;
      delete node.animation;
    }
    project.timeline.nodes = assignSides(project.timeline.nodes);
    return { node: structuredClone(node), asset: structuredClone(item) };
  });
}

export async function deleteGeneratedAsset(id) {
  return mutateProject(async (project) => {
    const index = project.generatedAssets.items.findIndex((e) => e.id === id);
    if (index < 0) throw new Error('Asset not found');
    project.generatedAssets.items.splice(index, 1);
    return { ok: true };
  });
}

export async function upsertGeneratedAssetFromNode(node, meta = {}) {
  return mutateProject(async (project) => {
    if (!node?.imageUrl) throw new Error('Generated asset requires an image');
    if (!project.generatedAssets) project.generatedAssets = { items: [], initialized: true };
    const now = new Date().toISOString();
    const animation = node.animation ? structuredClone(node.animation) : null;
    const existing = meta.generationKey
      ? project.generatedAssets.items.find((i) => i.generationKey === meta.generationKey)
      : null;
    const item = existing || { id: createGeneratedAssetId(), createdAt: now };
    Object.assign(item, {
      type: animation ? 'animation' : 'image',
      name: node.title || (animation ? '未命名动画' : '未命名图片'),
      nodeId: node.id,
      coverUrl: node.imageUrl,
      imageUrl: animation ? null : node.imageUrl,
      animation,
      frameCount: animation?.frameUrls?.length || 1,
      fps: animation?.fps || null,
      prompt: meta.prompt || node.imagePrompt || '',
      provider: meta.provider || '',
      model: meta.model || '',
      size: meta.size || '',
      generationKey: meta.generationKey || null,
      updatedAt: now,
    });
    if (!existing) project.generatedAssets.items.unshift(item);
    return structuredClone(item);
  });
}

export async function storeGeneratedImage(nodeId, blob, ext = 'png') {
  const imageUrl = makeImagePath(nodeId, ext);
  await storeAssetBlob(activeProjectId, imageUrl, blob);
  return imageUrl;
}

export async function storeGeneratedImages(entries) {
  const urls = [];
  for (const { path: logicalPath, blob, mime } of entries) {
    await storeAssetBlob(activeProjectId, logicalPath, blob, mime);
    urls.push(logicalPath);
  }
  return urls;
}

export async function importSeedAsset(seedUrl, logicalPath) {
  await storeAssetFromUrl(activeProjectId, logicalPath, seedUrl);
}

export async function getProjectSnapshot() {
  const project = await loadProject();
  return structuredClone({
    timeline: project.timeline,
    library: project.library,
    promptLibrary: project.promptLibrary,
    generatedAssets: project.generatedAssets,
  });
}

export async function importProjectSnapshot(snapshot) {
  return mutateProject(async (project) => {
    if (snapshot.timeline) project.timeline = snapshot.timeline;
    if (snapshot.library) project.library = snapshot.library;
    if (snapshot.promptLibrary) {
      project.promptLibrary = snapshot.promptLibrary;
      ensureAnchoredDefaults(project.promptLibrary);
    }
    if (snapshot.generatedAssets) project.generatedAssets = snapshot.generatedAssets;
    return structuredClone(project);
  });
}
