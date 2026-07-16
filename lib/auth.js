import crypto from 'crypto';

const COOKIE_NAME = 'sf_team_session';
const SESSION_DAYS = 7;

export function getCookieSecret() {
  return process.env.AUTH_COOKIE_SECRET || process.env.TEAM_ACCESS_CODE || 'dev-secret-change-me';
}

export function hashAccessCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

export function verifyAccessCode(code) {
  const expected = process.env.TEAM_ACCESS_CODE_HASH ||
    (process.env.TEAM_ACCESS_CODE ? hashAccessCode(process.env.TEAM_ACCESS_CODE) : null);
  if (!expected) return false;
  return hashAccessCode(code) === expected;
}

export function signSession(payload) {
  const secret = getCookieSecret();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const secret = getCookieSecret();
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const token = signSession({ team: true, exp });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getSessionFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySession(match[1]);
}

export function isTeamAuthenticated(req) {
  return Boolean(getSessionFromRequest(req));
}

export function resolveApiKeys(req) {
  const mode = req.headers['x-key-mode'] || 'personal';
  const team = isTeamAuthenticated(req);

  if (mode === 'team' && team) {
    return {
      openai: process.env.OPENAI_API_KEY || '',
      gemini: process.env.GEMINI_API_KEY || '',
      source: 'team',
    };
  }

  return {
    openai: req.headers['x-openai-api-key'] || '',
    gemini: req.headers['x-gemini-api-key'] || '',
    source: 'personal',
  };
}

export function requireGenerationAuth(req, providerId) {
  const keys = resolveApiKeys(req);
  const key = providerId === 'gemini' ? keys.gemini : keys.openai;
  if (!key) {
    const err = new Error(
      keys.source === 'team'
        ? '团队 Key 未配置'
        : '请在设置中配置个人 API Key，或输入团队访问码使用共享 Key',
    );
    err.status = 401;
    throw err;
  }
  if (keys.source === 'personal' && !keys.openai && !keys.gemini) {
    const err = new Error('请在设置中配置个人 API Key');
    err.status = 401;
    throw err;
  }
  return { keys, providerKey: key };
}

export function jsonResponse(res, status, data, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-key-mode, x-openai-api-key, x-gemini-api-key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

export { COOKIE_NAME };
