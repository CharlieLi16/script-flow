import {
  createSessionCookie,
  getSessionFromRequest,
  jsonResponse,
  readJsonBody,
  setCors,
  verifyAccessCode,
} from '../../lib/auth.js';

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
    const code = String(body.code || '').trim();
    if (!code || !verifyAccessCode(code)) {
      return jsonResponse(res, 401, { error: '访问码无效' });
    }
    return jsonResponse(res, 200, { ok: true, authenticated: true }, {
      'Set-Cookie': createSessionCookie(),
    });
  } catch (err) {
    return jsonResponse(res, 500, { error: '解锁失败' });
  }
}
