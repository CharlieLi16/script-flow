import {
  jsonResponse,
  readJsonBody,
  requireGenerationAuth,
  setCors,
} from '../lib/auth.js';
import { getProvider } from '../lib/providers/registry.js';
import { loadReferences } from '../lib/providers/load-references.js';
import { encodeGenerationResponse } from '../lib/blob.js';
import { parseGrid, normalizeFps, sliceFlipbookSheet } from '../lib/images/slice-flipbook.js';

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
    const { nodeId, provider, model, prompt, size, referenceData, fps, userPrompt } = body;
    if (!nodeId || !provider || !prompt) {
      return jsonResponse(res, 400, { error: 'nodeId, provider, and prompt are required' });
    }

    const grid = parseGrid(body);
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

    const sliced = await sliceFlipbookSheet(result.buffer, {
      columns: grid.columns,
      rows: grid.rows,
      nodeId,
    });

    const sourcePath = `/images/${nodeId}-${Date.now()}.${result.ext || 'png'}`;
    const discarded = grid.dropsLeadingAnchor ? sliced.frameUrls.slice(0, 1) : [];
    const frameUrls = grid.dropsLeadingAnchor ? sliced.frameUrls.slice(1) : sliced.frameUrls;

    const animation = {
      sourceUrl: sourcePath,
      frameUrls,
      frameCount: frameUrls.length,
      sheetFrameCount: sliced.frameCount,
      droppedLeadingFrames: discarded.length,
      columns: sliced.columns,
      rows: sliced.rows,
      fps: normalizeFps(fps, 4),
      templateId: body.templateId || null,
      templateContent: typeof body.templateContent === 'string' ? body.templateContent : '',
      userPrompt: typeof userPrompt === 'string' ? userPrompt : '',
    };

    const framesBase64 = sliced.frames.map((f) => ({
      logicalPath: f.logicalPath,
      base64: f.buffer.toString('base64'),
      mime: f.mime,
    }));

    return jsonResponse(res, 200, {
      ...encodeGenerationResponse(result),
      sourcePath,
      imageUrl: frameUrls[0] || sourcePath,
      animation,
      frames: framesBase64,
    });
  } catch (err) {
    return jsonResponse(res, err.status || 500, { error: err.message || 'Animation generation failed' });
  }
}
