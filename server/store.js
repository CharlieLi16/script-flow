import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TIMELINE_PATH = path.join(DATA_DIR, 'timeline.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

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

export function assignSides(nodes) {
  return nodes.map((node, index) => ({
    ...node,
    side: index % 2 === 0 ? 'up' : 'down',
  }));
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
