const NODE_HEIGHT = 112;
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
  pointerY: null,
  autoScrollRaf: null,
  pendingDelete: null,
  library: { items: [] },
  genRefs: {},
  pendingLibraryImageUrl: null,
  libraryMode: 'manage',
  promptLibrary: { items: [] },
  editingPromptId: null,
  autoSave: localStorage.getItem('script-flow-autosave') !== 'false',
  autoSaveTimer: null,
  generations: {},
  flipbook: {
    mode: 'single',
    templateId: null,
    templateName: '',
    templateContent: '',
    pickingTemplate: false,
    previewPlaying: false,
    previewIndex: 0,
    previewTimer: null,
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
  workspace: $('.workspace'),
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
  timelineNodeCount: $('#timeline-node-count'),
  scrollLeft: $('#scroll-left'),
  scrollRight: $('#scroll-right'),
  timelineResizer: $('#timeline-resizer'),
  editorResizer: $('#editor-resizer'),
  workbenchTitle: $('#workbench-title'),
  workbenchTime: $('#workbench-time'),
  workbenchPreviewBtn: $('#workbench-preview-btn'),
  editorPanel: $('#editor-panel'),
  editorEmpty: $('#editor-empty'),
  closeEditor: $('#close-editor'),
  nodeForm: $('#node-form'),
  fieldTitle: $('#field-title'),
  fieldStartTime: $('#field-start-time'),
  fieldIncludePreview: $('#field-include-preview'),
  fieldDuration: $('#field-duration'),
  fieldCamera: $('#field-camera'),
  fieldScript: $('#field-script'),
  fieldSubtitle: $('#field-subtitle'),
  imagePreviewShell: $('.image-preview-shell'),
  imagePreview: $('#image-preview'),
  imageUpload: $('#image-upload'),
  genProvider: $('#gen-provider'),
  genMode: $('#gen-mode'),
  genSize: $('#gen-size'),
  genPrompt: $('#gen-prompt'),
  flipbookControls: $('#flipbook-controls'),
  flipbookFramesLabel: $('#flipbook-frames-label'),
  flipbookFrames: $('#flipbook-frames'),
  flipbookFps: $('#flipbook-fps'),
  flipbookGridHint: $('#flipbook-grid-hint'),
  flipbookClarityHint: $('#flipbook-clarity-hint'),
  flipbookTemplateName: $('#flipbook-template-name'),
  flipbookPickTemplateBtn: $('#flipbook-pick-template-btn'),
  flipbookFinalPreview: $('#flipbook-final-preview'),
  chain32Controls: $('#chain32-controls'),
  chain32Progress: $('#chain32-progress'),
  chain32SegmentPrompts: [...document.querySelectorAll('.chain32-segment-prompt')],
  interpolationControls: $('#interpolation-controls'),
  interpolationProgress: $('#interpolation-progress'),
  flipbookResult: $('#flipbook-result'),
  flipbookFramesStrip: $('#flipbook-frames-strip'),
  saveFlipbookFrameBtn: $('#save-flipbook-frame-btn'),
  flipbookPlayBtn: $('#flipbook-play-btn'),
  referenceMentionMenu: $('#reference-mention-menu'),
  promptReferenceTags: $('#prompt-reference-tags'),
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
  imageLightbox: $('#image-lightbox'),
  lightboxImage: $('#lightbox-image'),
  lightboxClose: $('#lightbox-close'),
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
  promptLibraryBtn: $('#prompt-library-btn'),
  promptLibraryPanel: $('#prompt-library-panel'),
  promptLibraryBackdrop: $('#prompt-library-backdrop'),
  closePromptLibrary: $('#close-prompt-library'),
  promptLibrarySearch: $('#prompt-library-search'),
  promptLibraryList: $('#prompt-library-list'),
  promptLibraryForm: $('#prompt-library-form'),
  promptLibraryName: $('#prompt-library-name'),
  promptLibraryContent: $('#prompt-library-content'),
  newPromptBtn: $('#new-prompt-btn'),
  saveCurrentPromptBtn: $('#save-current-prompt-btn'),
  cancelPromptEditBtn: $('#cancel-prompt-edit-btn'),
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

const FLIPBOOK_LAYOUTS = {
  4: { columns: 2, rows: 2 },
  8: { columns: 4, rows: 2 },
  16: { columns: 4, rows: 4 },
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
  return Number.isFinite(value) && value >= 500 ? Math.min(value, 600000) : 2000;
}

function nodeAnimation(node = selectedNode()) {
  const animation = node?.animation;
  if (!animation || !Array.isArray(animation.frameUrls) || animation.frameUrls.length === 0) {
    return null;
  }
  return animation;
}

function flipbookLayout(frameCount = Number(els.flipbookFrames.value)) {
  return FLIPBOOK_LAYOUTS[frameCount] || FLIPBOOK_LAYOUTS[4];
}

function normalizeFps(value, fallback = 4) {
  const fps = Number(value);
  if (!Number.isFinite(fps)) return fallback;
  return Math.min(30, Math.max(1, Math.round(fps)));
}

function fillFlipbookTemplate(template, userPrompt, frameCount) {
  const layout = flipbookLayout(frameCount);
  return template
    .replaceAll('{frameCount}', String(frameCount))
    .replaceAll('{columns}', String(layout.columns))
    .replaceAll('{rows}', String(layout.rows))
    .replaceAll('{userPrompt}', userPrompt);
}

function composeFlipbookPrompt(
  userPrompt = els.genPrompt.value.trim(),
  frameCountOverride = null,
) {
  const frameCount = frameCountOverride || Number(els.flipbookFrames.value) || 4;
  const layout = flipbookLayout(frameCount);
  const template = state.flipbook.templateContent || '';
  if (!template) {
    return {
      prompt: userPrompt,
      missing: userPrompt ? [] : ['userPrompt'],
      frameCount,
      ...layout,
    };
  }
  const missing = [];
  if (template.includes('{userPrompt}') && !userPrompt) missing.push('userPrompt');
  const prompt = fillFlipbookTemplate(template, userPrompt, frameCount);
  return { prompt, missing, frameCount, ...layout };
}

function stopFlipbookPreview() {
  if (state.flipbook.previewTimer) {
    clearInterval(state.flipbook.previewTimer);
    state.flipbook.previewTimer = null;
  }
  state.flipbook.previewPlaying = false;
  if (els.flipbookPlayBtn) {
    els.flipbookPlayBtn.textContent = '▶ 播放';
  }
}

function showFlipbookFrame(index) {
  const animation = nodeAnimation();
  if (!animation) return;
  const urls = animation.frameUrls;
  const safeIndex = ((index % urls.length) + urls.length) % urls.length;
  state.flipbook.previewIndex = safeIndex;
  els.saveFlipbookFrameBtn.textContent = `存第 ${safeIndex + 1} 帧`;
  renderImagePreview(urls[safeIndex]);
  for (const thumb of els.flipbookFramesStrip.querySelectorAll('.flipbook-frame-thumb')) {
    thumb.classList.toggle('active', Number(thumb.dataset.index) === safeIndex);
  }
}

function playFlipbookPreview() {
  const animation = nodeAnimation();
  if (!animation) return;
  stopFlipbookPreview();
  state.flipbook.previewPlaying = true;
  els.flipbookPlayBtn.textContent = 'Ⅱ 暂停';
  const fps = normalizeFps(els.flipbookFps.value || animation.fps, animation.fps || 4);
  state.flipbook.previewTimer = setInterval(() => {
    showFlipbookFrame(state.flipbook.previewIndex + 1);
  }, Math.max(33, Math.round(1000 / fps)));
}

function renderFlipbookResult() {
  const animation = nodeAnimation();
  stopFlipbookPreview();
  els.flipbookResult.classList.toggle(
    'chain32',
    animation?.mode === 'chain32' || animation?.mode === 'interpolate32',
  );
  if (!animation) {
    els.flipbookResult.hidden = true;
    els.flipbookFramesStrip.innerHTML = '';
    els.saveFlipbookFrameBtn.textContent = '存当前帧';
    return;
  }

  els.flipbookResult.hidden = false;
  els.flipbookFramesStrip.innerHTML = '';
  animation.frameUrls.forEach((url, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `flipbook-frame-thumb${index === state.flipbook.previewIndex ? ' active' : ''}`;
    button.dataset.index = String(index);
    button.innerHTML = `<img src="${url}" alt="帧 ${index + 1}" /><span>${index + 1}</span>`;
    button.addEventListener('click', () => {
      stopFlipbookPreview();
      showFlipbookFrame(index);
    });
    els.flipbookFramesStrip.appendChild(button);
  });
}

function chain32PromptValues() {
  return els.chain32SegmentPrompts.map((input) => input.value.trim());
}

function loadChain32State(node = selectedNode()) {
  const animation = nodeAnimation(node);
  const prompts = animation?.mode === 'chain32' ? animation.segmentPrompts || [] : [];
  els.chain32SegmentPrompts.forEach((input, index) => {
    input.value = prompts[index] || '';
  });
  renderChain32Progress(node);
}

function renderChain32Progress(node = selectedNode()) {
  const animation = nodeAnimation(node);
  const completed = animation?.mode === 'chain32' ? animation.segments?.length || 0 : 0;
  for (const [index, marker] of [...els.chain32Progress.children].entries()) {
    marker.className = index < completed ? 'complete' : index === completed ? 'current' : '';
    marker.title = index < completed ? `第 ${index + 1} 段已完成` : `第 ${index + 1} 段`;
  }
}

function renderInterpolationProgress(node = selectedNode()) {
  const animation = nodeAnimation(node);
  const isInterpolation = animation?.mode === 'interpolate32';
  const complete = [
    Boolean(isInterpolation && animation.keyframeUrls?.length === 8),
    ...Array.from({ length: 7 }, (_, index) => Boolean(animation?.interpolations?.[index])),
  ];
  const firstPending = complete.findIndex((value) => !value);
  for (const [index, marker] of [...els.interpolationProgress.children].entries()) {
    marker.className = complete[index] ? 'complete' : index === firstPending ? 'current' : '';
  }
}

function updateFlipbookUi() {
  const mode = els.genMode.value;
  const isFlipbook = mode === 'flipbook';
  const isChain32 = mode === 'chain32';
  const isInterpolation = mode === 'interpolate32';
  const isAnimation = isFlipbook || isChain32 || isInterpolation;
  state.flipbook.mode = mode;
  els.flipbookControls.hidden = !isAnimation;
  els.flipbookFramesLabel.hidden = !isFlipbook;
  els.chain32Controls.hidden = !isChain32;
  els.interpolationControls.hidden = !isInterpolation;
  const frameCount = isChain32 || isInterpolation ? 8 : Number(els.flipbookFrames.value) || 4;
  const layout = isChain32 || isInterpolation ? FLIPBOOK_LAYOUTS[8] : flipbookLayout();
  els.flipbookGridHint.textContent = isChain32
    ? '4 段 × 8 帧 · 共生成 32 个独立画面'
    : isInterpolation
      ? '8 个关键帧 + 7 组相邻帧插值 · 合并为 32 帧'
      : `网格 ${layout.columns}×${layout.rows} · 裁切后按序播放`;
  els.flipbookTemplateName.textContent = state.flipbook.templateName || '未选择';
  els.generateBtn.textContent = generationFor()?.status === 'loading'
    ? els.generateBtn.textContent
    : isChain32
      ? '生成 / 继续 32 帧'
      : isInterpolation
        ? '生成 / 继续关键帧插帧'
      : isFlipbook
      ? '生成动画'
      : '生成图片';

  if (isFlipbook && frameCount >= 16) {
    els.flipbookClarityHint.hidden = false;
    els.flipbookClarityHint.textContent =
      '16 帧时每格像素偏少，文字容易糊。建议：尺寸选 1:1；字少、字大、高对比；要清晰字优先用 4 帧。';
    if (els.genSize.value !== '1024x1024') {
      els.genSize.value = '1024x1024';
      setImagePreviewAspectFromSize(els.genSize.value);
    }
  } else if (isFlipbook && frameCount >= 8) {
    els.flipbookClarityHint.hidden = false;
    els.flipbookClarityHint.textContent =
      '含文字时尽量字大、笔画粗、对比高；更稳的做法是改用 4 帧。';
  } else {
    els.flipbookClarityHint.hidden = true;
    els.flipbookClarityHint.textContent = '';
  }

  if (isAnimation) {
    const composed = composeFlipbookPrompt(
      isChain32
        ? [els.genPrompt.value.trim(), els.chain32SegmentPrompts[0]?.value.trim()]
            .filter(Boolean)
            .join('\n')
        : els.genPrompt.value.trim(),
      isChain32 || isInterpolation ? 8 : null,
    );
    els.flipbookFinalPreview.textContent = composed.prompt || '（填写动作内容并选用提词模板）';
    els.genPrompt.placeholder = isChain32
      ? '32 帧主提示词：主体、场景、风格、总体动作…'
      : isInterpolation
        ? '关键帧动画：主体、场景、完整动作过程… 输入 @ 引用图片'
        : '动画内容：动作、对象、镜头… 输入 @ 引用图片';
  } else {
    els.genPrompt.placeholder = '画面、构图、光线… 输入 @ 引用图片';
  }
}

async function persistFlipbookFps() {
  const node = selectedNode();
  if (!node?.animation) return;
  const fps = normalizeFps(els.flipbookFps.value, node.animation.fps || 4);
  els.flipbookFps.value = String(fps);
  if (node.animation.fps === fps) return;
  node.animation = { ...node.animation, fps };
  try {
    const updated = await api(`/api/nodes/${node.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ animation: { fps } }),
    });
    const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) state.timeline.nodes[idx] = { ...state.timeline.nodes[idx], ...updated };
    if (state.flipbook.previewPlaying) playFlipbookPreview();
  } catch (err) {
    setGenStatus(`FPS 保存失败：${err.message}`, 'error');
  }
}

function setFlipbookTemplate(item) {
  state.flipbook.templateId = item?.id || null;
  state.flipbook.templateName = item?.name || '';
  state.flipbook.templateContent = item?.content || '';
  state.flipbook.pickingTemplate = false;
  updateFlipbookUi();
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

/** Derive each node's start timeLabel from cumulative durationMs. */
function syncLocalTiming() {
  let cursor = 0;
  for (const node of state.timeline.nodes) {
    node.durationMs = nodeDuration(node);
    node.timeLabel = formatTime(cursor);
    cursor += node.durationMs;
  }
}

function nodeStartMs(index) {
  return state.timeline.nodes
    .slice(0, Math.max(0, index))
    .reduce((sum, node) => sum + nodeDuration(node), 0);
}

function previewNodes() {
  return state.timeline.nodes.filter((node) => node.includeInPreview !== false);
}

function previewTotalDuration() {
  return previewNodes().reduce((sum, node) => sum + nodeDuration(node), 0);
}

function previewNodeAt(elapsed) {
  const nodes = previewNodes();
  let cursor = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const duration = nodeDuration(nodes[index]);
    if (elapsed < cursor + duration || index === nodes.length - 1) {
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

function insertReferenceMention(index) {
  const input = els.genPrompt;
  const token = `@${index + 1}`;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const mentionMatch = before.match(/@(\d*)$/);
  const replaceStart = mentionMatch ? start - mentionMatch[0].length : start;
  const needsLeadingSpace = replaceStart > 0 && !/\s/.test(input.value[replaceStart - 1]);
  const insertion = `${needsLeadingSpace ? ' ' : ''}${token} `;
  input.value = `${input.value.slice(0, replaceStart)}${insertion}${input.value.slice(end)}`;
  const caret = replaceStart + insertion.length;
  input.focus();
  input.setSelectionRange(caret, caret);
  els.referenceMentionMenu.hidden = true;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderPromptReferenceTags() {
  const refs = getGenRefs();
  const indexes = [];
  const seen = new Set();
  for (const match of els.genPrompt.value.matchAll(/@(\d+)\b/g)) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < refs.length && !seen.has(index)) {
      indexes.push(index);
      seen.add(index);
    }
  }

  els.promptReferenceTags.innerHTML = '';
  els.promptReferenceTags.hidden = indexes.length === 0;
  for (const index of indexes) {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'prompt-reference-tag';
    tag.title = `参考图 @${index + 1}`;
    tag.innerHTML = `<img src="${refs[index]}" alt="" /><span>@${index + 1}</span>`;
    tag.addEventListener('click', () => insertReferenceMention(index));
    els.promptReferenceTags.appendChild(tag);
  }
}

function renderReferenceMentionMenu() {
  const input = els.genPrompt;
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const match = before.match(/@(\d*)$/);
  const refs = getGenRefs();
  if (!match || refs.length === 0) {
    els.referenceMentionMenu.hidden = true;
    return;
  }

  const query = match[1];
  const matches = refs
    .map((url, index) => ({ url, index }))
    .filter(({ index }) => String(index + 1).startsWith(query));
  if (matches.length === 0) {
    els.referenceMentionMenu.hidden = true;
    return;
  }

  els.referenceMentionMenu.innerHTML = '';
  for (const { url, index } of matches) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'reference-mention-option';
    option.innerHTML = `<img src="${url}" alt="" /><strong>@${index + 1}</strong>`;
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      insertReferenceMention(index);
    });
    els.referenceMentionMenu.appendChild(option);
  }
  els.referenceMentionMenu.hidden = false;
}

function renderRefChips() {
  const refs = getGenRefs();
  els.refChips.innerHTML = '';

  if (refs.length === 0) {
    els.refChips.innerHTML = '<span class="ref-empty-hint">尚未选择参考图</span>';
    updateReferenceCount();
    renderPromptReferenceTags();
    return;
  }

  refs.forEach((url, index) => {
    const chip = document.createElement('div');
    chip.className = 'ref-chip';
    chip.title = `点击 @${index + 1} 插入 Prompt`;
    chip.innerHTML = `
      <img src="${url}" alt="" />
      <button type="button" class="ref-chip-mention" aria-label="插入参考图 @${index + 1}">@${index + 1}</button>
      <button type="button" class="ref-chip-remove" aria-label="移除参考图">×</button>
    `;
    chip.querySelector('.ref-chip-mention').addEventListener('click', () => {
      insertReferenceMention(index);
    });
    chip.querySelector('.ref-chip-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeGenRef(url);
    });
    els.refChips.appendChild(chip);
  });
  updateReferenceCount();
  renderPromptReferenceTags();
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
  els.saveFlipbookFrameBtn.disabled = !nodeAnimation(node);
}

function updateNodeActions() {
  const hasNode = Boolean(selectedNode());
  const hasPreviewNode = previewNodes().length > 0;
  els.saveNodeTopBtn.disabled = !hasNode;
  els.deleteNodeTopBtn.disabled = !hasNode;
  els.imageUpload.disabled = !hasNode;
  els.fillPromptBtn.disabled = !hasNode;
  els.genPrompt.disabled = !hasNode;
  els.previewBtn.disabled = !hasPreviewNode;
  els.workbenchPreviewBtn.disabled = !hasPreviewNode;
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
  closePromptLibraryPanel();
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

async function loadPromptLibrary() {
  state.promptLibrary = await api('/api/prompts');
  renderPromptLibrary();
}

async function openPromptLibrary({ pickTemplate = false } = {}) {
  closeLibraryPanel();
  state.flipbook.pickingTemplate = Boolean(pickTemplate);
  els.promptLibrarySearch.value = '';
  els.promptLibraryPanel.hidden = false;
  els.promptLibraryBackdrop.hidden = false;
  try {
    await loadPromptLibrary();
  } catch (err) {
    els.promptLibraryList.innerHTML = `<p class="prompt-library-empty">提词库加载失败：${escapeHtml(err.message)}</p>`;
  }
}

function closePromptLibraryPanel() {
  els.promptLibraryPanel.hidden = true;
  els.promptLibraryBackdrop.hidden = true;
  state.flipbook.pickingTemplate = false;
  cancelPromptEdit();
}

function startPromptEdit(item = null, initialContent = '') {
  state.editingPromptId = item?.id || null;
  els.promptLibraryName.value = item?.name || '';
  els.promptLibraryContent.value = item?.content || initialContent;
  els.promptLibraryForm.hidden = false;
  els.promptLibraryName.focus();
}

function cancelPromptEdit() {
  state.editingPromptId = null;
  els.promptLibraryName.value = '';
  els.promptLibraryContent.value = '';
  els.promptLibraryForm.hidden = true;
}

function useLibraryPrompt(item) {
  if (state.flipbook.pickingTemplate || els.genMode.value === 'flipbook') {
    const hasPlaceholders = /\{(frameCount|columns|rows|userPrompt)\}/.test(item.content);
    if (!hasPlaceholders) {
      setGenStatus('该提词没有翻页占位符。可参考 docs/flipbook-prompt.md', 'error');
    }
    setFlipbookTemplate(item);
    closePromptLibraryPanel();
    setGenStatus(`已选用翻页模板：${item.name}`, hasPlaceholders ? 'success' : 'error');
    return;
  }
  els.genPrompt.value = item.content;
  els.genPrompt.dispatchEvent(new Event('input', { bubbles: true }));
  closePromptLibraryPanel();
  setGenStatus(`已使用提词：${item.name}`, 'success');
}

function renderPromptLibrary() {
  const items = state.promptLibrary.items || [];
  const query = els.promptLibrarySearch.value.trim().toLowerCase();
  const visibleItems = items.filter((item) =>
    `${item.name} ${item.content}`.toLowerCase().includes(query),
  );
  els.promptLibraryList.innerHTML = '';

  if (visibleItems.length === 0) {
    els.promptLibraryList.innerHTML = items.length
      ? '<p class="prompt-library-empty">没有匹配的提词</p>'
      : '<p class="prompt-library-empty">提词库是空的<br>可以新建，或保存当前 Prompt</p>';
    return;
  }

  for (const item of visibleItems) {
    const card = document.createElement('article');
    card.className = 'prompt-library-card';
    card.innerHTML = `
      <div class="prompt-library-card-header">
        <strong>${escapeHtml(item.name)}</strong>
        <div class="prompt-library-card-tools">
          <button type="button" class="prompt-card-edit" aria-label="编辑">编辑</button>
          <button type="button" class="prompt-card-delete" aria-label="删除">×</button>
        </div>
      </div>
      <p>${escapeHtml(item.content)}</p>
      <button type="button" class="btn btn-primary btn-sm prompt-card-use">${
        state.flipbook.pickingTemplate || els.genMode.value === 'flipbook'
          ? '选作翻页模板'
          : '使用此提词'
      }</button>
    `;
    card.querySelector('.prompt-card-use').addEventListener('click', () => useLibraryPrompt(item));
    card.querySelector('.prompt-card-edit').addEventListener('click', () => startPromptEdit(item));
    card.querySelector('.prompt-card-delete').addEventListener('click', async () => {
      if (!confirm(`删除提词「${item.name}」？`)) return;
      try {
        await api(`/api/prompts/${item.id}`, { method: 'DELETE' });
        await loadPromptLibrary();
      } catch (err) {
        setGenStatus(`删除提词失败：${err.message}`, 'error');
      }
    });
    els.promptLibraryList.appendChild(card);
  }
}

async function savePromptLibraryItem() {
  const name = els.promptLibraryName.value.trim();
  const content = els.promptLibraryContent.value.trim();
  if (!name || !content) {
    setGenStatus('提词名称和内容不能为空', 'error');
    return;
  }
  const path = state.editingPromptId ? `/api/prompts/${state.editingPromptId}` : '/api/prompts';
  await api(path, {
    method: state.editingPromptId ? 'PATCH' : 'POST',
    body: JSON.stringify({ name, content }),
  });
  cancelPromptEdit();
  await loadPromptLibrary();
  setGenStatus('提词已保存', 'success');
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
  const animation = nodeAnimation(node);
  const frameIndex = animation
    ? Math.max(0, Math.min(animation.frameUrls.length - 1, state.flipbook.previewIndex))
    : -1;
  const imageUrl = frameIndex >= 0 ? animation.frameUrls[frameIndex] : node.imageUrl;
  const defaultName =
    frameIndex >= 0 ? `${node.title || '分镜'} - 帧 ${frameIndex + 1}` : node.title || '';
  showLibraryNameModal(imageUrl, defaultName);
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
  const minViewport = els.timelineScroll.clientHeight || 560;
  const contentHeight = Math.max(minViewport, count * NODE_HEIGHT + TRACK_PADDING);
  els.timelineTrack.style.setProperty('--track-height', `${contentHeight}px`);
  els.timelineNodeCount.textContent = `${count} 幕`;
  updateScrollNav();
}

function updateScrollNav() {
  const el = els.timelineScroll;
  const canUp = el.scrollTop > 4;
  const canDown = el.scrollTop < el.scrollHeight - el.clientHeight - 4;
  els.scrollLeft.disabled = !canUp;
  els.scrollRight.disabled = !canDown;
}

function scrollTimeline(direction) {
  const amount = els.timelineScroll.clientHeight * 0.7 * direction;
  els.timelineScroll.scrollBy({ top: amount, behavior: 'smooth' });
}

function setImagePreviewAspect(width, height) {
  const safeWidth = Number(width) || 16;
  const safeHeight = Number(height) || 9;
  const ratio = safeWidth / safeHeight;
  const kind = ratio < 0.85 ? 'portrait' : ratio > 1.2 ? 'landscape' : 'square';
  els.imagePreviewShell.className = `image-preview-shell is-${kind}`;
  els.imagePreviewShell.style.setProperty('--image-preview-aspect', `${safeWidth} / ${safeHeight}`);
}

function setImagePreviewAspectFromSize(size) {
  const [width, height] = String(size || '16x9').split('x').map(Number);
  setImagePreviewAspect(width, height);
}

function renderImagePreview(url) {
  if (url) {
    els.imagePreview.innerHTML = `<img src="${url}?t=${Date.now()}" alt="分镜图" />`;
    const image = els.imagePreview.querySelector('img');
    image.addEventListener('load', () => {
      setImagePreviewAspect(image.naturalWidth, image.naturalHeight);
    }, { once: true });
    if (image.complete && image.naturalWidth) {
      setImagePreviewAspect(image.naturalWidth, image.naturalHeight);
    }
    image.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(url, '分镜图');
    });
  } else {
    els.imagePreview.innerHTML = '<span class="image-placeholder">暂无图片</span>';
    setImagePreviewAspectFromSize(els.genSize.value);
  }
}

function resizePromptComposer() {
  els.genPrompt.style.height = 'auto';
  els.genPrompt.style.height = `${Math.min(240, Math.max(92, els.genPrompt.scrollHeight))}px`;
}

function openLightbox(url, alt = '') {
  if (!url) return;
  const cleanUrl = String(url).split('?')[0];
  els.lightboxImage.src = cleanUrl;
  els.lightboxImage.alt = alt || '';
  els.imageLightbox.hidden = false;
  els.lightboxClose.focus();
}

function closeLightbox() {
  if (els.imageLightbox.hidden) return;
  els.imageLightbox.hidden = true;
  els.lightboxImage.removeAttribute('src');
  els.lightboxImage.alt = '';
}

function generationFor(nodeId = state.selectedId) {
  if (!nodeId) return null;
  if (!state.generations) state.generations = {};
  return state.generations[nodeId] || null;
}

function updateGenerateButton() {
  const gen = generationFor();
  const loading = gen?.status === 'loading';
  els.generateBtn.disabled = !selectedNode() || state.providers.length === 0 || loading;
  els.generateBtn.textContent = loading
    ? `生成中 ${Math.round(gen.progress)}%`
    : els.genMode.value === 'chain32'
      ? '生成 / 继续 32 帧'
      : els.genMode.value === 'interpolate32'
        ? '生成 / 继续关键帧插帧'
    : els.genMode.value === 'flipbook'
      ? '生成动画'
      : '生成图片';
}

function updateTimelineGenerationBadge(nodeId) {
  const badge = els.nodesLayer.querySelector(`[data-id="${nodeId}"] .node-generation-badge`);
  if (!badge) return;
  const gen = generationFor(nodeId);
  badge.hidden = !gen || gen.status === 'idle';
  if (!gen || gen.status === 'idle') return;
  badge.className = `node-generation-badge ${gen.status}`;
  badge.textContent =
    gen.status === 'loading' ? `${Math.round(gen.progress)}%` : gen.status === 'error' ? '!' : '✓';
  badge.title = gen.message;
}

function renderGenerationState() {
  const gen = generationFor();
  const visible = Boolean(gen && gen.status !== 'idle');
  els.genProgressOverlay.hidden = !visible;
  updateGenerateButton();
  if (!visible) return;

  els.genProgressOverlay.className = `gen-progress-overlay ${gen.status}`;
  els.genProgressMessage.textContent = gen.message;
  els.genProgressPercent.textContent = gen.status === 'error' ? '失败' : `${Math.round(gen.progress)}%`;
  els.genProgressBar.style.width = `${gen.progress}%`;
  els.retryGenerateBtn.hidden = gen.status !== 'error';
}

function clearGenerationTimer(nodeId) {
  const gen = generationFor(nodeId);
  if (!gen?.timerId) return;
  clearInterval(gen.timerId);
  gen.timerId = null;
}

function startGenerationProgress(request, controller) {
  clearGenerationTimer(request.nodeId);
  setImagePreviewAspectFromSize(request.size);
  const gen = {
    nodeId: request.nodeId,
    status: 'loading',
    progress: 4,
    message: '正在准备图片…',
    lastRequest: request,
    timerId: null,
    controller,
  };
  state.generations[request.nodeId] = gen;
  const startedAt = Date.now();
  gen.timerId = setInterval(() => {
    const current = generationFor(request.nodeId);
    if (current !== gen || gen.status !== 'loading') return;
    const elapsed = Date.now() - startedAt;
    gen.progress = Math.min(92, gen.progress + Math.max(0.6, (92 - gen.progress) * 0.035));
    gen.message = elapsed < 2500 ? '正在上传参考信息…' : '模型正在生成画面…';
    updateTimelineGenerationBadge(request.nodeId);
    if (state.selectedId === request.nodeId) renderGenerationState();
  }, 500);
  updateTimelineGenerationBadge(request.nodeId);
  renderGenerationState();
  return gen;
}

function finishGeneration(nodeId, status, message) {
  clearGenerationTimer(nodeId);
  const gen = generationFor(nodeId);
  if (!gen) return null;
  gen.status = status;
  gen.message = message;
  gen.progress = status === 'success' ? 100 : Math.max(8, gen.progress);
  updateTimelineGenerationBadge(nodeId);
  if (state.selectedId === nodeId) renderGenerationState();
  return gen;
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
    state.pointerY = null;
    clearDropIndicators();
    stopAutoScroll();
    els.timelineScroll.classList.remove('is-dragging');
    el.classList.remove('dragging');
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    state.pointerY = e.clientY;
    if (state.dragId === node.id) {
      clearDropIndicators();
      return;
    }
    const rect = el.getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
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
    state.pointerY = e.clientY;
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
    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'timeline-empty-add';
    empty.innerHTML = '<strong>+</strong><span>添加第一个节点</span>';
    empty.addEventListener('click', () => addNode(0));
    els.nodesLayer.appendChild(empty);
    updateTrackWidth();
    return;
  }

  const startZone = document.createElement('div');
  startZone.className = 'drop-zone-edge drop-start';
  bindEdgeDropZone(startZone, 'start');
  els.nodesLayer.appendChild(startZone);

  state.timeline.nodes.forEach((node, index) => {
    const startLabel = formatTime(nodeStartMs(index));
    const el = document.createElement('div');
    el.className = `timeline-node side-${node.side}${node.id === state.selectedId ? ' selected' : ''}${state.dragId === node.id ? ' dragging' : ''}${node.includeInPreview === false ? ' excluded-preview' : ''}`;
    el.dataset.id = node.id;
    el.draggable = true;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute(
      'aria-label',
      `${startLabel}，${node.title || '未命名节点'}${node.includeInPreview === false ? '，不参与动画预览' : ''}，拖拽可排序`,
    );

    el.innerHTML = `
      <button type="button" class="node-insert node-insert-before" aria-label="在此处添加节点" title="在此处添加节点">+</button>
      <div class="node-tick"></div>
      <div class="node-dot"></div>
      <span class="node-generation-badge" hidden></span>
      ${node.includeInPreview === false ? '<span class="node-preview-state" title="不参与动画预览">仅记录</span>' : ''}
      <div class="node-card">
        <div class="node-time">${escapeHtml(startLabel)}</div>
        <div class="node-title">${escapeHtml(node.title || '未命名')}</div>
        ${node.script ? `<div class="node-script-preview">${escapeHtml(truncate(node.script))}</div>` : ''}
        ${node.imageUrl ? `<img class="node-thumb" src="${node.imageUrl}" alt="" draggable="false" />` : ''}
      </div>
      ${index === state.timeline.nodes.length - 1
        ? '<button type="button" class="node-insert node-insert-after" aria-label="在末尾添加节点" title="在末尾添加节点">+</button>'
        : ''}
    `;

    for (const button of el.querySelectorAll('.node-insert')) {
      button.draggable = false;
      button.addEventListener('pointerdown', (e) => e.stopPropagation());
      button.addEventListener('click', async (e) => {
        e.stopPropagation();
        button.disabled = true;
        const insertIndex = button.classList.contains('node-insert-after')
          ? state.timeline.nodes.length
          : index;
        try {
          await addNode(insertIndex);
        } catch (err) {
          setGenStatus(`添加节点失败：${err.message}`, 'error');
          button.disabled = false;
        }
      });
    }

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNode(node.id);
    });

    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectNode(node.id);
      }
    });

    bindNodeDrag(el, node);
    els.nodesLayer.appendChild(el);
    updateTimelineGenerationBadge(node.id);
  });

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
    els.workbenchTitle.textContent = '选择一个镜头';
    els.workbenchTime.textContent = '00:00';
    els.genPrompt.value = '';
    resizePromptComposer();
    renderImagePreview('');
    renderRefChips();
    updateImageActions();
    renderGenerationState();
    stopFlipbookPreview();
    loadChain32State(null);
    renderInterpolationProgress(null);
    updateNodeActions();
    return;
  }

  els.editorPanel.hidden = false;
  els.editorEmpty.hidden = true;

  els.fieldTitle.value = node.title || '';
  els.fieldIncludePreview.checked = node.includeInPreview !== false;
  const nodeIndex = state.timeline.nodes.findIndex((n) => n.id === node.id);
  const startLabel = formatTime(nodeStartMs(nodeIndex));
  els.fieldStartTime.value = startLabel;
  els.workbenchTitle.textContent = node.title || '未命名镜头';
  els.workbenchTime.textContent = `${startLabel} · ${(nodeDuration(node) / 1000).toFixed(1)}s`;
  els.fieldDuration.value = (nodeDuration(node) / 1000).toFixed(1);
  els.fieldCamera.value = node.cameraPreset || 'static';
  els.fieldScript.value = node.script || '';
  els.fieldSubtitle.value = node.subtitle || '';

  const animation = nodeAnimation(node);
  if (animation) {
    els.genMode.value = ['chain32', 'interpolate32'].includes(animation.mode)
      ? animation.mode
      : 'flipbook';
    const frameCount = String(animation.frameCount || animation.frameUrls.length);
    if ([...els.flipbookFrames.options].some((opt) => opt.value === frameCount)) {
      els.flipbookFrames.value = frameCount;
    }
    els.flipbookFps.value = String(normalizeFps(animation.fps, 4));
    if (animation.templateId) {
      const item = (state.promptLibrary.items || []).find((entry) => entry.id === animation.templateId);
      if (item) {
        state.flipbook.templateId = item.id;
        state.flipbook.templateName = item.name;
        state.flipbook.templateContent = item.content;
      } else {
        state.flipbook.templateId = animation.templateId;
        state.flipbook.templateName = '已保存模板（提词库中已删除）';
        state.flipbook.templateContent = animation.templateContent || '';
      }
    }
    els.genPrompt.value = animation.userPrompt || '';
  } else {
    els.genMode.value = 'single';
    els.genPrompt.value = node.imagePrompt || '';
  }
  resizePromptComposer();

  loadChain32State(node);
  renderInterpolationProgress(node);
  updateFlipbookUi();
  renderImagePreview(node.imageUrl);
  renderFlipbookResult();
  if (animation) showFlipbookFrame(0);
  renderRefChips();
  updateImageActions();
  updateNodeActions();
  renderGenerationState();
  const generation = generationFor(node.id);
  if (generation?.status === 'error') {
    setGenStatus(generation.message, 'error');
  } else if (generation?.status === 'loading') {
    setGenStatus(generation.message || '图片生成中…', 'loading');
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
  updateGenerateButton();

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
    if (!state.dragId || state.pointerY == null) {
      state.autoScrollRaf = null;
      return;
    }

    const rect = els.timelineScroll.getBoundingClientRect();
    const y = state.pointerY;

    let speed = 0;
    const topDist = y - rect.top;
    const bottomDist = rect.bottom - y;

    if (topDist < SCROLL_EDGE && topDist >= 0) {
      speed = -SCROLL_MAX_SPEED * (1 - topDist / SCROLL_EDGE);
    } else if (bottomDist < SCROLL_EDGE && bottomDist >= 0) {
      speed = SCROLL_MAX_SPEED * (1 - bottomDist / SCROLL_EDGE);
    } else if (y < rect.top) {
      speed = -SCROLL_MAX_SPEED;
    } else if (y > rect.bottom) {
      speed = SCROLL_MAX_SPEED;
    }

    if (speed !== 0) {
      els.timelineScroll.scrollTop += speed;
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
  syncLocalTiming();
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
  requestAnimationFrame(() => {
    els.nodesLayer
      .querySelector(`[data-id="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
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
    includeInPreview: els.fieldIncludePreview.checked,
    durationMs: Math.min(600000, Math.max(500, Number(els.fieldDuration.value || 2) * 1000)),
    cameraPreset: els.fieldCamera.value || 'static',
    script: els.fieldScript.value,
    subtitle: els.fieldSubtitle.value,
  };
  if (els.genMode.value === 'flipbook' && node.animation) {
    payload.animation = {
      ...node.animation,
      userPrompt: els.genPrompt.value.trim(),
      fps: normalizeFps(els.flipbookFps.value, node.animation.fps || 4),
    };
  } else {
    payload.imagePrompt = els.genPrompt.value;
  }

  const updated = await api(`/api/nodes/${node.id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) {
    state.timeline.nodes[idx] = { ...state.timeline.nodes[idx], ...updated };
  }
  syncLocalTiming();
  renderNodes();
  if (state.selectedId === node.id) {
    els.fieldStartTime.value = node.timeLabel || formatTime(nodeStartMs(idx));
  }
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
  const generation = generationFor(node.id);
  generation?.controller?.abort();
  generation?.controllers?.forEach((controller) => controller.abort());
  clearGenerationTimer(node.id);
  delete state.generations[node.id];

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
  syncLocalTiming();
  renderNodes();
  renderEditor();

  try {
    state.timeline = await api('/api/nodes/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: nodes.map((node) => node.id) }),
    });
    syncLocalTiming();
    renderNodes();
    renderEditor();
  } catch (err) {
    state.timeline.nodes = previousNodes;
    syncLocalTiming();
    renderNodes();
    renderEditor();
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
  syncLocalTiming();
  renderNodes();
  renderEditor();

  try {
    state.timeline = await api('/api/nodes/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: nodes.map((node) => node.id) }),
    });
    syncLocalTiming();
    renderNodes();
    renderEditor();
  } catch (err) {
    state.timeline.nodes = previousNodes;
    syncLocalTiming();
    renderNodes();
    renderEditor();
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

async function generateInterpolation32(node, baseRequest) {
  const existing =
    node.animation?.mode === 'interpolate32' &&
    node.animation.keyframeUrls?.length === 8 &&
    (node.animation.interpolations || []).filter(Boolean).length < 7 &&
    (!baseRequest.chainId || node.animation.chainId === baseRequest.chainId)
      ? node.animation
      : null;
  const chainId =
    baseRequest.chainId || existing?.chainId || `interpolate${Date.now().toString(36)}`;
  const request = { ...baseRequest, chainId };
  const initialController = new AbortController();
  const activeGeneration = startGenerationProgress(request, initialController);
  clearGenerationTimer(node.id);
  activeGeneration.lastRequest = request;
  activeGeneration.controllers = new Set();
  let currentNode = node;
  let completedGaps = existing?.interpolations?.filter(Boolean).length || 0;

  const applyResponseNode = (data) => {
    const incomingCompleted = data.node?.animation?.interpolations?.filter(Boolean).length || 0;
    const localCompleted =
      currentNode.animation?.mode === 'interpolate32'
        ? currentNode.animation.interpolations?.filter(Boolean).length || 0
        : -1;
    if (incomingCompleted >= localCompleted) currentNode = data.node;
    const idx = state.timeline.nodes.findIndex((item) => item.id === node.id);
    if (idx >= 0 && incomingCompleted >= localCompleted) state.timeline.nodes[idx] = data.node;
  };

  const updateProgress = (message) => {
    activeGeneration.progress = Math.min(99, 25 + (completedGaps / 7) * 75);
    activeGeneration.message = message;
    updateTimelineGenerationBadge(node.id);
    renderNodes();
    renderInterpolationProgress(currentNode);
    if (state.selectedId === node.id) {
      renderFlipbookResult();
      renderGenerationState();
      setGenStatus(message, 'loading');
    }
  };

  try {
    if (!existing) {
      activeGeneration.controllers.add(initialController);
      activeGeneration.progress = 3;
      activeGeneration.message = '阶段 1 / 2：正在生成 8 个关键帧…';
      if (state.selectedId === node.id) {
        setGenStatus(activeGeneration.message, 'loading');
        renderGenerationState();
      }
      const timeoutId = setTimeout(() => initialController.abort(), GENERATE_TIMEOUT_MS);
      let data;
      try {
        data = await api('/api/generate-interpolation/keyframes', {
          method: 'POST',
          body: JSON.stringify(request),
          signal: initialController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
        activeGeneration.controllers.delete(initialController);
      }
      applyResponseNode(data);
      renderInterpolationProgress(currentNode);
      updateProgress('阶段 1 / 2 完成：8 个关键帧已就绪');
    } else {
      activeGeneration.progress = 25 + (completedGaps / 7) * 75;
      renderInterpolationProgress(currentNode);
    }

    const missingGaps = Array.from({ length: 7 }, (_, index) => index).filter(
      (index) => !currentNode.animation?.interpolations?.[index],
    );
    let queueIndex = 0;
    const worker = async () => {
      while (queueIndex < missingGaps.length) {
        const gapIndex = missingGaps[queueIndex];
        queueIndex += 1;
        const controller = new AbortController();
        activeGeneration.controllers.add(controller);
        const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
        updateProgress(
          `阶段 2 / 2：正在补帧 ${gapIndex + 1}→${gapIndex + 2}（${completedGaps} / 7 组完成）`,
        );
        let data;
        try {
          data = await api('/api/generate-interpolation/gap', {
            method: 'POST',
            body: JSON.stringify({
              ...request,
              prompt: fillFlipbookTemplate(request.templateContent, request.userPrompt, 4),
              gapIndex,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
          activeGeneration.controllers.delete(controller);
        }
        applyResponseNode(data);
        completedGaps = Math.max(completedGaps, data.completedGaps || 0);
        updateProgress(`阶段 2 / 2：相邻帧补帧已完成 ${completedGaps} / 7 组`);
      }
    };
    await Promise.all([worker(), worker()]);

    const latestTimeline = await api('/api/timeline');
    const latestNode = latestTimeline.nodes.find((item) => item.id === node.id);
    if (latestNode) {
      currentNode = latestNode;
      const idx = state.timeline.nodes.findIndex((item) => item.id === node.id);
      if (idx >= 0) state.timeline.nodes[idx] = latestNode;
    }
    const completedGeneration = finishGeneration(node.id, 'success', '8 关键帧 → 32 帧生成完成');
    renderNodes();
    renderInterpolationProgress(currentNode);
    if (state.selectedId === node.id) {
      renderImagePreview(currentNode.imageUrl);
      renderFlipbookResult();
      showFlipbookFrame(0);
      setGenStatus('两阶段生成完成：8 个关键帧已补齐为 32 帧', 'success');
    }
    setTimeout(() => {
      if (
        completedGeneration &&
        state.generations[node.id] === completedGeneration &&
        completedGeneration.status === 'success'
      ) {
        delete state.generations[node.id];
        updateTimelineGenerationBadge(node.id);
        if (state.selectedId === node.id) renderGenerationState();
      }
    }, 900);
  } catch (err) {
    activeGeneration.controllers.forEach((controller) => controller.abort());
    if (state.generations[node.id] === activeGeneration) {
      finishGeneration(node.id, 'error', err.message);
      if (state.selectedId === node.id) {
        setGenStatus(
          `${err.message}（关键帧与已完成的 ${completedGaps} / 7 组补帧已保存，可重试继续）`,
          'error',
        );
      }
    }
  } finally {
    if (state.selectedId === node.id) renderGenerationState();
  }
}

async function generateChain32(node, baseRequest) {
  const existing =
    node.animation?.mode === 'chain32' &&
    node.animation.segments?.length < 4 &&
    (!baseRequest.chainId || node.animation.chainId === baseRequest.chainId)
      ? node.animation
      : null;
  const chainId =
    baseRequest.chainId || existing?.chainId || `chain${Date.now().toString(36)}`;
  const request = { ...baseRequest, chainId };
  let startIndex = existing?.segments?.length || 0;
  const firstController = new AbortController();
  const activeGeneration = startGenerationProgress(request, firstController);
  clearGenerationTimer(node.id);
  activeGeneration.lastRequest = request;
  activeGeneration.progress = startIndex * 25;

  try {
    for (let segmentIndex = startIndex; segmentIndex < 4; segmentIndex += 1) {
      const controller = segmentIndex === startIndex ? firstController : new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
      activeGeneration.controller = controller;
      activeGeneration.progress = segmentIndex * 25 + 2;
      activeGeneration.message = `正在生成第 ${segmentIndex + 1} / 4 段…`;
      updateTimelineGenerationBadge(node.id);
      if (state.selectedId === node.id) {
        setGenStatus(activeGeneration.message, 'loading');
        renderGenerationState();
      }

      const segmentUserPrompt = [request.userPrompt, request.segmentPrompts?.[segmentIndex]]
        .filter(Boolean)
        .join('\n');
      const segmentPrompt = fillFlipbookTemplate(request.templateContent, segmentUserPrompt, 8);

      let data;
      try {
        data = await api('/api/generate-animation-chain/segment', {
          method: 'POST',
          body: JSON.stringify({
            ...request,
            prompt: segmentPrompt,
            segmentIndex,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const idx = state.timeline.nodes.findIndex((item) => item.id === node.id);
      if (idx >= 0) state.timeline.nodes[idx] = data.node;
      activeGeneration.progress = (segmentIndex + 1) * 25;
      activeGeneration.message = `第 ${segmentIndex + 1} / 4 段完成`;
      renderNodes();
      renderChain32Progress(data.node);
      if (state.selectedId === node.id) {
        renderFlipbookResult();
        showFlipbookFrame(Math.max(0, data.animation.frameUrls.length - 1));
        renderGenerationState();
      }
      startIndex = segmentIndex + 1;
    }

    const completedGeneration = finishGeneration(node.id, 'success', '32 帧接力生成完成');
    if (state.selectedId === node.id) {
      setGenStatus('32 个独立画面已生成并应用到节点', 'success');
    }
    setTimeout(() => {
      if (
        completedGeneration &&
        state.generations[node.id] === completedGeneration &&
        completedGeneration.status === 'success'
      ) {
        delete state.generations[node.id];
        updateTimelineGenerationBadge(node.id);
        if (state.selectedId === node.id) renderGenerationState();
      }
    }, 900);
  } catch (err) {
    if (state.generations[node.id] === activeGeneration) {
      finishGeneration(node.id, 'error', err.message);
      if (state.selectedId === node.id) {
        setGenStatus(`${err.message}（已完成 ${startIndex} / 4 段，可重试继续）`, 'error');
      }
    }
  } finally {
    if (state.selectedId === node.id) renderGenerationState();
  }
}

async function generateImage(previousRequest = null) {
  const node = previousRequest
    ? state.timeline.nodes.find((item) => item.id === previousRequest.nodeId)
    : selectedNode();
  if (!node) return;
  if (generationFor(node.id)?.status === 'loading') return;

  const mode = previousRequest?.mode || els.genMode.value || 'single';
  const [provider, model] = previousRequest
    ? [previousRequest.provider, previousRequest.model]
    : els.genProvider.value.split('::');

  let prompt = previousRequest?.prompt;
  let frameCount;
  let columns;
  let rows;
  let fps;
  let segmentPrompts;

  if (!previousRequest && mode === 'interpolate32') {
    const masterPrompt = els.genPrompt.value.trim();
    if (!state.flipbook.templateContent) {
      setGenStatus('请先从提词库选用翻页模板', 'error');
      return;
    }
    if (!masterPrompt) {
      setGenStatus('请填写关键帧动画的主提示词', 'error');
      return;
    }
    prompt = fillFlipbookTemplate(state.flipbook.templateContent, masterPrompt, 8);
    fps = normalizeFps(els.flipbookFps.value, 8);
  } else if (!previousRequest && mode === 'chain32') {
    const masterPrompt = els.genPrompt.value.trim();
    segmentPrompts = chain32PromptValues();
    if (!state.flipbook.templateContent) {
      setGenStatus('请先从提词库选用翻页模板', 'error');
      return;
    }
    if (!masterPrompt) {
      setGenStatus('请填写 32 帧动画的主提示词', 'error');
      return;
    }
    prompt = fillFlipbookTemplate(
      state.flipbook.templateContent,
      [masterPrompt, segmentPrompts[0]].filter(Boolean).join('\n'),
      8,
    );
    fps = normalizeFps(els.flipbookFps.value, 8);
  } else if (!previousRequest && mode === 'flipbook') {
    const composed = composeFlipbookPrompt();
    if (!state.flipbook.templateContent) {
      setGenStatus('请先从提词库选用翻页模板（见 docs/flipbook-prompt.md）', 'error');
      return;
    }
    if (composed.missing.includes('userPrompt')) {
      setGenStatus('请填写动画内容（会替换模板中的 {userPrompt}）', 'error');
      return;
    }
    if (!composed.prompt.trim()) {
      setGenStatus('最终 Prompt 为空', 'error');
      return;
    }
    prompt = composed.prompt;
    frameCount = composed.frameCount;
    columns = composed.columns;
    rows = composed.rows;
    fps = normalizeFps(els.flipbookFps.value, 4);
  } else if (previousRequest?.mode === 'interpolate32') {
    fps = previousRequest.fps;
  } else if (previousRequest?.mode === 'chain32') {
    fps = previousRequest.fps;
    segmentPrompts = previousRequest.segmentPrompts;
  } else if (previousRequest?.mode === 'flipbook') {
    frameCount = previousRequest.frameCount;
    columns = previousRequest.columns;
    rows = previousRequest.rows;
    fps = previousRequest.fps;
  } else {
    prompt = previousRequest?.prompt ?? els.genPrompt.value.trim();
  }

  if (!provider || !prompt) {
    setGenStatus('请选择模型并填写 prompt', 'error');
    return;
  }

  const userPrompt = previousRequest?.userPrompt ?? els.genPrompt.value.trim();
  const request = previousRequest || {
    mode,
    nodeId: node.id,
    provider,
    model,
    prompt,
    userPrompt,
    size: els.genSize.value,
    referenceUrls: [...getGenRefs()],
    ...(mode === 'flipbook'
      ? {
          frameCount,
          columns,
          rows,
          fps,
          templateId: state.flipbook.templateId,
        }
      : {}),
    ...(mode === 'chain32'
      ? {
          fps,
          templateId: previousRequest?.templateId ?? state.flipbook.templateId,
          templateContent: previousRequest?.templateContent ?? state.flipbook.templateContent,
          segmentPrompts: segmentPrompts || previousRequest?.segmentPrompts || ['', '', '', ''],
          chainId: previousRequest?.chainId,
        }
      : {}),
    ...(mode === 'interpolate32'
      ? {
          fps,
          templateId: previousRequest?.templateId ?? state.flipbook.templateId,
          templateContent: previousRequest?.templateContent ?? state.flipbook.templateContent,
          chainId: previousRequest?.chainId,
        }
      : {}),
  };
  if (mode === 'interpolate32') {
    return generateInterpolation32(node, request);
  }
  if (mode === 'chain32') {
    return generateChain32(node, request);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  if (state.selectedId === node.id) {
    setGenStatus(mode === 'flipbook' ? '动画生成中…' : '图片生成中…', 'loading');
  }
  const activeGeneration = startGenerationProgress(request, controller);

  try {
    const endpoint = mode === 'flipbook' ? '/api/generate-animation' : '/api/generate';
    const data = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) {
      state.timeline.nodes[idx] = data.node;
    }
    renderNodes();
    const completedGeneration = finishGeneration(
      node.id,
      'success',
      mode === 'flipbook' ? '动画生成完成' : '生成完成',
    );
    if (state.selectedId === node.id) {
      if (mode === 'flipbook') {
        renderImagePreview(data.imageUrl || data.node.imageUrl);
        renderFlipbookResult();
        showFlipbookFrame(0);
        setGenStatus(`已裁切 ${data.animation?.frameCount || 0} 帧并应用到节点`, 'success');
      } else {
        renderImagePreview(data.imageUrl);
        renderFlipbookResult();
        setGenStatus('已生成并应用到节点', 'success');
      }
    }
    setTimeout(() => {
      if (
        completedGeneration &&
        state.generations[node.id] === completedGeneration &&
        completedGeneration.status === 'success'
      ) {
        delete state.generations[node.id];
        updateTimelineGenerationBadge(node.id);
        if (state.selectedId === node.id) renderGenerationState();
      }
    }, 900);
  } catch (err) {
    const stillActive = state.generations[node.id] === activeGeneration;
    if (stillActive) {
      finishGeneration(node.id, 'error', err.message);
      if (state.selectedId === node.id) {
        setGenStatus(err.message, 'error');
      }
    }
  } finally {
    clearTimeout(timeoutId);
    if (state.selectedId === node.id) renderGenerationState();
  }
}

function previewStartForIndex(index) {
  return previewNodes()
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
  const nodes = previewNodes();
  const node = nodes[index];
  if (!node) return;

  state.preview.currentIndex = index;
  els.previewNodeCount.textContent = `${index + 1} / ${nodes.length}`;
  els.previewSceneTime.textContent = formatTime(previewStartForIndex(index));
  els.previewSceneTitle.textContent = node.title || '未命名节点';
  els.previewSceneCamera.textContent = CAMERA_LABELS[node.cameraPreset] || CAMERA_LABELS.static;
  const subtitle = nodeSubtitle(node);
  els.previewCaption.textContent = subtitle;
  els.previewCaption.hidden = !subtitle;
  els.previewNoImage.hidden = true;

  const animation = nodeAnimation(node);
  let imageUrl = node.imageUrl || '';
  if (animation) {
    const fps = normalizeFps(animation.fps, 4);
    const frameIndex = Math.floor(Math.max(0, localElapsed) * fps / 1000) % animation.frameUrls.length;
    imageUrl = animation.frameUrls[frameIndex];
  }

  els.previewImage.hidden = !imageUrl;

  const camera = animation ? 'static' : (node.cameraPreset || 'static');
  els.previewImage.className = `preview-image camera-${camera}`;
  els.previewImage.style.setProperty('--preview-duration', `${nodeDuration(node) / 1000}s`);
  els.previewImage.style.animationDelay = animation
    ? '0ms'
    : `-${Math.min(localElapsed, nodeDuration(node) - 1)}ms`;
  els.previewImage.alt = node.title || '';
  if (imageUrl) {
    const nextSrc = `${imageUrl}?preview=${index}-${imageUrl}`;
    if (els.previewImage.getAttribute('src') !== nextSrc) {
      els.previewImage.src = nextSrc;
    }
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
  const node = previewNodes()[scene.index];
  if (nodeAnimation(node) || scene.index !== state.preview.currentIndex) {
    renderPreviewScene(scene.index, scene.localElapsed);
  }
  updatePreviewProgress();
  state.preview.rafId = requestAnimationFrame(previewTick);
}

function playPreview() {
  if (!previewNodes().length) return;
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
  if (!previewNodes().length) {
    setGenStatus('请先开启至少一个节点的「加入动画预览」', 'error');
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

const PANEL_WIDTHS = {
  timeline: { min: 220, max: 420, default: 270, property: '--timeline-width' },
  editor: { min: 300, max: 500, default: 350, property: '--editor-width' },
};

function setPanelWidth(panel, value, persist = true) {
  const config = PANEL_WIDTHS[panel];
  const width = Math.round(Math.min(config.max, Math.max(config.min, Number(value) || config.default)));
  els.workspace.style.setProperty(config.property, `${width}px`);
  const resizer = panel === 'timeline' ? els.timelineResizer : els.editorResizer;
  resizer.setAttribute('aria-valuemin', String(config.min));
  resizer.setAttribute('aria-valuemax', String(config.max));
  resizer.setAttribute('aria-valuenow', String(width));
  if (persist) localStorage.setItem(`script-flow-${panel}-width`, String(width));
  requestAnimationFrame(updateTrackWidth);
  return width;
}

function bindPanelResizer(resizer, panel) {
  const config = PANEL_WIDTHS[panel];
  const direction = panel === 'timeline' ? 1 : -1;

  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const current = parseFloat(getComputedStyle(els.workspace).getPropertyValue(config.property));
    const startWidth = Number.isFinite(current) ? current : config.default;
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add('is-resizing');
    document.body.classList.add('is-resizing-panels');

    const move = (moveEvent) => {
      setPanelWidth(panel, startWidth + (moveEvent.clientX - startX) * direction, false);
    };
    const stop = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', stop);
      resizer.removeEventListener('pointercancel', stop);
      resizer.classList.remove('is-resizing');
      document.body.classList.remove('is-resizing-panels');
      const width = parseFloat(getComputedStyle(els.workspace).getPropertyValue(config.property));
      setPanelWidth(panel, width, true);
    };

    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', stop);
    resizer.addEventListener('pointercancel', stop);
  });

  resizer.addEventListener('dblclick', () => setPanelWidth(panel, config.default));
  resizer.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = parseFloat(getComputedStyle(els.workspace).getPropertyValue(config.property));
    const keyboardDelta = event.key === 'ArrowRight' ? 12 : -12;
    setPanelWidth(panel, current + keyboardDelta * direction);
  });
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
  els.workbenchPreviewBtn.addEventListener('click', () => els.previewBtn.click());
  bindPanelResizer(els.timelineResizer, 'timeline');
  bindPanelResizer(els.editorResizer, 'editor');

  els.scrollLeft.addEventListener('click', () => scrollTimeline(-1));
  els.scrollRight.addEventListener('click', () => scrollTimeline(1));
  els.timelineScroll.addEventListener('scroll', updateScrollNav);

  els.timelineScroll.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    els.timelineScroll.scrollTop += e.deltaX;
  }, { passive: false });

  els.timelineScroll.addEventListener('dragover', (e) => {
    e.preventDefault();
    state.pointerY = e.clientY;
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
    els.fieldScript,
    els.fieldSubtitle,
    els.genPrompt,
  ].forEach((field) => field.addEventListener('input', scheduleAutoSave));
  els.fieldTitle.addEventListener('input', () => {
    els.workbenchTitle.textContent = els.fieldTitle.value.trim() || '未命名镜头';
  });
  els.fieldDuration.addEventListener('input', () => {
    const current = selectedNode();
    if (current) {
      current.durationMs = Math.min(
        600000,
        Math.max(500, Number(els.fieldDuration.value || 2) * 1000),
      );
      syncLocalTiming();
      renderNodes();
      const idx = state.timeline.nodes.findIndex((n) => n.id === current.id);
      const startLabel = formatTime(nodeStartMs(idx));
      els.fieldStartTime.value = startLabel;
      els.workbenchTime.textContent =
        `${startLabel} · ${(nodeDuration(current) / 1000).toFixed(1)}s`;
    }
    scheduleAutoSave();
  });
  els.fieldIncludePreview.addEventListener('change', () => {
    const current = selectedNode();
    if (current) {
      current.includeInPreview = els.fieldIncludePreview.checked;
      renderNodes();
      updateNodeActions();
    }
    scheduleAutoSave();
  });
  els.fieldCamera.addEventListener('change', scheduleAutoSave);
  els.deleteCancel.addEventListener('click', hideDeleteModal);
  els.deleteConfirm.addEventListener('click', confirmDeleteNode);
  els.deleteModal.addEventListener('click', (e) => {
    if (e.target === els.deleteModal) hideDeleteModal();
  });
  els.lightboxClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });
  els.imageLightbox.addEventListener('click', (e) => {
    if (e.target === els.imageLightbox) closeLightbox();
  });
  els.lightboxImage.addEventListener('click', (e) => e.stopPropagation());
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
      els.genPrompt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  els.genMode.addEventListener('change', () => {
    updateFlipbookUi();
    renderInterpolationProgress();
    updateGenerateButton();
    if (els.genMode.value === 'single') stopFlipbookPreview();
  });
  els.flipbookFrames.addEventListener('change', updateFlipbookUi);
  els.chain32SegmentPrompts.forEach((input) => {
    input.addEventListener('input', updateFlipbookUi);
  });
  els.flipbookFps.addEventListener('change', () => {
    persistFlipbookFps();
    updateFlipbookUi();
  });
  els.flipbookPickTemplateBtn.addEventListener('click', () => {
    openPromptLibrary({ pickTemplate: true });
  });
  els.flipbookPlayBtn.addEventListener('click', () => {
    if (state.flipbook.previewPlaying) stopFlipbookPreview();
    else playFlipbookPreview();
  });

  els.genPrompt.addEventListener('input', () => {
    resizePromptComposer();
    renderPromptReferenceTags();
    renderReferenceMentionMenu();
    if (['flipbook', 'chain32', 'interpolate32'].includes(els.genMode.value)) {
      updateFlipbookUi();
    }
  });
  els.genPrompt.addEventListener('click', renderReferenceMentionMenu);
  els.genPrompt.addEventListener('keyup', renderReferenceMentionMenu);
  els.genPrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!els.generateBtn.disabled) generateImage();
    }
  });
  els.genPrompt.addEventListener('blur', () => {
    setTimeout(() => {
      els.referenceMentionMenu.hidden = true;
    }, 120);
  });
  els.genSize.addEventListener('change', () => {
    if (!selectedNode()?.imageUrl) setImagePreviewAspectFromSize(els.genSize.value);
  });

  els.generateBtn.addEventListener('click', () => generateImage());
  els.retryGenerateBtn.addEventListener('click', () => {
    const generation = generationFor();
    if (generation?.lastRequest) generateImage(generation.lastRequest);
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
      previewStartForIndex(Math.min(previewNodes().length - 1, state.preview.currentIndex + 1)),
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

  els.promptLibraryBtn.addEventListener('click', () => openPromptLibrary());
  els.closePromptLibrary.addEventListener('click', closePromptLibraryPanel);
  els.promptLibraryBackdrop.addEventListener('click', closePromptLibraryPanel);
  els.promptLibrarySearch.addEventListener('input', renderPromptLibrary);
  els.newPromptBtn.addEventListener('click', () => startPromptEdit());
  els.saveCurrentPromptBtn.addEventListener('click', () => {
    const content = els.genPrompt.value.trim();
    if (!content) {
      setGenStatus('当前 Prompt 为空，无法保存', 'error');
      return;
    }
    startPromptEdit(null, content);
  });
  els.cancelPromptEditBtn.addEventListener('click', cancelPromptEdit);
  els.promptLibraryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await savePromptLibraryItem();
    } catch (err) {
      setGenStatus(`提词保存失败：${err.message}`, 'error');
    }
  });

  els.addToLibraryBtn.addEventListener('click', requestAddCurrentToLibrary);
  els.saveFlipbookFrameBtn.addEventListener('click', requestAddCurrentToLibrary);
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
    if (!els.imageLightbox.hidden && e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
      return;
    }
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
          previewStartForIndex(Math.min(previewNodes().length - 1, state.preview.currentIndex + 1)),
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
    const isEditing = e.target.matches('input, textarea, select, [contenteditable="true"]');
    if (!isEditing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const currentIndex = state.timeline.nodes.findIndex((node) => node.id === state.selectedId);
      const direction = e.key === 'ArrowUp' ? -1 : 1;
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : state.timeline.nodes.length - 1
          : Math.max(0, Math.min(state.timeline.nodes.length - 1, currentIndex + direction));
      const nextNode = state.timeline.nodes[nextIndex];
      if (nextNode) {
        e.preventDefault();
        selectNode(nextNode.id);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (!els.deleteModal.hidden) hideDeleteModal();
      else if (!els.libraryNameModal.hidden) hideLibraryNameModal();
      else if (!els.promptLibraryPanel.hidden) closePromptLibraryPanel();
      else if (!els.libraryPanel.hidden) closeLibraryPanel();
    }
  });

  window.addEventListener('resize', updateTrackWidth);
}

async function init() {
  const savedTheme = localStorage.getItem('script-flow-theme');
  const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(savedTheme || preferredTheme);
  setPanelWidth('timeline', localStorage.getItem('script-flow-timeline-width'), false);
  setPanelWidth('editor', localStorage.getItem('script-flow-editor-width'), false);
  bindEvents();
  updateFlipbookUi();
  await Promise.all([loadTimeline(), loadProviders(), loadLibrary(), loadPromptLibrary()]);
}

init();
