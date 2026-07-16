import { idbDelete, idbGet, idbPut } from './storage/idb.js';

const SETTINGS = {
  keyMode: 'script-flow-key-mode',
  encryptedKeys: 'script-flow-encrypted-keys',
  teamSession: 'script-flow-team-session',
};

let memoryKeys = { openai: '', gemini: '' };
let teamSessionActive = false;

export function getKeyMode() {
  return localStorage.getItem(SETTINGS.keyMode) || 'personal';
}

export function setKeyMode(mode) {
  localStorage.setItem(SETTINGS.keyMode, mode);
}

export function hasTeamSession() {
  return teamSessionActive;
}

export function setTeamSession(active) {
  teamSessionActive = active;
}

export function getMemoryKeys() {
  return { ...memoryKeys };
}

export function setMemoryKeys(keys) {
  memoryKeys = { openai: keys.openai || '', gemini: keys.gemini || '' };
}

export function getApiKeyHeaders() {
  if (getKeyMode() === 'team' && teamSessionActive) {
    return { 'x-key-mode': 'team' };
  }
  const headers = { 'x-key-mode': 'personal' };
  if (memoryKeys.openai) headers['x-openai-api-key'] = memoryKeys.openai;
  if (memoryKeys.gemini) headers['x-gemini-api-key'] = memoryKeys.gemini;
  return headers;
}

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptKeys(keys, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const payload = JSON.stringify({ openai: keys.openai || '', gemini: keys.gemini || '' });
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(payload),
  );
  await idbPut('settings', {
    key: SETTINGS.encryptedKeys,
    salt: Array.from(salt),
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  });
}

export async function decryptKeys(passphrase) {
  const record = await idbGet('settings', SETTINGS.encryptedKeys);
  if (!record?.ciphertext) return null;
  const salt = new Uint8Array(record.salt);
  const iv = new Uint8Array(record.iv);
  const ciphertext = new Uint8Array(record.ciphertext);
  const key = await deriveKey(passphrase, salt);
  const dec = new TextDecoder();
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new Error('口令错误，无法解密 API Key');
  }
}

export async function clearEncryptedKeys() {
  await idbDelete('settings', SETTINGS.encryptedKeys);
}

export async function checkTeamSession() {
  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    if (!res.ok) {
      teamSessionActive = false;
      return false;
    }
    const data = await res.json();
    teamSessionActive = Boolean(data.authenticated);
    return teamSessionActive;
  } catch {
    teamSessionActive = false;
    return false;
  }
}

export async function unlockTeam(code) {
  const res = await fetch('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '访问码无效');
  teamSessionActive = true;
  return data;
}

export async function initSettings() {
  await checkTeamSession();
}
