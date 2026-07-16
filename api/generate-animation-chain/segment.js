import {
  jsonResponse,
  readJsonBody,
  requireGenerationAuth,
  setCors,
} from '../../lib/auth.js';
import { getProvider } from '../../lib/providers/registry.js';
import { loadReferences } from '../../lib/providers/load-references.js';
import { encodeGenerationResponse } from '../../lib/blob.js';
import { sliceFlipbookSheet } from '../../lib/images/slice-flipbook.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }
  try {
    const body = await readJsonBody(req);
    const { nodeId, provider, model, prompt, size, referenceData, segmentIndex } = body;
    if (!nodeId || !provider || !prompt) {
      return jsonResponse(res, 400, { error: 'nodeId, provider, and prompt are required' });
    }

    const columns = Number(body.columns) || 2;
    const rows = Number(body.rows) || 2;

    const { providerKey } = requireGenerationAuth(req, provider);
    const references = await loadReferences(referenceData || []);
    const p = getProvider(provider, providerKey);
    const result = await p.generate({
      apiKey: providerKey,
      model,
      prompt,
      size: size || '1024x1024',
      references,
    });

    const sliced = await sliceFlipbookSheet(result.buffer, { columns, rows, nodeId });
    const sourcePath = `/images/${nodeId}-seg${segmentIndex}-${Date.now()}.${result.ext || 'png'}`;

    return jsonResponse(res, 200, {
      ...encodeGenerationResponse(result),
      segmentIndex,
      sourcePath,
      frameUrls: sliced.frameUrls,
      frames: sliced.frames.map((f) => ({
        logicalPath: f.logicalPath,
        base64: f.buffer.toString('base64'),
        mime: f.mime,
      })),
    });
  } catch (err) {
    return jsonResponse(res, err.status || 500, { error: err.message || 'Segment generation failed' });
  }
}
