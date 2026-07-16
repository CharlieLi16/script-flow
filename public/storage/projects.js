import { idbDelete, idbGet, idbGetAll, idbPut } from './idb.js';
import { deleteProjectAssets } from './assets.js';
import { createProjectId } from './timeline-utils.js';

const CURRENT_PROJECT_KEY = 'currentProjectId';

const DEFAULT_PROJECT_DATA = () => ({
  timeline: { title: '新剧本', nodes: [], captions: [] },
  library: { items: [] },
  promptLibrary: { items: [], modeMap: null },
  generatedAssets: { items: [], initialized: false },
});

export async function listProjects() {
  const projects = await idbGetAll('projects');
  return projects
    .map(({ id, name, updatedAt, createdAt }) => ({ id, name, updatedAt, createdAt }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getProject(projectId) {
  return idbGet('projects', projectId);
}

export async function getCurrentProjectId() {
  const setting = await idbGet('settings', CURRENT_PROJECT_KEY);
  return setting?.value || null;
}

export async function setCurrentProjectId(projectId) {
  await idbPut('settings', { key: CURRENT_PROJECT_KEY, value: projectId });
}

export async function createProject(name, seedData = null) {
  const now = new Date().toISOString();
  const id = createProjectId();
  const base = seedData ? structuredClone(seedData) : DEFAULT_PROJECT_DATA();
  const project = {
    id,
    name: name || '未命名项目',
    createdAt: now,
    updatedAt: now,
    ...base,
  };
  await idbPut('projects', project);
  await setCurrentProjectId(id);
  return project;
}

export async function updateProject(projectId, patch) {
  const project = await getProject(projectId);
  if (!project) throw new Error('项目不存在');
  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  await idbPut('projects', project);
  return project;
}

export async function renameProject(projectId, name) {
  return updateProject(projectId, { name: name.trim() || '未命名项目' });
}

export async function deleteProject(projectId) {
  await deleteProjectAssets(projectId);
  await idbDelete('projects', projectId);
  const currentId = await getCurrentProjectId();
  if (currentId === projectId) {
    const remaining = await listProjects();
    if (remaining.length) await setCurrentProjectId(remaining[0].id);
    else await idbDelete('settings', CURRENT_PROJECT_KEY);
  }
}

export async function saveProjectData(projectId, data) {
  const project = await getProject(projectId);
  if (!project) throw new Error('项目不存在');
  if (data.timeline !== undefined) project.timeline = data.timeline;
  if (data.library !== undefined) project.library = data.library;
  if (data.promptLibrary !== undefined) project.promptLibrary = data.promptLibrary;
  if (data.generatedAssets !== undefined) project.generatedAssets = data.generatedAssets;
  project.updatedAt = new Date().toISOString();
  await idbPut('projects', project);
  return project;
}

export async function ensureDefaultProject(seedLoader) {
  let projects = await listProjects();
  if (!projects.length) {
    let seed = null;
    if (seedLoader) {
      try {
        seed = await seedLoader();
      } catch {
        /* use empty */
      }
    }
    await createProject('我的第一个项目', seed);
    projects = await listProjects();
  }
  let currentId = await getCurrentProjectId();
  if (!currentId || !projects.some((p) => p.id === currentId)) {
    currentId = projects[0].id;
    await setCurrentProjectId(currentId);
  }
  return getProject(currentId);
}

export { DEFAULT_PROJECT_DATA };
