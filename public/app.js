const NODE_WIDTH = 168;
const TRACK_PADDING = 48;
const UNDO_MS = 5000;
const SCROLL_EDGE = 72;
const SCROLL_MAX_SPEED = 22;
const GENERATE_TIMEOUT_MS = 180000;

const state = {
  timeline: { title: '', nodes: [] },
  selectedId: null,
  providers: [],
  dragId: null,
  dropTarget: null,
  lastDragAt: 0,
  pointerX: null,
  autoScrollRaf: null,
  pendingDelete: null,
  library: { items: [] },
  genRefs: {},
  pendingLibraryImageUrl: null,
  libraryMode: 'manage',
  autoSave: localStorage.getItem('script-flow-autosave') !== 'false',
  autoSaveTimer: null,
  generation: {
    nodeId: null,
    status: 'idle',
    progress: 0,
    message: '',
    lastRequest: null,
    timerId: null,
  },
  preview: {
    open: false,
    playing: false,
    elapsed: 0,
    currentIndex: 0,
    startedAt: 0,
    rafId: null,
  },
};

const $ = (sel) => document.querySelector(sel);

const els = {
  timelineTitle: $('#timeline-title'),
  themeToggle: $('#theme-toggle'),
  themeIcon: $('.theme-icon'),
  addNodeBtn: $('#add-node-btn'),
  previewBtn: $('#preview-btn'),
  saveNodeTopBtn: $('#save-node-top-btn'),
  deleteNodeTopBtn: $('#delete-node-top-btn'),
  autoSaveToggle: $('#autosave-toggle'),
  timelineScroll: $('#timeline-scroll'),
  timelineTrack: $('#timeline-track'),
  nodesLayer: $('#nodes-layer'),
  scrollLeft: $('#scroll-left'),
  scrollRight: $('#scroll-right'),
  editorPanel: $('#editor-panel'),
  editorEmpty: $('#editor-empty'),
  closeEditor: $('#close-editor'),
  nodeForm: $('#node-form'),
  fieldTitle: $('#field-title'),
  fieldTime: $('#field-time'),
  fieldDuration: $('#field-duration'),
  fieldCamera: $('#field-camera'),
  fieldScript: $('#field-script'),
  fieldSubtitle: $('#field-subtitle'),
  imagePreview: $('#image-preview'),
  imageUpload: $('#image-upload'),
  genProvider: $('#gen-provider'),
  genSize: $('#gen-size'),
  genPrompt: $('#gen-prompt'),
  fillPromptBtn: $('#fill-prompt-btn'),
  generateBtn: $('#generate-btn'),
  genStatus: $('#gen-status'),
  genProgressOverlay: $('#gen-progress-overlay'),
  genProgressMessage: $('#gen-progress-message'),
  genProgressPercent: $('#gen-progress-percent'),
  genProgressBar: $('#gen-progress-bar'),
  retryGenerateBtn: $('#retry-generate-btn'),
  deleteModal: $('#delete-modal'),
  deleteModalBody: $('#delete-modal-body'),
  deleteCancel: $('#delete-cancel'),
  deleteConfirm: $('#delete-confirm'),
  undoToast: $('#undo-toast'),
  undoMessage: $('#undo-message'),
  undoBtn: $('#undo-btn'),
  addToLibraryBtn: $('#add-to-library-btn'),
  useCurrentRefBtn: $('#use-current-ref-btn'),
  chooseLibraryRefBtn: $('#choose-library-ref-btn'),
  refCount: $('#ref-count'),
  refChips: $('#ref-chips'),
  refUpload: $('#ref-upload'),
  libraryBtn: $('#library-btn'),
  libraryPanel: $('#library-panel'),
  libraryBackdrop: $('#library-backdrop'),
  closeLibrary: $('#close-library'),
  libraryTitle: $('#library-title'),
  libraryHint: $('#library-hint'),
  libraryKicker: $('#library-kicker'),
  libraryGrid: $('#library-grid'),
  librarySearch: $('#library-search'),
  libraryUpload: $('#library-upload'),
  libraryFooter: $('#library-footer'),
  librarySelectedCount: $('#library-selected-count'),
  libraryDoneBtn: $('#library-done-btn'),
  libraryNameModal: $('#library-name-modal'),
  libraryNameInput: $('#library-name-input'),
  libraryNameCancel: $('#library-name-cancel'),
  libraryNameConfirm: $('#library-name-confirm'),
  previewOverlay: $('#preview-overlay'),
  previewClose: $('#preview-close'),
  previewTitle: $('#preview-title'),
  previewNodeCount: $('#preview-node-count'),
  previewStage: $('#preview-stage'),
  previewImage: $('#preview-image'),
  previewNoImage: $('#preview-no-image'),
  previewCaption: $('#preview-caption'),
  previewSceneTime: $('#preview-scene-time'),
  previewSceneTitle: $('#preview-scene-title'),
  previewSceneCamera: $('#preview-scene-camera'),
  previewCurrentTime: $('#preview-current-time'),
  previewProgress: $('#preview-progress'),
  previewTotalTime: $('#preview-total-time'),
  previewRestart: $('#preview-restart'),
  previewPlay: $('#preview-play'),
  previewPrev: $('#preview-prev'),
  previewNext: $('#preview-next'),
};

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('生成超时，服务器可能无响应，请再试一次');
    }
    throw new Error('无法连接服务器，请确认服务正在运行后重试');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `服务器请求失败（${res.status}）`);
  }
  return data;
}

function selectedNode() {
  return state.timeline.nodes.find((n) => n.id === state.selectedId) ?? null;
}

