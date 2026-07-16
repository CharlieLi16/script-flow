import {
  getSessionFromRequest,
  jsonResponse,
  setCors,
} from '../../lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const session = getSessionFromRequest(req);
  return jsonResponse(res, 200, {
    authenticated: Boolean(session),
    expiresAt: session?.exp || null,
  });
}
