import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { imageFilePathFromUrl } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LIBRARY_PATH = path.join(DATA_DIR, 'library.json');
const REFS_DIR = path.join(DATA_DIR, 'refs');

const DEFAULT_LIBRARY = { items: [] };

export function getRefsDir() {
  return REFS_DIR;
}

async function ensureRefsDir() {
  await fs.mkdir(REFS_DIR, { recursive: true });
}

export function createLibraryId() {
  return `ref${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function readLibrary() {
  await ensureRefsDir();
  try {
    const raw = await fs.readFile(LIBRARY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    await writeLibrary(DEFAULT_LIBRARY);
    return structuredClone(DEFAULT_LIBRARY);
  }
}

export async function writeLibrary(library) {
  await ensureRefsDir();
  await fs.writeFile(LIBRARY_PATH, JSON.stringify(library, null, 2), 'utf8');
  return library;
}

function extFromMime(mime) {
  if (mime?.includes('jpeg')) return 'jpg';
  if (mime?.includes('webp')) return 'webp';
  return 'png';
}

export async function saveRefBuffer(buffer, ext = 'png') {
  await ensureRefsDir();
  const id = createLibraryId();
  const filename = `${id}.${ext}`;
  await fs.writeFile(path.join(REFS_DIR, filename), buffer);
  return { id, imageUrl: `/refs/${filename}` };
}

export async function copyImageToRefs(imageUrl) {
  const filename = path.basename(imageUrl);
  const src = imageUrl.startsWith('/refs/')
    ? path.join(REFS_DIR, filename)
    : imageFilePathFromUrl(imageUrl);
  if (!src) throw new Error('Only local images can be added to the reference library');
  const ext = path.extname(filename).slice(1) || 'png';
  const { id, imageUrl: newUrl } = await saveRefBuffer(await fs.readFile(src), ext);
  return { id, imageUrl: newUrl };
}

export async function loadImageFromUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('Invalid image URL');
  }
  const filename = path.basename(imageUrl);
  const filepath = imageUrl.startsWith('/refs/')
    ? path.join(REFS_DIR, filename)
    : imageFilePathFromUrl(imageUrl);
  if (!filepath) throw new Error('Unsupported image URL');
  const buffer = await fs.readFile(filepath);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return { buffer, mime };
}

export async function loadReferences(urls) {
  if (!urls?.length) return [];
  const refs = [];
  for (const url of urls) {
    refs.push(await loadImageFromUrl(url));
  }
  return refs;
}
