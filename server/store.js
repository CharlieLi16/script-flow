import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TIMELINE_PATH = path.join(DATA_DIR, 'timeline.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const FRAMES_DIR = path.join(IMAGES_DIR, 'frames');
let timelineMutationQueue = Promise.resolve();

const DEFAULT_TIMELINE = {
  title: 'Demo 视频剧本',
  nodes: [],
};

export function getImagesDir() {
  return IMAGES_DIR;
}

export function getRoot() {
  return ROOT;
}

async function ensureDataDir() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.mkdir(FRAMES_DIR, { recursive: true });
}

export async function readTimeline() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(TIMELINE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    await writeTimeline(DEFAULT_TIMELINE);
    return structuredClone(DEFAULT_TIMELINE);
  }
}

export async function writeTimeline(timeline) {
  await ensureDataDir();
  await fs.writeFile(TIMELINE_PATH, JSON.stringify(timeline, null, 2), 'utf8');
  return timeline;
}

export function mutateTimeline(mutator) {
  const mutation = timelineMutationQueue.then(async () => {
    const timeline = await readTimeline();
    const result = await mutator(timeline);
    await writeTimeline(timeline);
    return result;
  });
  timelineMutationQueue = mutation.catch(() => {});
  return mutation;
}

export function normalizeDurationMs(value, fallback = 2000) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return fallback;
  return Math.min(600000, Math.max(500, Math.round(duration)));
}

export function formatTimeLabel(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Assign sides and derive timeLabel from cumulative durationMs. */
export function assignSides(nodes) {
  let cursor = 0;
  return nodes.map((node, index) => {
    const durationMs = normalizeDurationMs(node.durationMs);
    const timeLabel = formatTimeLabel(cursor);
    cursor += durationMs;
    return {
      ...node,
      durationMs,
      timeLabel,
      side: index % 2 === 0 ? 'up' : 'down',
    };
  });
}

export function createNodeId() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function saveImageBuffer(nodeId, buffer, ext = 'png') {
  await ensureDataDir();
  const filename = `${nodeId}-${Date.now()}.${ext}`;
  const filepath = path.join(IMAGES_DIR, filename);
  await fs.writeFile(filepath, buffer);
  return `/images/${filename}`;
}

export function imageFilePathFromUrl(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('/images/')) return null;
  const pathname = new URL(imageUrl, 'http://local').pathname;
  const relativePath = decodeURIComponent(pathname.slice('/images/'.length));
  if (!relativePath) return null;
  const filepath = path.resolve(IMAGES_DIR, relativePath);
  const rootPrefix = `${path.resolve(IMAGES_DIR)}${path.sep}`;
  if (!filepath.startsWith(rootPrefix)) {
    throw new Error('Invalid image path');
  }
  return filepath;
}

export function nodeImageAssetUrls(node) {
  const urls = new Set();
  if (node?.imageUrl?.startsWith('/images/')) urls.add(node.imageUrl);
  if (node?.animation?.sourceUrl?.startsWith('/images/')) urls.add(node.animation.sourceUrl);
  for (const url of node?.animation?.frameUrls || []) {
    if (url?.startsWith('/images/')) urls.add(url);
  }
  for (const segment of node?.animation?.segments || []) {
    if (segment?.sourceUrl?.startsWith('/images/')) urls.add(segment.sourceUrl);
    for (const url of segment?.frameUrls || []) {
      if (url?.startsWith('/images/')) urls.add(url);
    }
  }
  if (node?.animation?.keyframeSourceUrl?.startsWith('/images/')) {
    urls.add(node.animation.keyframeSourceUrl);
  }
  for (const url of node?.animation?.keyframeUrls || []) {
    if (url?.startsWith('/images/')) urls.add(url);
  }
  for (const interpolation of node?.animation?.interpolations || []) {
    if (interpolation?.sourceUrl?.startsWith('/images/')) urls.add(interpolation.sourceUrl);
    for (const url of interpolation?.frameUrls || []) {
      if (url?.startsWith('/images/')) urls.add(url);
    }
  }
  return urls;
}

export function timelineReferencedImageUrls(timeline) {
  const urls = new Set();
  for (const node of timeline?.nodes || []) {
    for (const url of nodeImageAssetUrls(node)) urls.add(url);
    for (const url of node.referenceUrls || []) {
      if (url?.startsWith('/images/')) urls.add(url);
    }
  }
  return urls;
}

