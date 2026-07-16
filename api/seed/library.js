import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsonResponse, setCors } from '../../lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '..', '..', 'seed', 'library-seed.json');

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  try {
    const raw = await readFile(SEED_PATH, 'utf8');
    const seed = JSON.parse(raw);
    return jsonResponse(res, 200, seed);
  } catch {
    return jsonResponse(res, 200, {
      library: { items: [] },
      promptLibrary: { items: [], modeMap: null },
      assetBaseUrl: '',
    });
  }
}
