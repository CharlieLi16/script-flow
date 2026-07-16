import {
  isTeamAuthenticated,
  jsonResponse,
  resolveApiKeys,
  setCors,
} from '../lib/auth.js';
import { listAvailableProviders } from '../lib/providers/registry.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const keys = resolveApiKeys(req);
  const hasTeam = isTeamAuthenticated(req);
  const providers = listAvailableProviders(hasTeam, {
    openai: Boolean(keys.openai),
    gemini: Boolean(keys.gemini),
  });
  return jsonResponse(res, 200, providers);
}