export async function cleanupImageAssets(candidates, referencedUrls = new Set()) {
  const referenced = referencedUrls instanceof Set ? referencedUrls : new Set(referencedUrls);
  const parentDirs = new Set();
  const deleted = [];
  for (const imageUrl of new Set(candidates || [])) {
    if (referenced.has(imageUrl)) continue;
    const filepath = imageFilePathFromUrl(imageUrl);
    if (!filepath) continue;
    await fs.rm(filepath, { force: true });
    deleted.push(imageUrl);
    const parent = path.dirname(filepath);
    if (parent.startsWith(`${FRAMES_DIR}${path.sep}`)) parentDirs.add(parent);
  }
  for (const dir of parentDirs) {
    await fs.rmdir(dir).catch((err) => {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTEMPTY') throw err;
    });
  }
  return deleted;
}

export const INTERPOLATION_KEEP_COUNTS = [4, 3, 3, 4, 3, 3, 4];

export function assembleInterpolatedFrames(keyframeUrls, interpolations) {
  if (!Array.isArray(keyframeUrls) || keyframeUrls.length !== 8) {
    throw new Error('Interpolation workflow requires exactly 8 keyframes');
  }
  const frames = [];
  for (let index = 0; index < keyframeUrls.length; index += 1) {
    frames.push(keyframeUrls[index]);
    if (index >= keyframeUrls.length - 1) continue;
    const generated = interpolations?.[index]?.frameUrls || [];
    frames.push(...generated.slice(0, INTERPOLATION_KEEP_COUNTS[index]));
  }
  return frames;
}

function axisBounds(length, count) {
  const bounds = [];
  for (let i = 0; i <= count; i += 1) {
    bounds.push(Math.floor((length * i) / count));
  }
  return bounds;
}

/**
 * Slice a sprite/flipbook sheet into ordered frames (LTR, top-to-bottom).
 * Uses cumulative pixel bounds so non-divisible sizes do not drop edge pixels.
 * Small cells are upscaled so playback/preview stay readable (especially 16-frame sheets).
 */
export async function sliceFlipbookSheet(buffer, { columns, rows, nodeId, minEdge = 768 }) {
  const cols = Number(columns);
  const rowCount = Number(rows);
  if (!Number.isInteger(cols) || !Number.isInteger(rowCount) || cols < 1 || rowCount < 1) {
    throw new Error('columns and rows must be positive integers');
  }
  if (cols * rowCount > 64) {
    throw new Error('Too many frames: columns × rows must be ≤ 64');
  }

  await ensureDataDir();
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error('无法解码分镜表图片');
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < cols || height < rowCount) {
    throw new Error(`分镜表尺寸过小（${width}×${height}），无法裁成 ${cols}×${rowCount}`);
  }

  const batchId = Date.now().toString(36);
  const relativeDir = `frames/${nodeId}-${batchId}`;
  const absDir = path.join(IMAGES_DIR, relativeDir);
  await fs.mkdir(absDir, { recursive: true });

  const xBounds = axisBounds(width, cols);
  const yBounds = axisBounds(height, rowCount);
  const frameUrls = [];
  const targetMinEdge = Math.max(256, Number(minEdge) || 768);

  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const left = xBounds[col];
      const top = yBounds[row];
      const frameWidth = xBounds[col + 1] - left;
      const frameHeight = yBounds[row + 1] - top;
      const index = row * cols + col;
      const filename = `frame-${String(index).padStart(2, '0')}.png`;
      const filepath = path.join(absDir, filename);

      let pipeline = sharp(buffer).extract({ left, top, width: frameWidth, height: frameHeight });
      const shortEdge = Math.min(frameWidth, frameHeight);
      if (shortEdge > 0 && shortEdge < targetMinEdge) {
        const scale = targetMinEdge / shortEdge;
        pipeline = pipeline.resize(
          Math.round(frameWidth * scale),
          Math.round(frameHeight * scale),
          { kernel: 'lanczos3' },
        );
        // Mild sharpen helps letter edges after upscale without inventing glyphs.
        pipeline = pipeline.sharpen({ sigma: 0.8, m1: 0.8, m2: 0.4 });
      }

      await pipeline.png().toFile(filepath);
      frameUrls.push(`/images/${relativeDir}/${filename}`);
    }
  }

  if (frameUrls.length !== cols * rowCount) {
    throw new Error(`裁切帧数不正确：期望 ${cols * rowCount}，实际 ${frameUrls.length}`);
  }

  return {
    frameUrls,
    frameCount: frameUrls.length,
    columns: cols,
    rows: rowCount,
    sheetWidth: width,
    sheetHeight: height,
    cellWidth: Math.floor(width / cols),
    cellHeight: Math.floor(height / rowCount),
  };
}
