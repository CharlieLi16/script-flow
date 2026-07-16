#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

async function buildSeed() {
  const libraryPath = path.join(ROOT, 'data', 'library.json');
  const promptsPath = path.join(ROOT, 'data', 'prompts.json');
  const outPath = path.join(ROOT, 'seed', 'library-seed.json');

  let library = { items: [] };
  let promptLibrary = { items: [], modeMap: null };

  try {
    library = JSON.parse(await fs.readFile(libraryPath, 'utf8'));
  } catch { /* empty */ }

  try {
    promptLibrary = JSON.parse(await fs.readFile(promptsPath, 'utf8'));
  } catch { /* empty */ }

  const seed = {
    library: {
      items: (library.items || []).map(({ id, name, imageUrl, createdAt }) => ({
        id, name, imageUrl, createdAt,
      })),
    },
    promptLibrary,
    assetBaseUrl: process.env.SEED_ASSET_BASE_URL || '',
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(seed, null, 2), 'utf8');
  console.log(`Seed written to ${outPath} (${seed.library.items.length} library items, ${seed.promptLibrary.items?.length || 0} prompts)`);
}

buildSeed().catch((err) => {
  console.error(err);
  process.exit(1);
});
