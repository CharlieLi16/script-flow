import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsonResponse, setCors } from '../../lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

async function readJsonSafe(filename, fallback) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function collectAssetPaths(...roots) {
  const paths = new Set();
  const visit = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      if (value.startsWith('/images/') || value.startsWith('/refs/')) paths.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  roots.forEach(visit);
  return [...paths];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const timeline = await readJsonSafe('timeline.json', null);
  const library = await readJsonSafe('library.json', { items: [] });
  const promptLibrary = await readJsonSafe('prompts.json', { items: [] });
  const generatedAssets = await readJsonSafe('generated-assets.json', {
    items: [],
    initialized: true,
  });

  if (!timeline && !(library.items?.length) && !(promptLibrary.items?.length)) {
    return jsonResponse(res, 404, { error: '未找到本地 data/ 旧剧本' });
  }

  const assetPaths = collectAssetPaths(timeline, library, generatedAssets);

  return jsonResponse(res, 200, {
    available: true,
    timeline: timeline || { title: '导入的剧本', nodes: [], captions: [] },
    library,
    promptLibrary,
    generatedAssets: {
      ...generatedAssets,
      initialized: true,
    },
    assetPaths,
    summary: {
      title: timeline?.title || '导入的剧本',
      nodes: timeline?.nodes?.length || 0,
      captions: timeline?.captions?.length || 0,
      libraryItems: library?.items?.length || 0,
      prompts: promptLibrary?.items?.length || 0,
      assets: generatedAssets?.items?.length || 0,
      imagePaths: assetPaths.length,
    },
  });
}
