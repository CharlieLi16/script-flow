import { idbGet, idbPut } from './storage/idb.js';
import { getActiveProjectId } from './storage/repository.js';
import { getProjectSnapshot } from './storage/repository.js';
import { getAssetBlob } from './storage/assets.js';

const FOLDER_KEY = 'project-folder-handle';

function supportsFolderAccess() {
  return typeof window.showDirectoryPicker === 'function';
}

export function isFolderAccessSupported() {
  return supportsFolderAccess();
}

async function saveFolderHandle(projectId, handle) {
  await idbPut('settings', { key: `${FOLDER_KEY}:${projectId}`, handle });
}

async function getFolderHandle(projectId) {
  const record = await idbGet('settings', `${FOLDER_KEY}:${projectId}`);
  return record?.handle || null;
}

async function verifyPermission(handle, readWrite = false) {
  const opts = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

async function writeFile(handle, path, blob) {
  const parts = path.replace(/^\//, '').split('/');
  let dir = handle;
  for (let i = 0; i < parts.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function connectProjectFolder() {
  if (!supportsFolderAccess()) {
    throw new Error('当前浏览器不支持本地文件夹访问，请使用 Chrome 或 Edge');
  }
  const projectId = getActiveProjectId();
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveFolderHandle(projectId, handle);
  await syncProjectToFolder();
  return handle;
}

export async function syncProjectToFolder() {
  if (!supportsFolderAccess()) return;
  const projectId = getActiveProjectId();
  const handle = await getFolderHandle(projectId);
  if (!handle) return;
  const ok = await verifyPermission(handle, true);
  if (!ok) throw new Error('本地文件夹权限已失效，请重新选择文件夹');

  const snapshot = await getProjectSnapshot();
  const manifest = {
    version: 1,
    syncedAt: new Date().toISOString(),
    projectId,
    ...snapshot,
  };

  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  await writeFile(handle, 'manifest.json', manifestBlob);

  const paths = new Set();
  const collect = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj === 'string' && (obj.startsWith('/images/') || obj.startsWith('/refs/'))) {
      paths.add(obj);
    }
    if (Array.isArray(obj)) obj.forEach(collect);
    else Object.values(obj).forEach(collect);
  };
  collect(snapshot);

  for (const logicalPath of paths) {
    const blob = await getAssetBlob(projectId, logicalPath);
    if (blob) await writeFile(handle, logicalPath, blob);
  }
}

export async function autoSyncIfConnected() {
  try {
    await syncProjectToFolder();
  } catch {
    /* optional mirror */
  }
}
