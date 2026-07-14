import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const ASSETS_PATH = path.join(DATA_DIR, 'generated-assets.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const EMPTY_REPOSITORY = { items: [], initialized: false };
const HISTORY_IMPORT_VERSION = 1;
const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g|webp)$/i;
let mutationQueue = Promise.resolve();

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function createGeneratedAssetId() {
  return `asset${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function readGeneratedAssets() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(ASSETS_PATH, 'utf8');
    const repository = JSON.parse(raw);
    return Array.isArray(repository?.items) ? repository : structuredClone(EMPTY_REPOSITORY);
  } catch {
    await writeGeneratedAssets(EMPTY_REPOSITORY);
    return structuredClone(EMPTY_REPOSITORY);
  }
}

export async function writeGeneratedAssets(repository) {
  await ensureDataDir();
  await fs.writeFile(ASSETS_PATH, JSON.stringify(repository, null, 2), 'utf8');
  return repository;
}

export function mutateGeneratedAssets(mutator) {
  const mutation = mutationQueue.then(async () => {
    const repository = await readGeneratedAssets();
    const result = await mutator(repository);
    await writeGeneratedAssets(repository);
    return result;
  });
  mutationQueue = mutation.catch(() => {});
  return mutation;
}

export function generatedAssetUrls(asset) {
  const urls = new Set();
  const add = (url) => {
    if (url?.startsWith('/images/')) urls.add(url);
  };
  add(asset?.imageUrl);
  add(asset?.coverUrl);
  const animation = asset?.animation;
  add(animation?.sourceUrl);
  for (const url of animation?.sourceUrls || []) add(url);
  add(animation?.keyframeSourceUrl);
  for (const url of animation?.frameUrls || []) add(url);
  for (const url of animation?.keyframeUrls || []) add(url);
  for (const batch of animation?.batches || []) {
    add(batch?.sourceUrl);
    add(batch?.anchorUrl);
    for (const url of batch?.frameUrls || []) add(url);
  }
  for (const segment of animation?.segments || []) {
    if (!segment) continue;
    add(segment?.sourceUrl);
    for (const url of segment?.sourceUrls || []) add(url);
    add(segment?.anchorUrl);
    add(segment?.startAnchorUrl);
    add(segment?.endAnchorUrl);
    for (const url of segment?.frameUrls || []) add(url);
    for (const batch of segment?.batches || []) {
      add(batch?.sourceUrl);
      add(batch?.anchorUrl);
      for (const url of batch?.frameUrls || []) add(url);
    }
  }
  for (const interpolation of animation?.interpolations || []) {
    add(interpolation?.sourceUrl);
    for (const url of interpolation?.frameUrls || []) add(url);
  }
  return urls;
}

export function generatedAssetsReferencedUrls(repository) {
  const urls = new Set();
  for (const item of repository?.items || []) {
    for (const url of generatedAssetUrls(item)) urls.add(url);
  }
  return urls;
}

function inferredGrid(frameCount) {
  if (frameCount === 4) return { columns: 2, rows: 2 };
  if (frameCount === 8) return { columns: 4, rows: 2 };
  if (frameCount === 9) return { columns: 3, rows: 3 };
  if (frameCount === 16) return { columns: 4, rows: 4 };
  return { columns: null, rows: null };
}

function sourceFileInfo(filename) {
  const match = filename.match(/^(.*)-(\d+)\.(?:png|jpe?g|webp)$/i);
  if (!match) return null;
  return { nodeId: match[1], timestamp: Number(match[2]) };
}

function frameDirectoryInfo(dirname) {
  const separator = dirname.lastIndexOf('-');
  if (separator < 1) return null;
  const timestamp = Number.parseInt(dirname.slice(separator + 1), 36);
  if (!Number.isFinite(timestamp)) return null;
  return { nodeId: dirname.slice(0, separator), timestamp };
}

function imageUrl(...parts) {
  return `/images/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
}

function recoveredName(nodeTitle, type, timestamp) {
  const date = new Date(timestamp);
  const stamp = Number.isNaN(date.getTime())
    ? ''
    : ` · ${date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })}`;
  return `${nodeTitle || `历史${type}`}${stamp}`;
}