const CAMERA_LABELS = {
  static: '静止',
  push: '缓慢推进',
  pull: '缓慢拉远',
  left: '向左平移',
  right: '向右平移',
  up: '向上摇镜',
  down: '向下摇镜',
};

function nodeDuration(node) {
  const value = Number(node?.durationMs);
  return Number.isFinite(value) && value >= 500 ? Math.min(value, 600000) : 4000;
}

function nodeSubtitle(node) {
  return node?.subtitle || '';
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function previewTotalDuration() {
  return state.timeline.nodes.reduce((sum, node) => sum + nodeDuration(node), 0);
}

function previewNodeAt(elapsed) {
  let cursor = 0;
  for (let index = 0; index < state.timeline.nodes.length; index += 1) {
    const duration = nodeDuration(state.timeline.nodes[index]);
    if (elapsed < cursor + duration || index === state.timeline.nodes.length - 1) {
      return { index, localElapsed: Math.max(0, elapsed - cursor), start: cursor };
    }
    cursor += duration;
  }
  return { index: 0, localElapsed: 0, start: 0 };
}

function getGenRefs() {
  if (!state.selectedId) return [];
  const node = selectedNode();
  return node?.referenceUrls || state.genRefs[state.selectedId] || [];
}

function setGenRefs(urls) {
  if (!state.selectedId) return;
  state.genRefs[state.selectedId] = [...urls];
  const node = selectedNode();
  if (node) node.referenceUrls = [...urls];
  renderRefChips();
  updateReferenceCount();
  api(`/api/nodes/${state.selectedId}`, {
    method: 'PATCH',
    body: JSON.stringify({ referenceUrls: urls }),
  }).catch((err) => setGenStatus(`参考图保存失败：${err.message}`, 'error'));
}

function addGenRef(url) {
  if (!url || getGenRefs().includes(url)) return;
  setGenRefs([...getGenRefs(), url]);
}

function removeGenRef(url) {
  setGenRefs(getGenRefs().filter((u) => u !== url));
}

function renderRefChips() {
  const refs = getGenRefs();
  els.refChips.innerHTML = '';

  if (refs.length === 0) {
    els.refChips.innerHTML = '<span class="ref-empty-hint">尚未选择参考图</span>';
    updateReferenceCount();
    return;
  }

  for (const url of refs) {
    const chip = document.createElement('div');
    chip.className = 'ref-chip';
    chip.innerHTML = `
      <img src="${url}" alt="" />
      <button type="button" class="ref-chip-remove" aria-label="移除参考图">×</button>
    `;
    chip.querySelector('.ref-chip-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeGenRef(url);
    });
    els.refChips.appendChild(chip);
  }
  updateReferenceCount();
}

function updateReferenceCount() {
  const count = getGenRefs().length;
  els.refCount.textContent = count ? `已选 ${count} 张` : '未选择';
  els.refCount.classList.toggle('has-selection', count > 0);
  els.librarySelectedCount.textContent = String(count);
}

function updateImageActions() {
  const node = selectedNode();
  const hasImage = Boolean(node?.imageUrl);
  els.addToLibraryBtn.disabled = !hasImage;
  els.useCurrentRefBtn.disabled = !hasImage;
}

function updateNodeActions() {
  const hasNode = Boolean(selectedNode());
  els.saveNodeTopBtn.disabled = !hasNode;
  els.deleteNodeTopBtn.disabled = !hasNode;
}

async function loadLibrary() {
  state.library = await api('/api/library');
  renderLibraryGrid();
}

function openLibrary(mode = 'manage') {
  if (mode === 'select' && !selectedNode()) {
    setGenStatus('请先选择时间线节点，再选择参考图', 'error');
    return;
  }
  state.libraryMode = mode;
  const selecting = mode === 'select';
  els.libraryTitle.textContent = selecting ? '选择参考图' : '设定集管理';
  els.libraryKicker.textContent = selecting ? 'CHOOSE REFERENCES' : 'REFERENCE LIBRARY';
  els.libraryHint.textContent = selecting
    ? '点击图片进行多选；已选参考会用于当前节点出图'
    : '保存角色、场景、风格参考，之后可以重复使用';
  els.libraryFooter.hidden = !selecting;
  els.librarySearch.value = '';
  els.libraryPanel.hidden = false;
  els.libraryBackdrop.hidden = false;
  loadLibrary();
}

function closeLibraryPanel() {
  els.libraryPanel.hidden = true;
  els.libraryBackdrop.hidden = true;
}

