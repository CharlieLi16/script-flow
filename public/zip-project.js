import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
import {
  createProject,
  getProject,
} from './storage/projects.js';
import {
  getProjectSnapshot,
  importProjectSnapshot,
  setActiveProjectId,
  getActiveProjectId,
} from './storage/repository.js';
import {
  getAssetBlob,
  listProjectAssetPaths,
  storeAssetBlob,
} from './storage/assets.js';

const MANIFEST_VERSION = 1;

export async function exportProjectZip(projectId = null) {
  const id = projectId || getActiveProjectId();
  const snapshot = await getProjectSnapshot();
  const paths = await listProjectAssetPaths(id);
  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        version: MANIFEST_VERSION,
        exportedAt: new Date().toISOString(),
        timeline: snapshot.timeline,
        library: snapshot.library,
        promptLibrary: snapshot.promptLibrary,
        generatedAssets: snapshot.generatedAssets,
        assets: paths,
      },
      null,
      2,
    ),
  );

  for (const logicalPath of paths) {
    const blob = await getAssetBlob(id, logicalPath);
    if (!blob) continue;
    const zipPath = logicalPath.replace(/^\//, '');
    zip.file(zipPath, blob);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const project = await getProject(id);
  const filename = `${(project?.name || 'script-flow').replace(/[^\w\u4e00-\u9fff-]+/g, '-')}.zip`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importProjectZip(file, name) {
  const zip = await JSZip.loadAsync(file);
  const manifestRaw = await zip.file('manifest.json')?.async('string');
  if (!manifestRaw) throw new Error('ZIP 缺少 manifest.json');
  const manifest = JSON.parse(manifestRaw);
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(`不支持的 manifest 版本: ${manifest.version}`);
  }

  const project = await createProject(name || file.name.replace(/\.zip$/i, '') || '导入的项目', {
    timeline: manifest.timeline,
    library: manifest.library,
    promptLibrary: manifest.promptLibrary,
    generatedAssets: manifest.generatedAssets,
  });
  setActiveProjectId(project.id);

  for (const logicalPath of manifest.assets || []) {
    const zipPath = logicalPath.replace(/^\//, '');
    const entry = zip.file(zipPath);
    if (!entry) continue;
    const blob = await entry.async('blob');
    await storeAssetBlob(project.id, logicalPath, blob);
  }

  await importProjectSnapshot({
    timeline: manifest.timeline,
    library: manifest.library,
    promptLibrary: manifest.promptLibrary,
    generatedAssets: manifest.generatedAssets,
  });

  return project;
}