export async function discoverHistoricalGeneratedAssets(repository, nodes = []) {
  const indexedUrls = generatedAssetsReferencedUrls(repository);
  for (const node of nodes) {
    for (const url of generatedAssetUrls({
      coverUrl: node?.imageUrl,
      animation: node?.animation,
    })) indexedUrls.add(url);
  }

  let entries;
  try {
    entries = await fs.readdir(IMAGES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodeTitles = new Map(nodes.map((node) => [node.id, node.title || '']));
  const sources = [];
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE_FILE_PATTERN.test(entry.name)) continue;
    const url = imageUrl(entry.name);
    if (indexedUrls.has(url)) continue;
    const info = sourceFileInfo(entry.name);
    const stat = await fs.stat(path.join(IMAGES_DIR, entry.name));
    sources.push({
      filename: entry.name,
      url,
      nodeId: info?.nodeId || null,
      timestamp: info?.timestamp || stat.mtimeMs,
      createdAt: stat.mtime.toISOString(),
    });
  }

  const frameRoot = path.join(IMAGES_DIR, 'frames');
  let frameEntries = [];
  try {
    frameEntries = await fs.readdir(frameRoot, { withFileTypes: true });
  } catch {
    frameEntries = [];
  }
  const frameGroups = [];
  for (const entry of frameEntries) {
    if (!entry.isDirectory() || /^(?:test|clarity)/i.test(entry.name)) continue;
    const info = frameDirectoryInfo(entry.name);
    if (!info) continue;
    const filenames = (await fs.readdir(path.join(frameRoot, entry.name)))
      .filter((filename) => IMAGE_FILE_PATTERN.test(filename))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const frameUrls = filenames.map((filename) => imageUrl('frames', entry.name, filename));
    if (frameUrls.length < 2 || frameUrls.some((url) => indexedUrls.has(url))) continue;
    frameGroups.push({ ...info, dirname: entry.name, frameUrls });
  }

  const recovered = [];
  const usedSources = new Set();
  for (const group of frameGroups.sort((a, b) => a.timestamp - b.timestamp)) {
    const source = sources
      .filter((item) => item.nodeId === group.nodeId && !usedSources.has(item.url))
      .map((item) => ({ item, distance: Math.abs(item.timestamp - group.timestamp) }))
      .filter(({ distance }) => distance <= 5 * 60 * 1000)
      .sort((a, b) => a.distance - b.distance)[0]?.item;
    if (source) usedSources.add(source.url);
    const createdAt = source?.createdAt || new Date(group.timestamp).toISOString();
    const grid = inferredGrid(group.frameUrls.length);
    recovered.push({
      id: createGeneratedAssetId(),
      type: 'animation',
      name: recoveredName(nodeTitles.get(group.nodeId), '动画', group.timestamp),
      nodeId: group.nodeId,
      coverUrl: group.frameUrls[0],
      imageUrl: null,
      animation: {
        mode: 'recovered-history',
        sourceUrl: source?.url || null,
        frameUrls: group.frameUrls,
        frameCount: group.frameUrls.length,
        columns: grid.columns,
        rows: grid.rows,
        fps: 4,
        recovered: true,
      },
      frameCount: group.frameUrls.length,
      fps: 4,
      prompt: '',
      provider: '',
      model: '',
      size: '',
      source: 'history-import',
      generationKey: null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  for (const source of sources) {
    if (usedSources.has(source.url)) continue;
    recovered.push({
      id: createGeneratedAssetId(),
      type: 'image',
      name: recoveredName(nodeTitles.get(source.nodeId), '图片', source.timestamp),
      nodeId: source.nodeId,
      coverUrl: source.url,
      imageUrl: source.url,
      animation: null,
      frameCount: 1,
      fps: null,
      prompt: '',
      provider: '',
      model: '',
      size: '',
      source: 'history-import',
      generationKey: null,
      createdAt: source.createdAt,
      updatedAt: source.createdAt,
    });
  }

  return recovered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function initializeGeneratedAssets(nodes = []) {
  return mutateGeneratedAssets(async (repository) => {
    const now = new Date().toISOString();
    if (!repository.initialized) {
      for (const node of nodes) {
        if (!node?.imageUrl) continue;
        const animation = node.animation ? structuredClone(node.animation) : null;
        const alreadyStored = repository.items.some(
          (item) =>
            item.coverUrl === node.imageUrl ||
            (animation?.sourceUrl && item.animation?.sourceUrl === animation.sourceUrl),
        );
        if (alreadyStored) continue;
        repository.items.push({
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
          provider: '',
          model: '',
          size: '',
          source: 'timeline-import',
          generationKey: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      repository.initialized = true;
    }

    if ((repository.historyImportVersion || 0) < HISTORY_IMPORT_VERSION) {
      const recovered = await discoverHistoricalGeneratedAssets(repository, nodes);
      repository.items.push(...recovered);
      repository.historyImportVersion = HISTORY_IMPORT_VERSION;
      repository.historyImportedCount = recovered.length;
      repository.historyImportedAt = now;
    }
    return structuredClone(repository);
  });
}

export async function upsertGeneratedAsset({
  node,
  provider,
  model,
  size,
  prompt,
  generationKey = null,
}) {
  if (!node?.imageUrl) throw new Error('Generated asset requires an image');
  return mutateGeneratedAssets((repository) => {
    const now = new Date().toISOString();
    const animation = node.animation ? structuredClone(node.animation) : null;
    const existing = generationKey
      ? repository.items.find((item) => item.generationKey === generationKey)
      : null;
    const item = existing || {
      id: createGeneratedAssetId(),
      createdAt: now,
    };
    Object.assign(item, {
      type: animation ? 'animation' : 'image',
      name: node.title || (animation ? '未命名动画' : '未命名图片'),
      nodeId: node.id,
      coverUrl: node.imageUrl,
      imageUrl: animation ? null : node.imageUrl,
      animation,
      frameCount: animation?.frameUrls?.length || 1,
      fps: animation?.fps || null,
      prompt: prompt || node.imagePrompt || '',
      provider: provider || '',
      model: model || '',
      size: size || '',
      generationKey,
      updatedAt: now,
    });
    if (!existing) repository.items.unshift(item);
    return structuredClone(item);
  });
}

export async function createGeneratedImageAsset({
  imageUrl,
  name,
  nodeId = null,
  prompt = '',
  source = 'saved-frame',
  sourceAssetId = null,
  frameIndex = null,
}) {
  if (!imageUrl?.startsWith('/images/')) {
    throw new Error('Generated image asset requires a local image');
  }
  return mutateGeneratedAssets((repository) => {
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
      provider: '',
      model: '',
      size: '',
      source,
      sourceAssetId: sourceAssetId || null,
      frameIndex: Number.isInteger(frameIndex) ? frameIndex : null,
      generationKey: null,
      createdAt: now,
      updatedAt: now,
    };
    repository.items.unshift(item);
    return structuredClone(item);
  });
}

export async function deleteGeneratedAsset(id) {
  return mutateGeneratedAssets((repository) => {
    const index = repository.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [removed] = repository.items.splice(index, 1);
    return {
      removed: structuredClone(removed),
      repository: structuredClone(repository),
    };
  });
}
