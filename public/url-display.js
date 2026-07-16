import { resolveUrl } from './api-client.js';

const cache = new Map();

export function clearDisplayUrlCache() {
  cache.clear();
}

export async function getDisplayUrl(logicalPath) {
  if (!logicalPath) return '';
  if (logicalPath.startsWith('blob:') || logicalPath.startsWith('http')) return logicalPath;
  if (cache.has(logicalPath)) return cache.get(logicalPath);
  const url = await resolveUrl(logicalPath);
  cache.set(logicalPath, url);
  return url;
}

export async function resolveImagesIn(root = document) {
  const imgs = root.querySelectorAll('img[data-asset]');
  await Promise.all(
    [...imgs].map(async (img) => {
      const path = img.getAttribute('data-asset');
      if (!path) return;
      img.src = await getDisplayUrl(path);
    }),
  );
}

export async function setImgSrc(el, logicalPath) {
  if (!el) return;
  if (!logicalPath) {
    el.removeAttribute('src');
    el.removeAttribute('data-asset');
    return;
  }
  el.setAttribute('data-asset', logicalPath);
  const url = await getDisplayUrl(logicalPath);
  if (el.getAttribute('data-asset') === logicalPath) {
    el.src = url;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function imgAsset(url, className = '', alt = '') {
  if (!url) return '';
  const cls = className ? ` class="${className}"` : '';
  return `<img${cls} data-asset="${escapeHtml(url)}" src="" alt="${escapeHtml(alt)}" draggable="false" />`;
}