function renderLibraryGrid() {
  const items = state.library.items || [];
  els.libraryGrid.innerHTML = '';
  const activeRefs = new Set(getGenRefs());
  const query = els.librarySearch.value.trim().toLowerCase();
  const visibleItems = items.filter((item) => item.name.toLowerCase().includes(query));

  if (visibleItems.length === 0) {
    els.libraryGrid.innerHTML = items.length
      ? '<p class="library-empty">没有匹配的设定</p>'
      : '<p class="library-empty">设定集还是空的<br>先上传角色、场景或风格图</p>';
    return;
  }

  for (const item of visibleItems) {
    const card = document.createElement('div');
    card.className = `library-card${activeRefs.has(item.imageUrl) ? ' selected' : ''}`;
    card.innerHTML = `
      <div class="library-card-image">
        <img src="${item.imageUrl}" alt="${escapeHtml(item.name)}" />
        <span class="library-card-check" aria-hidden="true">✓</span>
      </div>
      <div class="library-card-meta">
        <span class="library-card-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <button type="button" class="library-card-delete" aria-label="删除">×</button>
      </div>
      ${state.libraryMode === 'select'
        ? `<button type="button" class="library-card-select">${activeRefs.has(item.imageUrl) ? '已选作参考' : '选作参考'}</button>`
        : ''}
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.library-card-delete') || state.libraryMode !== 'select') return;
      if (activeRefs.has(item.imageUrl)) {
        removeGenRef(item.imageUrl);
      } else {
        addGenRef(item.imageUrl);
      }
      renderLibraryGrid();
    });

    card.querySelector('.library-card-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`从设定集删除「${item.name}」？`)) return;
      await api(`/api/library/${item.id}`, { method: 'DELETE' });
      removeGenRef(item.imageUrl);
      await loadLibrary();
    });

    els.libraryGrid.appendChild(card);
  }
  updateReferenceCount();
}

function showLibraryNameModal(imageUrl, defaultName = '') {
  state.pendingLibraryImageUrl = imageUrl;
  els.libraryNameInput.value = defaultName;
  els.libraryNameModal.hidden = false;
  els.libraryNameInput.focus();
}

function hideLibraryNameModal() {
  els.libraryNameModal.hidden = true;
  state.pendingLibraryImageUrl = null;
}

async function saveToLibrary(imageUrl, name) {
  await api('/api/library', {
    method: 'POST',
    body: JSON.stringify({ imageUrl, name }),
  });
  await loadLibrary();
  setGenStatus(`已加入设定集：${name}`, 'success');
}

async function uploadLibraryFile(file, name) {
  const form = new FormData();
  form.append('image', file);
  form.append('name', name || file.name.replace(/\.[^.]+$/, '') || '参考图');
  const res = await fetch('/api/library', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  await loadLibrary();
  return data;
}

async function uploadRefFile(file) {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch('/api/refs/upload', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  addGenRef(data.imageUrl);
  setGenStatus('参考图已添加', 'success');
}

function requestAddCurrentToLibrary() {
  const node = selectedNode();
  if (!node?.imageUrl) return;
  showLibraryNameModal(node.imageUrl, node.title || '');
}

async function confirmAddToLibrary() {
  const url = state.pendingLibraryImageUrl;
  const name = els.libraryNameInput.value.trim() || '未命名参考';
  if (!url) return;
  hideLibraryNameModal();
  try {
    await saveToLibrary(url, name);
  } catch (err) {
    setGenStatus(err.message, 'error');
  }
}

function truncate(text, len = 60) {
  if (!text) return '';
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

function updateTrackWidth() {
  const count = state.timeline.nodes.length;
  const minViewport = els.timelineScroll.clientWidth || 800;
  const contentWidth = Math.max(minViewport, count * NODE_WIDTH + TRACK_PADDING);
  els.timelineTrack.style.setProperty('--track-width', `${contentWidth}px`);
  updateScrollNav();
}

function updateScrollNav() {
  const el = els.timelineScroll;
  const canLeft = el.scrollLeft > 4;
  const canRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 4;
  els.scrollLeft.disabled = !canLeft;
  els.scrollRight.disabled = !canRight;
}

function scrollTimeline(direction) {
  const amount = els.timelineScroll.clientWidth * 0.7 * direction;
  els.timelineScroll.scrollBy({ left: amount, behavior: 'smooth' });
}

function renderImagePreview(url) {
  if (url) {
    els.imagePreview.innerHTML = `<img src="${url}?t=${Date.now()}" alt="分镜图" />`;
  } else {
    els.imagePreview.innerHTML = '<span class="image-placeholder">暂无图片</span>';
  }
}

function renderGenerationState() {
  const gen = state.generation;
  const visible = gen.nodeId === state.selectedId && gen.status !== 'idle';
  els.genProgressOverlay.hidden = !visible;
  if (!visible) return;

  els.genProgressOverlay.className = `gen-progress-overlay ${gen.status}`;
  els.genProgressMessage.textContent = gen.message;
  els.genProgressPercent.textContent = gen.status === 'error' ? '失败' : `${Math.round(gen.progress)}%`;
  els.genProgressBar.style.width = `${gen.progress}%`;
  els.retryGenerateBtn.hidden = gen.status !== 'error';
}

function clearGenerationTimer() {
  if (!state.generation.timerId) return;
  clearInterval(state.generation.timerId);
  state.generation.timerId = null;
}

function startGenerationProgress(request) {
  clearGenerationTimer();
  state.generation = {
    nodeId: request.nodeId,
    status: 'loading',
    progress: 4,
    message: '正在准备图片…',
    lastRequest: request,
    timerId: null,
  };
  const startedAt = Date.now();
  state.generation.timerId = setInterval(() => {
    const gen = state.generation;
    if (gen.status !== 'loading') return;
    const elapsed = Date.now() - startedAt;
    gen.progress = Math.min(92, gen.progress + Math.max(0.6, (92 - gen.progress) * 0.035));
    gen.message = elapsed < 2500 ? '正在上传参考信息…' : '模型正在生成画面…';
    renderGenerationState();
  }, 500);
  renderGenerationState();
}

function finishGeneration(status, message) {
  clearGenerationTimer();
  state.generation.status = status;
  state.generation.message = message;
  state.generation.progress = status === 'success' ? 100 : Math.max(8, state.generation.progress);
  renderGenerationState();
}

function clearDropIndicators() {
  for (const el of els.nodesLayer.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
  for (const el of els.nodesLayer.querySelectorAll('.drop-zone-edge.active')) {
    el.classList.remove('active');
  }
}

function setEdgeDrop(active) {
  const start = els.nodesLayer.querySelector('.drop-zone-edge.drop-start');
  const end = els.nodesLayer.querySelector('.drop-zone-edge.drop-end');
  start?.classList.toggle('active', active === 'start');
  end?.classList.toggle('active', active === 'end');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function bindNodeDrag(el, node) {
  el.addEventListener('dragstart', (e) => {
    state.dragId = node.id;
    state.lastDragAt = Date.now();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
    els.timelineScroll.classList.add('is-dragging');
    startAutoScroll();
    requestAnimationFrame(() => el.classList.add('dragging'));
  });

  el.addEventListener('dragend', () => {
    state.dragId = null;
    state.lastDragAt = Date.now();
    state.dropTarget = null;
    state.pointerX = null;
    clearDropIndicators();
    stopAutoScroll();
    els.timelineScroll.classList.remove('is-dragging');
    el.classList.remove('dragging');
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    state.pointerX = e.clientX;
    if (state.dragId === node.id) {
      clearDropIndicators();
      return;
    }
    const rect = el.getBoundingClientRect();
    const position = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    if (state.dropTarget?.id !== node.id || state.dropTarget.position !== position) {
      clearDropIndicators();
      state.dropTarget = { id: node.id, position };
      el.classList.add(`drop-${position}`);
    }
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    state.lastDragAt = Date.now();
    const fromId = e.dataTransfer.getData('text/plain');
    const toId = node.id;
    if (fromId && fromId !== toId) {
      reorderNodes(fromId, toId, state.dropTarget?.position || 'before');
    }
    state.dropTarget = null;
    clearDropIndicators();
  });
}

function bindEdgeDropZone(el, edge) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    state.pointerX = e.clientX;
    if (!state.dragId) return;
    clearDropIndicators();
    state.dropTarget = { edge };
    el.classList.add('active');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    state.lastDragAt = Date.now();
    const fromId = e.dataTransfer.getData('text/plain');
    if (!fromId) return;
    if (edge === 'start') {
      reorderNodesToIndex(fromId, 0);
    } else {
      reorderNodesToIndex(fromId, state.timeline.nodes.length - 1);
    }
    state.dropTarget = null;
    clearDropIndicators();
  });
}

function renderNodes() {
  els.nodesLayer.innerHTML = '';

  if (state.timeline.nodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'timeline-hint';
    empty.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);white-space:nowrap;';
    empty.textContent = '还没有节点，点击「添加节点」开始';
    els.nodesLayer.appendChild(empty);
    updateTrackWidth();
    return;
  }

  const startZone = document.createElement('div');
  startZone.className = 'drop-zone-edge drop-start';
  bindEdgeDropZone(startZone, 'start');
  els.nodesLayer.appendChild(startZone);

  for (const node of state.timeline.nodes) {
    const el = document.createElement('div');
    el.className = `timeline-node side-${node.side}${node.id === state.selectedId ? ' selected' : ''}${state.dragId === node.id ? ' dragging' : ''}`;
    el.dataset.id = node.id;
    el.draggable = true;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${node.timeLabel ? `${node.timeLabel}，` : ''}${node.title || '未命名节点'}，拖拽可排序`);

    el.innerHTML = `
      <div class="node-tick"></div>
      <div class="node-dot"></div>
      <div class="node-card">
        ${node.timeLabel ? `<div class="node-time">${escapeHtml(node.timeLabel)}</div>` : ''}
        <div class="node-title">${escapeHtml(node.title || '未命名')}</div>
        ${node.script ? `<div class="node-script-preview">${escapeHtml(truncate(node.script))}</div>` : ''}
        ${node.imageUrl ? `<img class="node-thumb" src="${node.imageUrl}" alt="" />` : ''}
      </div>
    `;

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNode(node.id);
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectNode(node.id);
      }
    });

    bindNodeDrag(el, node);
    els.nodesLayer.appendChild(el);
  }

  const endZone = document.createElement('div');
  endZone.className = 'drop-zone-edge drop-end';
  bindEdgeDropZone(endZone, 'end');
  els.nodesLayer.appendChild(endZone);

  updateTrackWidth();
}

