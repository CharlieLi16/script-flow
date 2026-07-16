import {
  jsonResponse,
  readJsonBody,
  requireGenerationAuth,
  setCors,
} from '../../lib/auth.js';
import { getProvider } from '../../lib/providers/registry.js';
import { loadReferences } from '../../lib/providers/load-references.js';
import { encodeGenerationResponse } from '../../lib/blob.js';

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
    const { provider, model, prompt, size, referenceData, keyframeIndex } = body;
    if (!provider || !prompt) {
      return jsonResponse(res, 400, { error: 'provider and prompt are required' });
    }

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

    const logicalPath = `/images/kf-${body.chainId || 'chain'}-k${keyframeIndex}-${Date.now()}.${result.ext || 'png'}`;

    return jsonResponse(res, 200, {
      ...encodeGenerationResponse(result),
      keyframeIndex,
      logicalPath,
      imageUrl: logicalPath,
    });
  } catch (err) {
    return jsonResponse(res, err.status || 500, { error: err.message || 'Keyframe generation failed' });
  }
}
