import { createProject } from './storage/projects.js';
import { getAssetBlob, storeAssetFromUrl } from './storage/assets.js';
import { setActiveProjectId } from './storage/repository.js';

export async function fetchLegacySnapshot() {
  const res = await fetch('/api/legacy/snapshot');
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '无法读取本地旧剧本');
  return data;
}

async function importAssetPaths(projectId, assetPaths, onProgress) {
  let imported = 0;
  let failed = 0;
  const total = assetPaths.length;
  for (let i = 0; i < assetPaths.length; i += 1) {
    const logicalPath = assetPaths[i];
    onProgress?.({
      phase: 'assets',
      current: i + 1,
      total,
      path: logicalPath,
      imported,
      failed,
    });
    const existing = await getAssetBlob(projectId, logicalPath);
    if (existing) {
      imported += 1;
      continue;
    }
    try {
      await storeAssetFromUrl(projectId, logicalPath, logicalPath);
      imported += 1;
    } catch {
      failed += 1;
    }
  }
  return { imported, failed, total };
}

/**
 * Import local Express data/ timeline + images into a new IndexedDB project.
 * Caller should switchProject(result.project.id) afterward.
 */
export async function importLegacyLocalProject({ onProgress } = {}) {
  onProgress?.({ phase: 'snapshot', message: '读取本地旧剧本…' });
  const snapshot = await fetchLegacySnapshot();
  if (!snapshot) throw new Error('未找到本地 data/ 旧剧本');

  const name = snapshot.summary?.title || snapshot.timeline?.title || '导入的旧剧本';
  onProgress?.({
    phase: 'project',
    message: `创建项目「${name}」…`,
    summary: snapshot.summary,
  });

  const project = await createProject(name, {
    timeline: structuredClone(snapshot.timeline),
    library: structuredClone(snapshot.library || { items: [] }),
    promptLibrary: structuredClone(snapshot.promptLibrary || { items: [] }),
    generatedAssets: structuredClone(
      snapshot.generatedAssets || { items: [], initialized: true },
    ),
  });
  setActiveProjectId(project.id);

  const assetResult = await importAssetPaths(
    project.id,
    snapshot.assetPaths || [],
    onProgress,
  );

  return {
    project,
    summary: snapshot.summary,
    assets: assetResult,
  };
}