function renderEditor() {
  const node = selectedNode();
  if (!node) {
    els.editorPanel.hidden = true;
    els.editorEmpty.hidden = false;
    updateNodeActions();
    return;
  }

  els.editorPanel.hidden = false;
  els.editorEmpty.hidden = true;

  els.fieldTitle.value = node.title || '';
  els.fieldTime.value = node.timeLabel || '';
  els.fieldDuration.value = (nodeDuration(node) / 1000).toFixed(1);
  els.fieldCamera.value = node.cameraPreset || 'static';
  els.fieldScript.value = node.script || '';
  els.fieldSubtitle.value = node.subtitle || '';
  els.genPrompt.value = node.imagePrompt || '';
  renderImagePreview(node.imageUrl);
  renderRefChips();
  updateImageActions();
  updateNodeActions();
  renderGenerationState();
  if (state.generation.nodeId === node.id && state.generation.status === 'error') {
    setGenStatus(state.generation.message, 'error');
  } else if (state.generation.nodeId === node.id && state.generation.status === 'loading') {
    setGenStatus('图片生成中…', 'loading');
  } else {
    setGenStatus('');
  }
}

function renderProviderSelect() {
  const select = els.genProvider;
  select.innerHTML = '';

  if (state.providers.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '未配置 API（见 .env）';
    select.appendChild(opt);
    select.disabled = true;
    els.generateBtn.disabled = true;
    return;
  }

  select.disabled = false;
  els.generateBtn.disabled = false;

  for (const provider of state.providers) {
    const group = document.createElement('optgroup');
    group.label = provider.label;
    for (const model of provider.models) {
      const opt = document.createElement('option');
      opt.value = `${provider.id}::${model.id}`;
      opt.textContent = model.label;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

function setGenStatus(msg, type = '') {
  if (!msg) {
    els.genStatus.hidden = true;
    els.genStatus.textContent = '';
    els.genStatus.className = 'gen-status';
    return;
  }
  els.genStatus.hidden = false;
  els.genStatus.textContent = msg;
  els.genStatus.className = `gen-status ${type}`;
}

function startAutoScroll() {
  if (state.autoScrollRaf) return;

  const tick = () => {
    if (!state.dragId || state.pointerX == null) {
      state.autoScrollRaf = null;
      return;
    }

    const rect = els.timelineScroll.getBoundingClientRect();
    const x = state.pointerX;

    let speed = 0;
    const leftDist = x - rect.left;
    const rightDist = rect.right - x;

    if (leftDist < SCROLL_EDGE && leftDist >= 0) {
      speed = -SCROLL_MAX_SPEED * (1 - leftDist / SCROLL_EDGE);
    } else if (rightDist < SCROLL_EDGE && rightDist >= 0) {
      speed = SCROLL_MAX_SPEED * (1 - rightDist / SCROLL_EDGE);
    } else if (x < rect.left) {
      speed = -SCROLL_MAX_SPEED;
    } else if (x > rect.right) {
      speed = SCROLL_MAX_SPEED;
    }

    if (speed !== 0) {
      els.timelineScroll.scrollLeft += speed;
      updateScrollNav();
    }

    state.autoScrollRaf = requestAnimationFrame(tick);
  };

  state.autoScrollRaf = requestAnimationFrame(tick);
}

function stopAutoScroll() {
  if (state.autoScrollRaf) {
    cancelAnimationFrame(state.autoScrollRaf);
    state.autoScrollRaf = null;
  }
}

function showDeleteModal(node) {
  const title = node.title || '未命名';
  els.deleteModalBody.innerHTML = `确定删除节点 <strong>「${escapeHtml(title)}」</strong>？<br>删除后可在 5 秒内撤销。`;
  els.deleteConfirm.textContent = `删除「${title}」`;
  els.deleteModal.hidden = false;
  els.deleteConfirm.focus();
}

function hideDeleteModal() {
  els.deleteModal.hidden = true;
}

function showUndoToast(label) {
  els.undoMessage.textContent = `已删除「${label}」`;
  els.undoToast.hidden = false;
}

function hideUndoToast() {
  els.undoToast.hidden = true;
}

function cancelPendingDelete() {
  if (!state.pendingDelete) return;
  clearTimeout(state.pendingDelete.timerId);
  state.pendingDelete = null;
  hideUndoToast();
}

async function commitPendingDelete() {
  const pending = state.pendingDelete;
  if (!pending) return;
  state.pendingDelete = null;
  hideUndoToast();

  try {
    await api(`/api/nodes/${pending.node.id}`, { method: 'DELETE' });
  } catch (err) {
    state.timeline.nodes.splice(pending.index, 0, pending.node);
    state.timeline.nodes.forEach((n, i) => {
      n.side = i % 2 === 0 ? 'up' : 'down';
    });
    renderNodes();
    setGenStatus(`删除失败，已恢复：${err.message}`, 'error');
  }
}

function undoDelete() {
  const pending = state.pendingDelete;
  if (!pending) return;

  clearTimeout(pending.timerId);
  state.pendingDelete = null;
  hideUndoToast();

  state.timeline.nodes.splice(pending.index, 0, pending.node);
  state.timeline.nodes.forEach((n, i) => {
    n.side = i % 2 === 0 ? 'up' : 'down';
  });
  state.selectedId = pending.node.id;
  renderNodes();
  renderEditor();
}

async function loadTimeline() {
  state.timeline = await api('/api/timeline');
  els.timelineTitle.value = state.timeline.title || '';
  renderNodes();
  renderEditor();
}

async function loadProviders() {
  state.providers = await api('/api/providers');
  renderProviderSelect();
}

function selectNode(id) {
  state.selectedId = id;
  renderNodes();
  renderEditor();
}

async function saveTitle() {
  state.timeline.title = els.timelineTitle.value;
  await api('/api/timeline', {
    method: 'PUT',
    body: JSON.stringify({ title: state.timeline.title }),
  });
}

async function saveNodeFields({ announce = true } = {}) {
  const node = selectedNode();
  if (!node) return;

  const payload = {
    title: els.fieldTitle.value,
    timeLabel: els.fieldTime.value,
    durationMs: Math.min(600000, Math.max(500, Number(els.fieldDuration.value || 4) * 1000)),
    cameraPreset: els.fieldCamera.value || 'static',
    script: els.fieldScript.value,
    subtitle: els.fieldSubtitle.value,
    imagePrompt: els.genPrompt.value,
  };

  const updated = await api(`/api/nodes/${node.id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) {
    state.timeline.nodes[idx] = { ...state.timeline.nodes[idx], ...updated };
  }
  renderNodes();
  if (announce) {
    setGenStatus(state.autoSave ? '已保存' : '已手动保存', 'success');
  }
}

function scheduleAutoSave() {
  if (!state.autoSave || !selectedNode()) return;
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(async () => {
    try {
      await saveNodeFields({ announce: false });
      setGenStatus('已自动保存', 'success');
    } catch (err) {
      setGenStatus(`自动保存失败：${err.message}`, 'error');
    }
  }, 700);
}

async function addNode(index) {
  const node = await api('/api/nodes', {
    method: 'POST',
    body: JSON.stringify({ index }),
  });
  await loadTimeline();
  selectNode(node.id);
  requestAnimationFrame(() => {
    const el = els.nodesLayer.querySelector(`[data-id="${node.id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
}

function requestDeleteNode() {
  const node = selectedNode();
  if (!node) return;
  showDeleteModal(node);
}

function confirmDeleteNode() {
  const node = selectedNode();
  if (!node) return;

  hideDeleteModal();
  cancelPendingDelete();

  const index = state.timeline.nodes.findIndex((n) => n.id === node.id);
  if (index < 0) return;

  const el = els.nodesLayer.querySelector(`[data-id="${node.id}"]`);
  if (el) el.classList.add('removing');

  const label = node.title || '未命名';
  const nodeCopy = { ...node };

  setTimeout(() => {
    state.timeline.nodes.splice(index, 1);
    state.timeline.nodes.forEach((n, i) => {
      n.side = i % 2 === 0 ? 'up' : 'down';
    });
    state.selectedId = null;
    renderNodes();
    renderEditor();

    const timerId = setTimeout(() => {
      commitPendingDelete();
    }, UNDO_MS);

    state.pendingDelete = { node: nodeCopy, index, timerId };
    showUndoToast(label);
  }, 220);
}

async function reorderNodes(fromId, toId, position) {
  const previousNodes = [...state.timeline.nodes];
  const nodes = [...state.timeline.nodes];
  const fromIdx = nodes.findIndex((node) => node.id === fromId);
  const toIdx = nodes.findIndex((node) => node.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;

  const [moved] = nodes.splice(fromIdx, 1);
  const targetIdx = nodes.findIndex((node) => node.id === toId);
  const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
  nodes.splice(insertIdx, 0, moved);
  applyNodeSides(nodes);

  state.timeline.nodes = nodes;
  renderNodes();

  try {
    state.timeline = await api('/api/nodes/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: nodes.map((node) => node.id) }),
    });
    renderNodes();
  } catch (err) {
    state.timeline.nodes = previousNodes;
    renderNodes();
    setGenStatus(`排序保存失败：${err.message}`, 'error');
  }
}

async function reorderNodesToIndex(fromId, targetIndex) {
  const previousNodes = [...state.timeline.nodes];
  const nodes = [...state.timeline.nodes];
  const fromIdx = nodes.findIndex((node) => node.id === fromId);
  if (fromIdx < 0) return;

  const [moved] = nodes.splice(fromIdx, 1);
  const clamped = Math.max(0, Math.min(targetIndex, nodes.length));
  nodes.splice(clamped, 0, moved);
  applyNodeSides(nodes);

  state.timeline.nodes = nodes;
  renderNodes();

  try {
    state.timeline = await api('/api/nodes/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: nodes.map((node) => node.id) }),
    });
    renderNodes();
  } catch (err) {
    state.timeline.nodes = previousNodes;
    renderNodes();
    setGenStatus(`排序保存失败：${err.message}`, 'error');
  }
}

function applyNodeSides(nodes) {
  nodes.forEach((node, index) => {
    node.side = index % 2 === 0 ? 'up' : 'down';
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('script-flow-theme', theme);
  const isLight = theme === 'light';
  els.themeIcon.textContent = isLight ? '☾' : '☀';
  els.themeToggle.setAttribute('aria-label', isLight ? '切换深色模式' : '切换浅色模式');
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

async function uploadImage(file) {
  const node = selectedNode();
  if (!node || !file) return;

  const form = new FormData();
  form.append('image', file);

  const res = await fetch(`/api/nodes/${node.id}/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');

  const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) {
    state.timeline.nodes[idx] = data.node;
  }
  renderImagePreview(data.imageUrl);
  renderNodes();
  updateImageActions();
}

async function generateImage(previousRequest = null) {
  const node = previousRequest
    ? state.timeline.nodes.find((item) => item.id === previousRequest.nodeId)
    : selectedNode();
  if (!node) return;

  const [provider, model] = previousRequest
    ? [previousRequest.provider, previousRequest.model]
    : els.genProvider.value.split('::');
  const prompt = previousRequest?.prompt ?? els.genPrompt.value.trim();
  if (!provider || !prompt) {
    setGenStatus('请选择模型并填写 prompt', 'error');
    return;
  }

  const request = previousRequest || {
    nodeId: node.id,
    provider,
    model,
    prompt,
    size: els.genSize.value,
    referenceUrls: [...getGenRefs()],
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  els.generateBtn.disabled = true;
  setGenStatus('图片生成中…', 'loading');
  startGenerationProgress(request);

  try {
    const data = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) {
      state.timeline.nodes[idx] = data.node;
    }
    renderNodes();
    finishGeneration('success', '生成完成');
    if (state.selectedId === node.id) {
      renderImagePreview(data.imageUrl);
      setGenStatus('已生成并应用到节点', 'success');
    }
    setTimeout(() => {
      if (state.generation.nodeId === node.id && state.generation.status === 'success') {
        state.generation.status = 'idle';
        renderGenerationState();
      }
    }, 900);
  } catch (err) {
    finishGeneration('error', err.message);
    if (state.selectedId === node.id) {
      setGenStatus(err.message, 'error');
    }
  } finally {
    clearTimeout(timeoutId);
    els.generateBtn.disabled = state.providers.length === 0;
  }
}

function previewStartForIndex(index) {
  return state.timeline.nodes
    .slice(0, Math.max(0, index))
    .reduce((sum, node) => sum + nodeDuration(node), 0);
}

function updatePreviewProgress() {
  const total = previewTotalDuration();
  const elapsed = Math.min(Math.max(0, state.preview.elapsed), total);
  els.previewCurrentTime.textContent = formatTime(elapsed);
  els.previewTotalTime.textContent = formatTime(total);
  els.previewProgress.max = String(Math.max(1, total));
  els.previewProgress.value = String(elapsed);
}

function renderPreviewScene(index, localElapsed = 0) {
  const node = state.timeline.nodes[index];
  if (!node) return;

  state.preview.currentIndex = index;
  els.previewNodeCount.textContent = `${index + 1} / ${state.timeline.nodes.length}`;
  els.previewSceneTime.textContent = node.timeLabel || formatTime(previewStartForIndex(index));
  els.previewSceneTitle.textContent = node.title || '未命名节点';
  els.previewSceneCamera.textContent = CAMERA_LABELS[node.cameraPreset] || CAMERA_LABELS.static;
  const subtitle = nodeSubtitle(node);
  els.previewCaption.textContent = subtitle;
  els.previewCaption.hidden = !subtitle;
  els.previewNoImage.hidden = Boolean(node.imageUrl);
  els.previewImage.hidden = !node.imageUrl;

  const camera = node.cameraPreset || 'static';
  els.previewImage.className = `preview-image camera-${camera}`;
  els.previewImage.style.setProperty('--preview-duration', `${nodeDuration(node) / 1000}s`);
  els.previewImage.style.animationDelay = `-${Math.min(localElapsed, nodeDuration(node) - 1)}ms`;
  els.previewImage.alt = node.title || '';
  if (node.imageUrl) {
    els.previewImage.src = `${node.imageUrl}?preview=${Date.now()}`;
  } else {
    els.previewImage.removeAttribute('src');
  }
  els.previewStage.classList.toggle('is-paused', !state.preview.playing);
}

function renderPreviewState() {
  const scene = previewNodeAt(state.preview.elapsed);
  renderPreviewScene(scene.index, scene.localElapsed);
  updatePreviewProgress();
  els.previewPlay.textContent = state.preview.playing ? 'Ⅱ 暂停' : '▶ 播放';
}

function stopPreviewLoop() {
  if (state.preview.rafId) {
    cancelAnimationFrame(state.preview.rafId);
    state.preview.rafId = null;
  }
}

function previewTick(now) {
  if (!state.preview.playing) return;
  state.preview.elapsed = now - state.preview.startedAt;
  const total = previewTotalDuration();

  if (state.preview.elapsed >= total) {
    state.preview.elapsed = total;
    state.preview.playing = false;
    stopPreviewLoop();
    renderPreviewState();
    return;
  }

  const scene = previewNodeAt(state.preview.elapsed);
  if (scene.index !== state.preview.currentIndex) {
    renderPreviewScene(scene.index, scene.localElapsed);
  }
  updatePreviewProgress();
  state.preview.rafId = requestAnimationFrame(previewTick);
}

function playPreview() {
  if (!state.timeline.nodes.length) return;
  const total = previewTotalDuration();
  if (state.preview.elapsed >= total) state.preview.elapsed = 0;
  state.preview.playing = true;
  state.preview.startedAt = performance.now() - state.preview.elapsed;
  els.previewStage.classList.remove('is-paused');
  els.previewPlay.textContent = 'Ⅱ 暂停';
  stopPreviewLoop();
  state.preview.rafId = requestAnimationFrame(previewTick);
}

function pausePreview() {
  if (!state.preview.playing) return;
  state.preview.elapsed = performance.now() - state.preview.startedAt;
  state.preview.playing = false;
  stopPreviewLoop();
  renderPreviewState();
}

function setPreviewElapsed(elapsed, resume = state.preview.playing) {
  const total = previewTotalDuration();
  state.preview.elapsed = Math.min(Math.max(0, elapsed), total);
  const scene = previewNodeAt(state.preview.elapsed);
  state.preview.currentIndex = scene.index;
  if (resume) {
    state.preview.playing = true;
    state.preview.startedAt = performance.now() - state.preview.elapsed;
    renderPreviewScene(scene.index, scene.localElapsed);
    stopPreviewLoop();
    state.preview.rafId = requestAnimationFrame(previewTick);
  } else {
    state.preview.playing = false;
    stopPreviewLoop();
    renderPreviewState();
  }
}

function openPreview() {
  if (!state.timeline.nodes.length) {
    setGenStatus('先添加至少一个节点，再开始预览', 'error');
    return;
  }
  state.preview.open = true;
  state.preview.elapsed = 0;
  state.preview.currentIndex = 0;
  state.preview.playing = false;
  els.previewTitle.textContent = state.timeline.title || 'Script Flow';
  els.previewOverlay.hidden = false;
  renderPreviewState();
  playPreview();
}

function closePreview() {
  state.preview.open = false;
  state.preview.playing = false;
  stopPreviewLoop();
  els.previewOverlay.hidden = true;
}

function bindEvents() {
  els.timelineTitle.addEventListener('change', saveTitle);
  els.timelineTitle.addEventListener('blur', saveTitle);

  els.addNodeBtn.addEventListener('click', () => addNode());
  els.themeToggle.addEventListener('click', toggleTheme);
  els.previewBtn.addEventListener('click', async () => {
    try {
      if (selectedNode()) await saveNodeFields();
      openPreview();
    } catch (err) {
      setGenStatus(`预览前保存失败：${err.message}`, 'error');
    }
  });

  els.scrollLeft.addEventListener('click', () => scrollTimeline(-1));
  els.scrollRight.addEventListener('click', () => scrollTimeline(1));
  els.timelineScroll.addEventListener('scroll', updateScrollNav);

  els.timelineScroll.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    els.timelineScroll.scrollLeft += e.deltaY;
    updateScrollNav();
  }, { passive: false });

  els.timelineScroll.addEventListener('dragover', (e) => {
    e.preventDefault();
    state.pointerX = e.clientX;
    if (!state.dragId) return;
    startAutoScroll();
  });

  els.timelineScroll.addEventListener('dblclick', (e) => {
    if (e.target.closest('.timeline-node') || Date.now() - state.lastDragAt < 700) return;
    addNode();
  });

  els.closeEditor.addEventListener('click', () => {
    state.selectedId = null;
    renderNodes();
    renderEditor();
  });

  els.nodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveNodeFields();
  });

  els.saveNodeTopBtn.addEventListener('click', async () => {
    clearTimeout(state.autoSaveTimer);
    await saveNodeFields({ announce: true });
  });
  els.deleteNodeTopBtn.addEventListener('click', requestDeleteNode);
  els.autoSaveToggle.checked = state.autoSave;
  els.autoSaveToggle.addEventListener('change', () => {
    state.autoSave = els.autoSaveToggle.checked;
    localStorage.setItem('script-flow-autosave', String(state.autoSave));
    if (!state.autoSave) {
      clearTimeout(state.autoSaveTimer);
      setGenStatus('自动保存已关闭', '');
    } else {
      setGenStatus('自动保存已开启', 'success');
      scheduleAutoSave();
    }
  });
  [
    els.fieldTitle,
    els.fieldTime,
    els.fieldDuration,
    els.fieldScript,
    els.fieldSubtitle,
    els.genPrompt,
  ].forEach((field) => field.addEventListener('input', scheduleAutoSave));
  els.fieldCamera.addEventListener('change', scheduleAutoSave);
  els.deleteCancel.addEventListener('click', hideDeleteModal);
  els.deleteConfirm.addEventListener('click', confirmDeleteNode);
  els.deleteModal.addEventListener('click', (e) => {
    if (e.target === els.deleteModal) hideDeleteModal();
  });
  els.undoBtn.addEventListener('click', undoDelete);

  els.imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadImage(file);
      updateImageActions();
      setGenStatus('图片已上传', 'success');
    } catch (err) {
      setGenStatus(err.message, 'error');
    }
    e.target.value = '';
  });

  els.fillPromptBtn.addEventListener('click', () => {
    const script = els.fieldScript.value.trim();
    if (script) {
      els.genPrompt.value = script;
    }
  });

  els.generateBtn.addEventListener('click', () => generateImage());
  els.retryGenerateBtn.addEventListener('click', () => {
    if (state.generation.lastRequest) generateImage(state.generation.lastRequest);
  });

  els.previewClose.addEventListener('click', closePreview);
  els.previewPlay.addEventListener('click', () => {
    if (state.preview.playing) pausePreview();
    else playPreview();
  });
  els.previewRestart.addEventListener('click', () => setPreviewElapsed(0, false));
  els.previewPrev.addEventListener('click', () => {
    setPreviewElapsed(previewStartForIndex(Math.max(0, state.preview.currentIndex - 1)), false);
  });
  els.previewNext.addEventListener('click', () => {
    setPreviewElapsed(
      previewStartForIndex(Math.min(state.timeline.nodes.length - 1, state.preview.currentIndex + 1)),
      false,
    );
  });
  els.previewProgress.addEventListener('input', (event) => {
    setPreviewElapsed(Number(event.target.value), false);
  });
  els.previewOverlay.addEventListener('click', (event) => {
    if (event.target === els.previewOverlay) closePreview();
  });

  els.libraryBtn.addEventListener('click', () => openLibrary('manage'));
  els.chooseLibraryRefBtn.addEventListener('click', () => openLibrary('select'));
  els.closeLibrary.addEventListener('click', closeLibraryPanel);
  els.libraryBackdrop.addEventListener('click', closeLibraryPanel);
  els.libraryDoneBtn.addEventListener('click', closeLibraryPanel);
  els.librarySearch.addEventListener('input', renderLibraryGrid);

  els.addToLibraryBtn.addEventListener('click', requestAddCurrentToLibrary);
  els.libraryNameCancel.addEventListener('click', hideLibraryNameModal);
  els.libraryNameConfirm.addEventListener('click', confirmAddToLibrary);

  els.useCurrentRefBtn.addEventListener('click', () => {
    const node = selectedNode();
    if (node?.imageUrl) addGenRef(node.imageUrl);
  });

  els.refUpload.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadRefFile(file);
    } catch (err) {
      setGenStatus(err.message, 'error');
    }
    e.target.value = '';
  });

  els.libraryUpload.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const item = await uploadLibraryFile(file);
      if (state.selectedId) addGenRef(item.imageUrl);
      setGenStatus(`已上传：${item.name}`, 'success');
    } catch (err) {
      setGenStatus(err.message, 'error');
    }
    e.target.value = '';
  });

  document.addEventListener('keydown', (e) => {
    if (state.preview.open) {
      if (e.key === 'Escape') {
        closePreview();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (state.preview.playing) pausePreview();
        else playPreview();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPreviewElapsed(previewStartForIndex(Math.max(0, state.preview.currentIndex - 1)), false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPreviewElapsed(
          previewStartForIndex(Math.min(state.timeline.nodes.length - 1, state.preview.currentIndex + 1)),
          false,
        );
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      clearTimeout(state.autoSaveTimer);
      Promise.all([
        selectedNode() ? saveNodeFields({ announce: true }) : Promise.resolve(),
        saveTitle(),
      ]).catch((err) => setGenStatus(`保存失败：${err.message}`, 'error'));
      return;
    }
    if (e.key === 'Escape') {
      if (!els.deleteModal.hidden) hideDeleteModal();
      else if (!els.libraryNameModal.hidden) hideLibraryNameModal();
      else if (!els.libraryPanel.hidden) closeLibraryPanel();
    }
  });

  window.addEventListener('resize', updateTrackWidth);
}

async function init() {
  const savedTheme = localStorage.getItem('script-flow-theme');
  const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(savedTheme || preferredTheme);
  bindEvents();
  await Promise.all([loadTimeline(), loadProviders(), loadLibrary()]);
}

init();
