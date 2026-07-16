import * as repo from './storage/repository.js';
import { resolveAssetUrl } from './storage/assets.js';
import { getActiveProjectId } from './storage/repository.js';
import { getApiKeyHeaders, getKeyMode, hasTeamSession } from './settings.js';

const LOCAL_PREFIXES = [
  '/api/timeline',
  '/api/captions',
  '/api/nodes',
  '/api/library',
  '/api/prompts',
  '/api/generated-assets',
  '/api/refs/upload',
];

function isLocalPath(path) {
  if (path.startsWith('/api/nodes/') && path.endsWith('/upload')) return true;
  if (path.startsWith('/api/generate-animation-chain/confirm-keyframes')) return true;
  return LOCAL_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function parsePath(path, method) {
  const url = new URL(path, 'http://local');
  const segments = url.pathname.split('/').filter(Boolean);
  return { segments, method: method || 'GET' };
}

async function handleLocal(path, options = {}) {
  const { segments, method } = parsePath(path, options.method);
  const body = options.body ? JSON.parse(options.body) : null;

  if (segments[0] === 'api' && segments[1] === 'timeline') {
    if (method === 'GET') return repo.getTimeline();
    if (method === 'PUT') return repo.putTimeline(body);
  }

  if (segments[0] === 'api' && segments[1] === 'captions') {
    if (segments.length === 2 && method === 'POST') return repo.postCaption(body);
    if (segments.length === 3) {
      const id = segments[2];
      if (method === 'PATCH') return repo.patchCaption(id, body);
      if (method === 'DELETE') return repo.deleteCaption(id);
    }
  }

  if (segments[0] === 'api' && segments[1] === 'nodes') {
    if (segments.length === 2 && method === 'POST') return repo.postNode(body);
    if (segments.length === 3 && segments[2] === 'reorder' && method === 'POST') {
      return repo.reorderNodes(body.order);
    }
    if (segments.length === 4 && segments[3] === 'upload' && method === 'POST') {
      const nodeId = segments[2];
      const form = options._formData;
      const file = form?.get('image');
      if (!file) throw new Error('No image file');
      return repo.uploadNodeImage(nodeId, file);
    }
    if (segments.length === 3) {
      const id = segments[2];
      if (method === 'PATCH') return repo.patchNode(id, body);
      if (method === 'DELETE') return repo.deleteNode(id);
    }
  }

  if (segments[0] === 'api' && segments[1] === 'library') {
    if (segments.length === 2) {
      if (method === 'GET') return repo.getLibrary();
      if (method === 'POST') {
        if (options._formData) {
          const file = options._formData.get('image');
          const name = options._formData.get('name');
          return repo.postLibraryItem({ name, file });
        }
        return repo.postLibraryItem(body);
      }
    }
    if (segments.length === 3) {
      const id = segments[2];
      if (method === 'PATCH') return repo.patchLibraryItem(id, body);
      if (method === 'DELETE') return repo.deleteLibraryItem(id);
    }
  }

  if (segments[0] === 'api' && segments[1] === 'refs' && segments[2] === 'upload') {
    const file = options._formData?.get('image');
    if (!file) throw new Error('No image file');
    return repo.uploadRef(file);
  }

  if (segments[0] === 'api' && segments[1] === 'prompts') {
    if (segments.length === 2 && method === 'GET') return repo.getPromptLibrary();
    if (segments.length === 2 && method === 'POST') return repo.postPrompt(body);
    if (segments.length === 3) {
      const id = segments[2];
      if (method === 'PATCH') return repo.patchPrompt(id, body);
      if (method === 'DELETE') return repo.deletePrompt(id);
    }
  }

  if (segments[0] === 'api' && segments[1] === 'generated-assets') {
    if (segments.length === 2 && method === 'GET') return repo.getGeneratedAssets();
    if (segments.length === 3 && segments[2] === 'from-frame' && method === 'POST') {
      return repo.postGeneratedAssetFromFrame(body);
    }
    if (segments.length === 4 && segments[3] === 'apply' && method === 'POST') {
      return repo.applyGeneratedAsset(segments[2], body);
    }
    if (segments.length === 3) {
      const id = segments[2];
      if (method === 'PATCH') return repo.patchGeneratedAsset(id, body);
      if (method === 'DELETE') return repo.deleteGeneratedAsset(id);
    }
  }

  if (path.includes('confirm-keyframes')) {
    const { confirmKeyframesLocally } = await import('./generation-helper.js');
    const nodeId = body?.nodeId;
    const chainId = body?.chainId;
    if (!nodeId || !chainId) throw new Error('nodeId and chainId required');
    return confirmKeyframesLocally(nodeId, chainId);
  }

  throw new Error(`Unknown local API: ${path}`);
}

async function handleRemote(path, options = {}) {
  const headers = {
    ...options.headers,
    ...getApiKeyHeaders(),
  };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(path, { ...options, headers, credentials: 'include' });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('生成超时，请再试一次');
    throw new Error('无法连接服务器，请确认网络后重试');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `服务器请求失败（${res.status}）`);
  }
  return data;
}

export async function apiClient(path, options = {}) {
  if (isLocalPath(path)) {
    return handleLocal(path, options);
  }
  return handleRemote(path, options);
}

export async function fetchWithLocal(path, options = {}) {
  if (isLocalPath(path)) {
    const data = await handleLocal(path, options);
    return {
      ok: true,
      json: async () => data,
    };
  }
  const headers = { ...options.headers, ...getApiKeyHeaders() };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(path, { ...options, headers, credentials: 'include' });
}

export async function resolveUrl(logicalPath) {
  const projectId = getActiveProjectId();
  if (!projectId || !logicalPath) return logicalPath || '';
  return resolveAssetUrl(projectId, logicalPath);
}

export async function persistGenerationResult(node, meta) {
  return repo.upsertGeneratedAssetFromNode(node, meta);
}

export async function storeRemoteImage(nodeId, remoteUrl, ext = 'png') {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error('Failed to download generated image');
  const blob = await res.blob();
  return repo.storeGeneratedImage(nodeId, blob, ext);
}

export async function storeRemoteImages(entries) {
  const stored = [];
  for (const entry of entries) {
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`Failed to download ${entry.url}`);
    const blob = await res.blob();
    stored.push({
      path: entry.path,
      blob,
      mime: blob.type,
    });
  }
  return repo.storeGeneratedImages(stored);
}

export function validateGenerationAccess(provider) {
  const mode = getKeyMode();
  if (mode === 'team') {
    if (!hasTeamSession()) throw new Error('请先输入团队访问码');
    return;
  }
  const headers = getApiKeyHeaders();
  const keyHeader = provider === 'gemini' ? 'x-gemini-api-key' : 'x-openai-api-key';
  if (!headers[keyHeader]) {
    throw new Error('请在设置中配置个人 API Key');
  }
}

export { isLocalPath };
