import {
  createProject,
  deleteProject,
  ensureDefaultProject,
  getCurrentProjectId,
  listProjects,
  renameProject,
  setCurrentProjectId,
} from './storage/projects.js';
import { getActiveProjectId, setActiveProjectId } from './storage/repository.js';
import { hydrateSeedAssets, revokeAllAssetUrls } from './storage/assets.js';
import { exportProjectZip, importProjectZip } from './zip-project.js';
import { connectProjectFolder, syncProjectToFolder } from './folder-sync.js';

let onProjectChange = null;
let lastSeedAssetBaseUrl = '';

export function setProjectChangeHandler(fn) {
  onProjectChange = fn;
}

async function loadSeedData() {
  const res = await fetch('/api/seed/library');
  if (!res.ok) return null;
  const seed = await res.json();
  lastSeedAssetBaseUrl = seed?.assetBaseUrl || '';
  return seed;
}

/** Hydrate /refs seed images into IndexedDB for the active project (best-effort). */
export async function hydrateActiveProjectSeedAssets(library) {
  const projectId = getActiveProjectId();
  if (!projectId) return;
  let assetBaseUrl = lastSeedAssetBaseUrl;
  if (!assetBaseUrl) {
    try {
      const seed = await loadSeedData();
      assetBaseUrl = seed?.assetBaseUrl || '';
    } catch {
      assetBaseUrl = '';
    }
  }
  await hydrateSeedAssets(projectId, library, assetBaseUrl);
}

export async function initProjects() {
  const seed = await loadSeedData();
  const seedData = seed
    ? {
        timeline: { title: '新剧本', nodes: [], captions: [] },
        library: structuredClone(seed.library || { items: [] }),
        promptLibrary: structuredClone(seed.promptLibrary || { items: [] }),
        generatedAssets: { items: [], initialized: false },
      }
    : null;
  const project = await ensureDefaultProject(() => seedData);
  setActiveProjectId(project.id);
  return project;
}

export async function switchProject(projectId) {
  revokeAllAssetUrls();
  await setCurrentProjectId(projectId);
  setActiveProjectId(projectId);
  if (onProjectChange) await onProjectChange();
}

export async function createNewProject(name) {
  const seed = await loadSeedData();
  const seedData = seed
    ? {
        timeline: { title: '新剧本', nodes: [], captions: [] },
        library: structuredClone(seed.library || { items: [] }),
        promptLibrary: structuredClone(seed.promptLibrary || { items: [] }),
        generatedAssets: { items: [], initialized: false },
      }
    : null;
  const project = await createProject(name, seedData);
  await switchProject(project.id);
  return project;
}

export async function removeProject(projectId) {
  await deleteProject(projectId);
  const current = await getCurrentProjectId();
  if (current) {
    setActiveProjectId(current);
    if (onProjectChange) await onProjectChange();
  }
}

export async function renameCurrentProject(name) {
  const id = getActiveProjectId();
  return renameProject(id, name);
}

export { listProjects, exportProjectZip, importProjectZip, connectProjectFolder, syncProjectToFolder };

export function renderProjectMenu(container, callbacks) {
  container.innerHTML = `
    <div class="project-menu">
      <button type="button" id="project-switcher-btn" class="btn btn-ghost btn-sm project-switcher-btn">
        <span id="project-current-name">项目</span> ▾
      </button>
      <div id="project-dropdown" class="project-dropdown" hidden>
        <div id="project-list" class="project-list"></div>
        <div class="project-menu-actions">
          <button type="button" id="project-new-btn" class="btn btn-ghost btn-sm">+ 新建</button>
          <button type="button" id="project-import-btn" class="btn btn-ghost btn-sm">导入 ZIP</button>
          <button type="button" id="project-export-btn" class="btn btn-ghost btn-sm">导出 ZIP</button>
          <button type="button" id="project-folder-btn" class="btn btn-ghost btn-sm">本地文件夹</button>
        </div>
      </div>
    </div>
  `;

  const switcherBtn = container.querySelector('#project-switcher-btn');
  const dropdown = container.querySelector('#project-dropdown');
  const listEl = container.querySelector('#project-list');

  async function refreshList() {
    const projects = await listProjects();
    const currentId = getActiveProjectId();
    listEl.innerHTML = projects
      .map(
        (p) => `
        <button type="button" class="project-list-item${p.id === currentId ? ' is-active' : ''}" data-id="${p.id}">
          <span>${escapeHtml(p.name)}</span>
          <small>${new Date(p.updatedAt).toLocaleDateString('zh-CN')}</small>
        </button>`,
      )
      .join('');
    const current = projects.find((p) => p.id === currentId);
    container.querySelector('#project-current-name').textContent = current?.name || '项目';
  }

  switcherBtn.addEventListener('click', async () => {
    await refreshList();
    dropdown.hidden = !dropdown.hidden;
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.project-list-item');
    if (!btn) return;
    await switchProject(btn.dataset.id);
    dropdown.hidden = true;
    if (callbacks.onSwitch) callbacks.onSwitch();
  });

  container.querySelector('#project-new-btn').addEventListener('click', async () => {
    const name = await callbacks.prompt('新建项目', '项目名称', '未命名项目');
    if (!name) return;
    await createNewProject(name);
    dropdown.hidden = true;
    if (callbacks.onSwitch) callbacks.onSwitch();
  });

  container.querySelector('#project-import-btn').addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await importProjectZip(file);
      dropdown.hidden = true;
      if (callbacks.onSwitch) callbacks.onSwitch();
    };
    input.click();
  });

  container.querySelector('#project-export-btn').addEventListener('click', async () => {
    await exportProjectZip();
  });

  container.querySelector('#project-folder-btn').addEventListener('click', async () => {
    await connectProjectFolder();
    if (callbacks.onFolder) callbacks.onFolder();
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) dropdown.hidden = true;
  });

  return { refreshList };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
