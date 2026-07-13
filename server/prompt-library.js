import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROMPTS_PATH = path.join(DATA_DIR, 'prompts.json');
const EMPTY_LIBRARY = { items: [] };

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function createPromptId() {
  return `prompt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function readPromptLibrary() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(PROMPTS_PATH, 'utf8');
    const library = JSON.parse(raw);
    return Array.isArray(library?.items) ? library : structuredClone(EMPTY_LIBRARY);
  } catch {
    await writePromptLibrary(EMPTY_LIBRARY);
    return structuredClone(EMPTY_LIBRARY);
  }
}

export async function writePromptLibrary(library) {
  await ensureDataDir();
  await fs.writeFile(PROMPTS_PATH, JSON.stringify(library, null, 2), 'utf8');
  return library;
}
