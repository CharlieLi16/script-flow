import { idbDelete, idbGet, idbGetByIndex, idbPut } from './idb.js';

const blobUrlCache = new Map();

function assetKey(projectId, logicalPath) {
  return `${projectId}::${logicalPath}`;
}

function extFromMime(mime) {
  if (mime?.includes('jpeg')) return 'jpg';
  if (mime?.includes('webp')) return 'webp';
  return 'png';
}

async function createThumbnail(blob, maxSize = 256) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const thumbBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );
    return thumbBlob;
  } catch {
    return null;
  }
}

export function revokeAssetUrl(logicalPath) {
  const cached = blobUrlCache.get(logicalPath);
  if (cached) {
    URL.revokeObjectURL(cached);
    blobUrlCache.delete(logicalPath);
  }
}

export function revokeAllAssetUrls() {
  for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
  blobUrlCache.clear();
}

export async function resolveAssetUrl(projectId, logicalPath) {
  if (!logicalPath || typeof logicalPath !== 'string') return '';
  if (logicalPath.startsWith('blob:') || logicalPath.startsWith('http')) return logicalPath;
  if (blobUrlCache.has(logicalPath)) return blobUrlCache.get(logicalPath);

  const record = await idbGet('assets', assetKey(projectId, logicalPath));
  if (!record?.blob) return logicalPath;

  const url = URL.createObjectURL(record.blob);
  blobUrlCache.set(logicalPath, url);
  return url;
}

export async function resolveAssetUrlWithThumb(projectId, logicalPath) {
  const full = await resolveAssetUrl(projectId, logicalPath);
  const record = await idbGet('assets', assetKey(projectId, logicalPath));
  if (record?.thumbBlob) {
    const thumbKey = `${logicalPath}#thumb`;
    if (!blobUrlCache.has(thumbKey)) {
      blobUrlCache.set(thumbKey, URL.createObjectURL(record.thumbBlob));
    }
    return { full, thumb: blobUrlCache.get(thumbKey) };
  }
  return { full, thumb: full };
}

export async function getAssetBlob(projectId, logicalPath) {
  const record = await idbGet('assets', assetKey(projectId, logicalPath));
  return record?.blob || null;
}

export async function storeAssetBlob(projectId, logicalPath, blob, mime) {
  const thumbBlob = await createThumbnail(blob);
  await idbPut('assets', {
    key: assetKey(projectId, logicalPath),
    projectId,
    logicalPath,
    blob,
    thumbBlob,
    mime: mime || blob.type || 'image/png',
    size: blob.size,
    updatedAt: new Date().toISOString(),
  });
  revokeAssetUrl(logicalPath);
  return logicalPath;
}

export async function storeAssetFromFile(projectId, logicalPath, file) {
  return storeAssetBlob(projectId, logicalPath, file, file.type);
}

export async function storeAssetFromUrl(projectId, logicalPath, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch asset: ${url}`);
  const blob = await res.blob();
  return storeAssetBlob(projectId, logicalPath, blob, blob.type);
}

export async function storeAssetFromBase64(projectId, logicalPath, base64, mime = 'image/png') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  return storeAssetBlob(projectId, logicalPath, blob, mime);
}

export function makeImagePath(nodeId, ext = 'png') {
  return `/images/${nodeId}-${Date.now()}.${ext}`;
}

export function makeRefPath(id, ext = 'png') {
  return `/refs/${id}.${ext}`;
}

export function makeFramePath(nodeId, batchId, frameName) {
  return `/images/frames/${nodeId}-${batchId}/${frameName}`;
}

export function extFromFile(file) {
  return extFromMime(file.type);
}

export async function deleteProjectAssets(projectId) {
  const assets = await idbGetByIndex('assets', 'projectId', projectId);
  for (const asset of assets) {
    revokeAssetUrl(asset.logicalPath);
    await idbDelete('assets', asset.key);
  }
}

export async function listProjectAssetPaths(projectId) {
  const assets = await idbGetByIndex('assets', 'projectId', projectId);
  return assets.map((a) => a.logicalPath);
}

export async function getProjectStorageBytes(projectId) {
  const assets = await idbGetByIndex('assets', 'projectId', projectId);
  return assets.reduce((sum, a) => sum + (a.size || 0) + (a.thumbBlob?.size || 0), 0);
}

/**
 * Copy-on-first-use: for seed library items pointing at /refs/...,
 * fetch from Express /refs or seed assetBaseUrl into IndexedDB when available.
 * Missing remote files are left as placeholders (logical path only).
 */
export async function hydrateSeedAssets(projectId, library, assetBaseUrl = '') {
  if (!projectId || !library?.items?.length) return;
  const base = String(assetBaseUrl || '').replace(/\/$/, '');
  await Promise.all(
    library.items.map(async (item) => {
      const path = item?.imageUrl;
      if (!path || typeof path !== 'string' || !path.startsWith('/refs/')) return;
      const existing = await getAssetBlob(projectId, path);
      if (existing) return;
      const candidates = [];
      if (base) candidates.push(`${base}${path}`);
      candidates.push(path);
      for (const url of candidates) {
        try {
          await storeAssetFromUrl(projectId, path, url);
          return;
        } catch {
          /* try next source */
        }
      }
    }),
  );
}
