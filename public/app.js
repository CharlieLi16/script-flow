import { apiClient, fetchWithLocal, validateGenerationAccess } from './api-client.js';
import {
  applyFlipbookGeneration,
  applyKeyframeGeneration,
  applySegmentGeneration,
  applySingleGeneration,
  composeAnchoredKeyframePrompt,
  confirmKeyframesLocally,
  prepareGenerateRequest,
} from './generation-helper.js';
import { initProjects, renderProjectMenu, setProjectChangeHandler, hydrateActiveProjectSeedAssets } from './projects-ui.js';
import { mountSettingsPanel, initSettings } from './settings-panel.js';
import { autoSyncIfConnected } from './folder-sync.js';
import { clearDisplayUrlCache, resolveImagesIn, setImgSrc, imgAsset } from './url-display.js';
import { requestPersistentStorage } from './storage/idb.js';
import { resumeOpenJobs } from './storage/jobs.js';

let autoSyncTimer = null;
function scheduleAutoSync() {
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    autoSyncIfConnected();
  }, 1200);
}

const NODE_HEIGHT = 112;
const TRACK_PADDING = 48;
const UNDO_MS = 5000;
const SCROLL_EDGE = 72;
const SCROLL_MAX_SPEED = 22;
const GENERATE_TIMEOUT_MS = 180000;

const state = {
  timeline: { title: '', nodes: [], captions: [] },
  selectedId: null,
  selectedIds: new Set(),
  providers: [],
  dragId: null,
  dragIds: [],
  dropTarget: null,
  lastDragAt: 0,
  pointerY: null,
  autoScrollRaf: null,
  pendingDelete: null,
  library: { items: [] },
  generatedAssets: { items: [] },
  genRefs: {},
  pendingLibraryImageUrl: null,
  pendingLibraryTarget: 'library',
  pendingLibraryMetadata: null,
  expandedGeneratedAssets: new Set(),
  assetPreview: {
    assetId: null,
    playing: false,
    index: 0,
    rafId: null,
    startedAt: 0,
  },
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
    keyframeStatus: {},
    segmentStatus: {},
  },
  preview: {
    open: false,
    playing: false,
    elapsed: 0,
    currentIndex: 0,
    startedAt: 0,
    rafId: null,
  },
  captionTrack: {
    selectedId: null,
    saveTimer: null,
    drag: null,
    elapsed: 0,
    playing: false,
    startedAt: 0,
    rafId: null,
    zoom: Math.min(20, Math.max(1, Number(localStorage.getItem('script-flow-caption-zoom')) || 1)),
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
  openCaptionTrackEditor: $('#open-caption-track-editor'),
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
  chain32Keyframes: $('#chain32-keyframes'),
  chain32ConfirmBtn: $('#chain32-confirm-btn'),
  chain32PhaseLabel: $('#chain32-phase-label'),
  chain32SegmentPrompts: [...document.querySelectorAll('.chain32-segment-prompt')],
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
  generatedAssetsBtn: $('#generated-assets-btn'),
  generatedAssetsPanel: $('#generated-assets-panel'),
  generatedAssetsBackdrop: $('#generated-assets-backdrop'),
  closeGeneratedAssets: $('#close-generated-assets'),
  generatedAssetsSearch: $('#generated-assets-search'),
  generatedAssetsFilter: $('#generated-assets-filter'),
  generatedAssetsGrid: $('#generated-assets-grid'),
  captionTrackBtn: $('#caption-track-btn'),
  captionTrackPanel: $('#caption-track-panel'),
  captionTrackBackdrop: $('#caption-track-backdrop'),
  closeCaptionTrack: $('#close-caption-track'),
  addCaptionBtn: $('#add-caption-btn'),
  captionTrackSummary: $('#caption-track-summary'),
  captionTrackScroll: $('#caption-track-scroll'),
  captionTrackCanvas: $('#caption-track-canvas'),
  captionRuler: $('#caption-ruler'),
  captionShotLane: $('#caption-shot-lane'),
  captionLane: $('#caption-lane'),
  captionPlayhead: $('#caption-playhead'),
  captionPreviewStage: $('#caption-preview-stage'),
  captionPreviewImage: $('#caption-preview-image'),
  captionPreviewEmpty: $('#caption-preview-empty'),
  captionPreviewText: $('#caption-preview-text'),
  captionPreviewNode: $('#caption-preview-node'),
  captionPlayBtn: $('#caption-play-btn'),
  captionJumpSelectedBtn: $('#caption-jump-selected-btn'),
  captionCurrentTime: $('#caption-current-time'),
  captionTotalTime: $('#caption-total-time'),
  captionZoom: $('#caption-zoom'),
  captionZoomFit: $('#caption-zoom-fit'),
  captionZoomOut: $('#caption-zoom-out'),
  captionZoomIn: $('#caption-zoom-in'),
  captionZoomLabel: $('#caption-zoom-label'),
  captionEditor: $('#caption-editor'),
  captionText: $('#caption-text'),
  captionStart: $('#caption-start'),
  captionEnd: $('#caption-end'),
  deleteCaptionBtn: $('#delete-caption-btn'),
  captionTrackEmpty: $('#caption-track-empty'),
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
  libraryNameTitle: $('#library-name-title'),
  libraryNameInput: $('#library-name-input'),
  libraryNameCancel: $('#library-name-cancel'),
  libraryNameConfirm: $('#library-name-confirm'),
  appDialog: $('#app-dialog'),
  appDialogTitle: $('#app-dialog-title'),
  appDialogMessage: $('#app-dialog-message'),
  appDialogField: $('#app-dialog-field'),
  appDialogFieldLabel: $('#app-dialog-field-label'),
  appDialogInput: $('#app-dialog-input'),
  appDialogCancel: $('#app-dialog-cancel'),
  appDialogConfirm: $('#app-dialog-confirm'),
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
  8: {
    columns: 3,
    rows: 3,
    sheetFrameCount: 9,
    outputFrameCount: 8,
    dropLeadingFrame: true,
  },
  9: { columns: 3, rows: 3 },
  16: { columns: 4, rows: 4 },
};

const PROMPT_ROLE_LABELS = {
  general: '单图提词',
  flipbook: '翻页图集',
  'anchored-keyframe': '锚点关键帧',
  'anchored-segment': '锚点分段',
};

const DEFAULT_PROMPT_MODE_MAP = {
  single: { requiredRoles: [], selectableRoles: ['general'] },
  flipbook: { requiredRoles: ['flipbook'], selectableRoles: ['flipbook'] },
  chain32: {
    requiredRoles: ['flipbook', 'anchored-keyframe', 'anchored-segment'],
    selectableRoles: ['flipbook'],
  },
};

const SYSTEM_PROMPT_IDS = new Set([
  'pflipbook-default',
  'panchored-keyframe',
  'panchored-segment',
]);

async function api(path, options = {}) {
  return apiClient(path, options);
}

let appDialogSession = null;

function closeAppDialog(value = null) {
  if (!appDialogSession) return;
  const session = appDialogSession;
  appDialogSession = null;
  els.appDialog.hidden = true;
  els.appDialogInput.value = '';
  session.resolve(value);
  session.returnFocus?.focus?.();
}

function openAppDialog({
  title,
  message = '',
  confirmLabel = '确认',
  tone = 'primary',
  input = null,
}) {
  if (appDialogSession) closeAppDialog(null);
  els.appDialogTitle.textContent = title;
  els.appDialogMessage.textContent = message;
  els.appDialogMessage.hidden = !message;
  els.appDialogField.hidden = !input;
  els.appDialogFieldLabel.textContent = input?.label || '名称';
  els.appDialogInput.placeholder = input?.placeholder || '';
  els.appDialogInput.value = input?.value || '';
  els.appDialogConfirm.textContent = confirmLabel;
  els.appDialogConfirm.className = `btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`;
  els.appDialog.hidden = false;

  const returnFocus = document.activeElement;
  const promise = new Promise((resolve) => {
    appDialogSession = { resolve, input: Boolean(input), returnFocus };
  });
  requestAnimationFrame(() => {
    if (input) {
      els.appDialogInput.focus();
      els.appDialogInput.select();
    } else {
      els.appDialogConfirm.focus();
    }
  });
  return promise;
}

function confirmAppDialog() {
  if (!appDialogSession) return;
  closeAppDialog(appDialogSession.input ? els.appDialogInput.value : true);
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
  if (!animation || typeof animation !== 'object') return null;
  if (Array.isArray(animation.frameUrls) && animation.frameUrls.length > 0) return animation;
  if (animation.mode === 'anchored-chain32' || animation.mode === 'chain32') return animation;
  if (Array.isArray(animation.keyframeUrls) && animation.keyframeUrls.some(Boolean)) return animation;
  return null;
}

function flipbookLayout(frameCount = Number(els.flipbookFrames.value)) {
  return FLIPBOOK_LAYOUTS[frameCount] || FLIPBOOK_LAYOUTS[4];
}

function normalizeFps(value, fallback = 4) {
  const fps = Number(value);
  if (!Number.isFinite(fps)) return fallback;
  return Math.min(32, Math.max(1, Math.round(fps)));
}

function fillPromptTemplate(template, vars = {}) {
  let result = String(template || '');
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value == null ? '' : String(value));
  }
  return result
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fillFlipbookTemplate(template, userPrompt, frameCount, options = {}) {
  const layout = flipbookLayout(frameCount);
  const sheetFrameCount = options.sheetFrameCount || layout.sheetFrameCount || frameCount;
  const totalOutputFrameCount = options.outputFrameCount || layout.outputFrameCount || frameCount;
  const isBatched = Number(layout.batchCount) > 1 && !options.dropLeadingFrame;
  const outputFrameCount = isBatched ? layout.batchFrameCount : totalOutputFrameCount;
  const dropLeadingFrame = options.dropLeadingFrame ?? layout.dropLeadingFrame ?? false;
  const size = options.size || els.genSize.value;
  const frameAspectRatio =
    size === '1024x1024'
      ? '1:1（正方形）'
      : size === '1024x1792'
        ? '9:16（竖向矩形）'
        : '16:9（横向矩形）';
  const gridConstraint = `本次必须恰好 ${layout.columns} 列、${layout.rows} 行，不得增减任何一列或一行。`;
  const frameSelectionRule = dropLeadingFrame
    ? `第 1 格只作为动作起始锚点，程序裁切后会丢弃第 1 格；第 2 到第 ${sheetFrameCount} 格才是最终保留的 ${outputFrameCount} 帧。`
    : isBatched
      ? `本批 4 格全部保留；后端会生成 ${layout.batchCount} 批并合并为 ${totalOutputFrameCount} 帧。`
      : `程序会保留全部 ${outputFrameCount} 个画面作为最终动画帧。`;
  let prompt = fillPromptTemplate(template, {
    frameCount: sheetFrameCount,
    sheetFrameCount,
    outputFrameCount,
    totalOutputFrameCount,
    columns: layout.columns,
    rows: layout.rows,
    columnsMinusOne: Math.max(0, layout.columns - 1),
    rowsMinusOne: Math.max(0, layout.rows - 1),
    frameCountMinusOne: Math.max(1, Number(sheetFrameCount) - 1),
    frameAspectRatio,
    gridConstraint,
    frameSelectionRule,
    batchCount: layout.batchCount || 1,
    batchNumber: 1,
    batchStartFrame: 1,
    batchEndFrame: sheetFrameCount,
    batchStartPercent: '0%',
    batchEndPercent: `${Math.round(100 / (layout.batchCount || 1))}%`,
    continuityRule: '后续批次由后端自动引用上一批最后一帧。',
    phaseRule:
      layout.batchCount > 1
        ? `本批只推进总动作的前 ${Math.round(100 / layout.batchCount)}%，不要提前完成动作。`
        : '本批完成整个动作。',
    userPrompt,
    segmentPrompt: userPrompt,
    progress: '50%',
    phaseHint: '保持动作连续，不要越界',
    startAlias: '@1',
    endAlias: '@2',
  });
  if (dropLeadingFrame && !template.includes('{frameSelectionRule}')) {
    prompt = `${prompt}\n\n帧保留规则：${frameSelectionRule}`;
  }
  if (isBatched) {
    prompt = `${prompt}\n\n生成方式：后端将按 ${layout.batchCount} 批依次生成；每批固定 2×2 / 4 格，上一批最后一帧会作为下一批连续性参考。当前预览显示第 1 批约束。`;
  }
  return prompt;
}

function promptByRoleOrId(role, id) {
  const items = state.promptLibrary.items || [];
  return items.find((item) => item.id === id) || items.find((item) => item.role === role) || null;
}

function promptRole(item) {
  if (item?.role) return item.role;
  if (item?.id === 'pflipbook-default') return 'flipbook';
  return /\{(?:frameCount|sheetFrameCount|columns|rows|frameSelectionRule)\}/.test(
    item?.content || '',
  )
    ? 'flipbook'
    : 'general';
}

function promptByRole(role, preferredId = null) {
  const items = state.promptLibrary.items || [];
  const preferred = preferredId ? items.find((item) => item.id === preferredId) : null;
  if (preferred && promptRole(preferred) === role) return preferred;
  return items.find((item) => promptRole(item) === role) || null;
}

function promptBindingsForMode(mode = els.genMode.value) {
  const atlas = promptByRole('flipbook', state.flipbook.templateId);
  if (mode === 'single') return { general: true };
  if (mode === 'flipbook') return { atlas };
  return {
    atlas,
    keyframe: promptByRole('anchored-keyframe', 'panchored-keyframe'),
    segment: promptByRole('anchored-segment', 'panchored-segment'),
  };
}

function promptModeConfig(mode = els.genMode.value) {
  return state.promptLibrary.modeMap?.[mode] || DEFAULT_PROMPT_MODE_MAP[mode];
}

function syncPromptBindingsForMode(mode = els.genMode.value) {
  if (mode === 'single') return promptBindingsForMode(mode);
  const bindings = promptBindingsForMode(mode);
  if (bindings.atlas && bindings.atlas.id !== state.flipbook.templateId) {
    state.flipbook.templateId = bindings.atlas.id;
    state.flipbook.templateName = bindings.atlas.name;
    state.flipbook.templateContent = bindings.atlas.content;
  }
  return bindings;
}

function promptUsableInMode(item, mode = els.genMode.value) {
  return promptModeConfig(mode)?.selectableRoles?.includes(promptRole(item)) || false;
}

function composeAnchoredPreviewPrompt() {
  const userPrompt = els.genPrompt.value.trim() || '（总体动作）';
  const segmentPrompt = els.chain32SegmentPrompts[0]?.value.trim() || '（本段动作）';
  const keyframeItem = promptByRoleOrId('anchored-keyframe', 'panchored-keyframe');
  const segmentItem = promptByRoleOrId('anchored-segment', 'panchored-segment');
  const keyframePreview = keyframeItem
    ? fillPromptTemplate(keyframeItem.content, {
        progress: '25%',
        userPrompt,
        phaseHint: segmentPrompt,
      })
    : '（提词库缺少「32帧锚点·中间关键帧」）';
  const segmentPreview = segmentItem
    ? fillPromptTemplate(segmentItem.content, {
        userPrompt,
        segmentPrompt,
        startAlias: '@1',
        endAlias: '@2',
        endAnchorRule: '@2 是本段精确终点参考，仅第 2 批最后一格可以到达它。',
        frameCount: '4',
        columns: '2',
        rows: '2',
        frameCountMinusOne: '3',
      })
    : '（提词库缺少「32帧锚点·分段约束」）';
  const atlas = state.flipbook.templateContent
    ? fillFlipbookTemplate(
        state.flipbook.templateContent,
        [userPrompt, segmentPrompt].filter(Boolean).join('\n'),
        4,
      )
    : '';
  return [
    '【中间关键帧模板预览 · K1】',
    keyframePreview,
    '',
    '【分段约束模板预览 · K0→K1】',
    segmentPreview,
    atlas ? `\n【选用的翻页图集壳层】\n${atlas}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function composeFlipbookPrompt(
  userPrompt = els.genPrompt.value.trim(),
  frameCountOverride = null,
) {
  const frameCount = frameCountOverride || Number(els.flipbookFrames.value) || 4;
  const layout = flipbookLayout(frameCount);
  const sheetFrameCount = layout.sheetFrameCount || frameCount;
  const outputFrameCount = layout.outputFrameCount || frameCount;
  const template = state.flipbook.templateContent || '';
  if (!template) {
    return {
      prompt: userPrompt,
      missing: userPrompt ? [] : ['userPrompt'],
      frameCount: sheetFrameCount,
      outputFrameCount,
      batchCount: layout.batchCount || 1,
      ...layout,
    };
  }
  const missing = [];
  if (template.includes('{userPrompt}') && !userPrompt) missing.push('userPrompt');
  const prompt = fillFlipbookTemplate(template, userPrompt, frameCount);
  return {
    prompt,
    missing,
    frameCount: sheetFrameCount,
    outputFrameCount,
    batchCount: layout.batchCount || 1,
    ...layout,
  };
}

function stopFlipbookPreview() {
  if (state.flipbook.previewTimer) {
    cancelAnimationFrame(state.flipbook.previewTimer);
    state.flipbook.previewTimer = null;
  }
  state.flipbook.previewPlaying = false;
  if (els.flipbookPlayBtn) {
    els.flipbookPlayBtn.textContent = '▶ 播放';
  }
  if (els.workbenchPreviewBtn) {
    els.workbenchPreviewBtn.textContent = '▶ 动画预览';
  }
}

function showFlipbookFrame(index) {
  const animation = nodeAnimation();
  if (!animation?.frameUrls?.length) return;
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
  if (!animation?.frameUrls?.length) return;
  stopFlipbookPreview();
  state.flipbook.previewPlaying = true;
  els.flipbookPlayBtn.textContent = 'Ⅱ 暂停';
  els.workbenchPreviewBtn.textContent = 'Ⅱ 暂停动画';
  const fps = normalizeFps(els.flipbookFps.value || animation.fps, animation.fps || 4);
  const frameDuration = 1000 / fps;
  const startedAt = performance.now() - state.flipbook.previewIndex * frameDuration;
  const tick = (now) => {
    if (!state.flipbook.previewPlaying) return;
    const frameIndex =
      Math.floor(Math.max(0, now - startedAt) / frameDuration) % animation.frameUrls.length;
    if (frameIndex !== state.flipbook.previewIndex) showFlipbookFrame(frameIndex);
    state.flipbook.previewTimer = requestAnimationFrame(tick);
  };
  state.flipbook.previewTimer = requestAnimationFrame(tick);
}

function renderFlipbookResult() {
  const animation = nodeAnimation();
  stopFlipbookPreview();
  els.flipbookResult.classList.toggle(
    'chain32',
    animation?.mode === 'chain32' || animation?.mode === 'anchored-chain32',
  );
  if (!animation || !animation.frameUrls?.length) {
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
    button.innerHTML = `${imgAsset(url, '', `帧 ${index + 1}`)}<span>${index + 1}</span>`;
    button.addEventListener('click', () => {
      stopFlipbookPreview();
      showFlipbookFrame(index);
    });
    els.flipbookFramesStrip.appendChild(button);
  });
  resolveImagesIn(els.flipbookFramesStrip);
}

function chain32PromptValues() {
  return els.chain32SegmentPrompts.map((input) => input.value.trim());
}

function isAnchoredAnimation(animation = nodeAnimation()) {
  return animation?.mode === 'anchored-chain32';
}

function isLegacyChain32(animation = nodeAnimation()) {
  return animation?.mode === 'chain32';
}

function isAnyChain32(animation = nodeAnimation()) {
  return isAnchoredAnimation(animation) || isLegacyChain32(animation);
}

function anchoredSegmentSlots(animation = nodeAnimation()) {
  const slots = [null, null, null, null];
  if (!Array.isArray(animation?.segments)) return slots;
  for (const segment of animation.segments) {
    if (!segment || typeof segment !== 'object') continue;
    const index = Number(segment.index);
    if (Number.isInteger(index) && index >= 0 && index <= 3) slots[index] = segment;
  }
  if (!slots.some(Boolean) && animation.segments.length && animation.mode === 'chain32') {
    for (let i = 0; i < Math.min(4, animation.segments.length); i += 1) {
      slots[i] = animation.segments[i];
    }
  }
  return slots;
}

function anchoredPhase(animation = nodeAnimation()) {
  if (isLegacyChain32(animation)) {
    const count = animation.segments?.length || 0;
    if (count >= 4) return 'complete';
    return count > 0 ? 'segments' : 'legacy';
  }
  if (!isAnchoredAnimation(animation)) return 'idle';
  if (animation.phase) return animation.phase;
  const slots = anchoredSegmentSlots(animation);
  if (slots.every(Boolean) && (animation.frameUrls?.length || 0) >= 32) return 'complete';
  if (animation.keyframesConfirmed) return 'segments';
  if (animation.keyframeUrls?.[1] && animation.keyframeUrls?.[2] && animation.keyframeUrls?.[3]) {
    return 'awaiting-confirm';
  }
  return 'keyframes';
}

function loadChain32State(node = selectedNode()) {
  const animation = nodeAnimation(node);
  const prompts = isAnyChain32(animation) ? animation.segmentPrompts || [] : [];
  els.chain32SegmentPrompts.forEach((input, index) => {
    input.value = prompts[index] || '';
  });
  renderChain32Keyframes(node);
  renderChain32Progress(node);
}

function renderChain32Keyframes(node = selectedNode()) {
  if (!els.chain32Keyframes) return;
  const refs = getGenRefs();
  const animation = nodeAnimation(node);
  const keyframeUrls = isAnchoredAnimation(animation)
    ? animation.keyframeUrls || [refs[0] || null, null, null, null, refs[1] || null]
    : [refs[0] || null, null, null, null, refs[1] || null];
  const labels = ['K0', 'K1', 'K2', 'K3', 'K4'];
  const roles = ['首帧 @1', '25%', '50%', '75%', '尾帧 @2'];
  const phase = anchoredPhase(animation);
  const loading = generationFor(node?.id)?.status === 'loading';

  els.chain32Keyframes.innerHTML = '';
  labels.forEach((label, index) => {
    const url = keyframeUrls[index] || (index === 0 ? refs[0] : index === 4 ? refs[1] : null);
    const status =
      state.flipbook.keyframeStatus[index] ||
      (url ? 'ready' : 'empty');
    const card = document.createElement('div');
    card.className = `chain32-keyframe ${status}${url ? ' ready' : ''}`;
    const canRegen = index >= 1 && index <= 3 && Boolean(refs[0] && refs[1]);
    card.innerHTML = `
      <div class="chain32-keyframe-frame">
        ${url ? imgAsset(url, '', label) : `<span>${roles[index]}</span>`}
      </div>
      <div class="chain32-keyframe-meta">
        <strong>${label}</strong>
        ${
          canRegen
            ? `<button type="button" class="chain32-keyframe-regen" data-keyframe-index="${index}" ${
                loading ? 'disabled' : ''
              }>重生成</button>`
            : ''
        }
      </div>
    `;
    const regen = card.querySelector('.chain32-keyframe-regen');
    regen?.addEventListener('click', (event) => {
      event.preventDefault();
      regenerateAnchoredKeyframe(index);
    });
    els.chain32Keyframes.appendChild(card);
  });
  resolveImagesIn(els.chain32Keyframes);
  const midReady = Boolean(keyframeUrls[1] && keyframeUrls[2] && keyframeUrls[3]);
  const canConfirm =
    midReady &&
    Boolean(refs[0] && refs[1]) &&
    !loading &&
    phase !== 'segments' &&
    phase !== 'complete';
  if (els.chain32ConfirmBtn) {
    els.chain32ConfirmBtn.disabled = !canConfirm;
    els.chain32ConfirmBtn.textContent =
      phase === 'complete'
        ? '已完成 32 帧'
        : phase === 'segments'
          ? '分段生成中 / 可重试缺失段'
          : '确认关键帧并生成四段';
  }
  if (els.chain32PhaseLabel) {
    const labelsByPhase = {
      idle: refs.length >= 2 ? '可生成中间关键帧' : '需要 @1 首帧与 @2 尾帧',
      keyframes: '并行生成中间关键帧…',
      'awaiting-confirm': '请确认 K1–K3 后开始四段',
      segments: '并行生成四段动画…',
      complete: '32 帧已就绪',
      legacy: '旧版接力动画',
    };
    els.chain32PhaseLabel.textContent = labelsByPhase[phase] || labelsByPhase.idle;
  }
}

function renderChain32Progress(node = selectedNode()) {
  const animation = nodeAnimation(node);
  const slots = isAnyChain32(animation) ? anchoredSegmentSlots(animation) : [null, null, null, null];
  for (const [index, marker] of [...els.chain32Progress.children].entries()) {
    const status = state.flipbook.segmentStatus[index];
    const done = Boolean(slots[index]);
    marker.className = status === 'error'
      ? 'error'
      : done
        ? 'complete'
        : status === 'loading'
          ? 'current'
          : '';
    marker.title = done
      ? `第 ${index + 1} 段已完成`
      : status === 'loading'
        ? `第 ${index + 1} 段生成中`
        : status === 'error'
          ? `第 ${index + 1} 段失败`
          : `第 ${index + 1} 段`;
  }
}

function updateFlipbookUi() {
  const mode = els.genMode.value;
  const isFlipbook = mode === 'flipbook';
  const isChain32 = mode === 'chain32';
  const isAnimation = isFlipbook || isChain32;
  const bindings = syncPromptBindingsForMode(mode);
  state.flipbook.mode = mode;
  els.flipbookControls.hidden = !isAnimation;
  els.flipbookFramesLabel.hidden = !isFlipbook;
  els.chain32Controls.hidden = !isChain32;
  const frameCount = isChain32 ? 9 : Number(els.flipbookFrames.value) || 4;
  const layout = isChain32 ? FLIPBOOK_LAYOUTS[9] : flipbookLayout();
  els.flipbookGridHint.textContent = isChain32
    ? '关键帧规划 + 4 段并行 · 每段 2 批 2×2 · 共 32 帧'
    : layout.dropLeadingFrame
      ? `网格 ${layout.columns}×${layout.rows} · 首格作为锚点，裁切后保留 ${layout.outputFrameCount} 帧`
      : `网格 ${layout.columns}×${layout.rows} · 单张图集裁切后按序播放`;
  if (isChain32) {
    const boundCount = [bindings.atlas, bindings.keyframe, bindings.segment].filter(Boolean).length;
    els.flipbookTemplateName.textContent = `${boundCount}/3 模板已绑定`;
    els.flipbookTemplateName.title = [bindings.atlas, bindings.keyframe, bindings.segment]
      .filter(Boolean)
      .map((item) => item.name)
      .join(' · ');
    els.flipbookPickTemplateBtn.textContent = '查看模板映射';
  } else {
    els.flipbookTemplateName.textContent = bindings.atlas?.name || '未找到翻页图集模板';
    els.flipbookTemplateName.title = bindings.atlas?.name || '';
    els.flipbookPickTemplateBtn.textContent = '更换模板';
  }
  const phase = anchoredPhase();
  els.generateBtn.textContent = generationFor()?.status === 'loading'
    ? els.generateBtn.textContent
    : isChain32
      ? phase === 'awaiting-confirm'
        ? '确认关键帧并生成'
        : phase === 'segments'
          ? '继续缺失分段'
          : phase === 'complete'
            ? '重新生成关键帧'
            : '生成中间关键帧'
      : isFlipbook
      ? '生成动画'
      : '生成图片';

  if (isFlipbook && frameCount >= 16) {
    els.flipbookClarityHint.hidden = false;
    els.flipbookClarityHint.textContent =
      '16 帧使用一张 4×4 图集，每格像素较少；文字请尽量少、字号大并保持高对比。';
  } else if (isFlipbook && frameCount >= 8) {
    els.flipbookClarityHint.hidden = false;
    els.flipbookClarityHint.textContent =
      '8 帧使用一张 3×3 图集：第 1 格作为动作起始锚点，最终保留后 8 格。';
  } else if (isChain32) {
    els.flipbookClarityHint.hidden = false;
    els.flipbookClarityHint.textContent =
      '请先选好 @1 首帧与 @2 尾帧。前三段不会看到最终尾帧，避免动作在第一段提前完成。';
    els.flipbookClarityHint.textContent =
      '每个 8 帧分段拆为两批 2×2；前一批只推进到段内 50%，后一批才使用该段尾锚点。';
  } else {
    els.flipbookClarityHint.hidden = true;
    els.flipbookClarityHint.textContent = '';
  }

  if (isAnimation) {
    if (isChain32) {
      els.flipbookFinalPreview.textContent = composeAnchoredPreviewPrompt();
      els.genPrompt.placeholder = '32 帧主提示词：主体、场景、风格、总体动作…';
    } else {
      const composed = composeFlipbookPrompt(els.genPrompt.value.trim());
      els.flipbookFinalPreview.textContent = composed.prompt || '（填写动作内容并选用提词模板）';
      els.genPrompt.placeholder = '动画内容：动作、对象、镜头… 输入 @ 引用图片';
    }
  } else {
    els.genPrompt.placeholder = '画面、构图、光线… 输入 @ 引用图片';
  }

  if (isChain32) {
    renderChain32Keyframes();
    renderChain32Progress();
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

function setFlipbookTemplate(item, { refresh = true } = {}) {
  if (item && promptRole(item) !== 'flipbook') {
    setGenStatus('当前模式只能绑定“翻页图集”角色的模板', 'error');
    return false;
  }
  state.flipbook.templateId = item?.id || null;
  state.flipbook.templateName = item?.name || '';
  state.flipbook.templateContent = item?.content || '';
  state.flipbook.pickingTemplate = false;
  if (refresh) updateFlipbookUi();
  return true;
}

function captionTextAt(elapsed) {
  return captions()
    .filter((caption) => elapsed >= caption.startMs && elapsed < caption.endMs)
    .map((caption) => caption.text)
    .filter(Boolean)
    .join('\n');
}

function renderPreviewCaption(elapsed) {
  const text = captionTextAt(elapsed);
  els.previewCaption.textContent = text;
  els.previewCaption.hidden = !text;
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

function captions() {
  if (!Array.isArray(state.timeline.captions)) state.timeline.captions = [];
  return state.timeline.captions;
}

function selectedCaption() {
  return captions().find((caption) => caption.id === state.captionTrack.selectedId) || null;
}

function captionTrackDurationMs() {
  return Math.max(
    10000,
    previewTotalDuration(),
    ...captions().map((caption) => Number(caption.endMs) || 0),
  );
}

function captionTrackFitWidth() {
  return Math.max(700, (els.captionTrackScroll.clientWidth || 724) - 24);
}

function applyCaptionCanvasWidth() {
  const width = Math.round(captionTrackFitWidth() * state.captionTrack.zoom);
  els.captionTrackCanvas.style.width = `${width}px`;
  els.captionZoom.value = String(state.captionTrack.zoom);
  els.captionZoomLabel.textContent = `${state.captionTrack.zoom}×`;
  return width;
}

function captionSnapMs() {
  if (state.captionTrack.zoom >= 12) return 10;
  if (state.captionTrack.zoom >= 6) return 20;
  return 50;
}

function captionRulerIntervalMs(duration, width) {
  const target = (duration * 74) / Math.max(1, width);
  const candidates = [
    10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000,
    120000, 300000, 600000,
  ];
  return candidates.find((value) => value >= target) || 600000;
}

function formatCaptionRulerTime(ms) {
  if (ms < 60000) {
    const seconds = ms / 1000;
    return `${seconds < 10 && ms % 1000 ? seconds.toFixed(2) : seconds.toFixed(ms % 1000 ? 1 : 0)}s`;
  }
  return formatCaptionTime(ms).replace(/\.\d{2}$/, '');
}

function setCaptionZoom(value) {
  const next = Math.min(20, Math.max(1, Math.round(Number(value) || 1)));
  if (next === state.captionTrack.zoom) return;
  const duration = captionTrackDurationMs();
  const oldWidth = els.captionTrackCanvas.getBoundingClientRect().width || captionTrackFitWidth();
  const playheadX = (state.captionTrack.elapsed / duration) * oldWidth;
  const viewportX = playheadX - els.captionTrackScroll.scrollLeft;
  state.captionTrack.zoom = next;
  localStorage.setItem('script-flow-caption-zoom', String(next));
  renderCaptionTrack();
  const newWidth = els.captionTrackCanvas.getBoundingClientRect().width;
  const newPlayheadX = (state.captionTrack.elapsed / duration) * newWidth;
  els.captionTrackScroll.scrollLeft = Math.max(0, newPlayheadX - viewportX);
}

function formatCaptionTime(ms) {
  const total = Math.max(0, Number(ms) || 0);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function stopCaptionPlayback() {
  if (state.captionTrack.rafId) {
    cancelAnimationFrame(state.captionTrack.rafId);
    state.captionTrack.rafId = null;
  }
  state.captionTrack.playing = false;
  els.captionPlayBtn.textContent = '▶ 播放';
}

function updateCaptionPreviewAspect() {
  const image = els.captionPreviewImage;
  const hasNaturalSize = !image.hidden && image.naturalWidth > 0 && image.naturalHeight > 0;
  const ratio = hasNaturalSize ? image.naturalWidth / image.naturalHeight : 16 / 9;
  const maxWidth = Math.min(680, Math.max(220, els.captionTrackPanel.clientWidth - 44));
  const maxHeight = Math.min(400, Math.max(180, window.innerHeight * 0.38));
  const width = Math.min(maxWidth, maxHeight * ratio);
  els.captionPreviewStage.style.width = `${Math.round(width)}px`;
  els.captionPreviewStage.style.aspectRatio = hasNaturalSize
    ? `${image.naturalWidth} / ${image.naturalHeight}`
    : '16 / 9';
}

function renderCaptionWorkbenchFrame() {
  const elapsed = state.captionTrack.elapsed;
  const videoDuration = previewTotalDuration();
  const trackDuration = captionTrackDurationMs();
  const hasScene = previewNodes().length > 0 && elapsed < videoDuration;
  let imageUrl = '';
  let nodeLabel = '';

  if (hasScene) {
    const scene = previewNodeAt(elapsed);
    const node = previewNodes()[scene.index];
    const animation = nodeAnimation(node);
    imageUrl = node?.imageUrl || '';
    if (animation?.frameUrls?.length) {
      const fps = normalizeFps(animation.fps, 4);
      const frameIndex =
        Math.floor((Math.max(0, scene.localElapsed) * fps) / 1000) % animation.frameUrls.length;
      imageUrl = animation.frameUrls[frameIndex];
    }
    nodeLabel = `${node?.title || '未命名镜头'} · ${formatCaptionTime(scene.localElapsed)}`;
  }

  els.captionPreviewImage.hidden = !imageUrl;
  els.captionPreviewEmpty.hidden = Boolean(imageUrl);
  if (imageUrl) {
    if (els.captionPreviewImage.getAttribute('data-asset') !== imageUrl) {
      setImgSrc(els.captionPreviewImage, imageUrl);
    }
  } else {
    setImgSrc(els.captionPreviewImage, '');
  }
  if (!imageUrl) updateCaptionPreviewAspect();
  els.captionPreviewNode.textContent = nodeLabel;
  const text = captionTextAt(elapsed);
  els.captionPreviewText.textContent = text;
  els.captionPreviewText.hidden = !text;
  els.captionCurrentTime.textContent = formatCaptionTime(elapsed);
  els.captionTotalTime.textContent = formatCaptionTime(trackDuration);
  els.captionPlayhead.style.left = `${Math.min(100, Math.max(0, (elapsed / trackDuration) * 100))}%`;
  if (state.captionTrack.playing && state.captionTrack.zoom > 1) {
    const playheadX =
      (elapsed / trackDuration) * els.captionTrackCanvas.getBoundingClientRect().width;
    const left = els.captionTrackScroll.scrollLeft;
    const right = left + els.captionTrackScroll.clientWidth;
    if (playheadX > right - 72) {
      els.captionTrackScroll.scrollLeft = Math.max(0, playheadX - 96);
    } else if (playheadX < left + 24) {
      els.captionTrackScroll.scrollLeft = Math.max(0, playheadX - 24);
    }
  }
}

function setCaptionWorkbenchElapsed(elapsed) {
  state.captionTrack.elapsed = Math.min(
    captionTrackDurationMs(),
    Math.max(0, Number(elapsed) || 0),
  );
  if (state.captionTrack.playing) {
    state.captionTrack.startedAt = performance.now() - state.captionTrack.elapsed;
  }
  renderCaptionWorkbenchFrame();
}

function captionPlaybackTick(now) {
  if (!state.captionTrack.playing) return;
  state.captionTrack.elapsed = now - state.captionTrack.startedAt;
  const duration = captionTrackDurationMs();
  if (state.captionTrack.elapsed >= duration) {
    state.captionTrack.elapsed = duration;
    stopCaptionPlayback();
    renderCaptionWorkbenchFrame();
    return;
  }
  renderCaptionWorkbenchFrame();
  state.captionTrack.rafId = requestAnimationFrame(captionPlaybackTick);
}

function toggleCaptionPlayback() {
  if (state.captionTrack.playing) {
    stopCaptionPlayback();
    return;
  }
  const duration = captionTrackDurationMs();
  if (state.captionTrack.elapsed >= duration) state.captionTrack.elapsed = 0;
  state.captionTrack.playing = true;
  state.captionTrack.startedAt = performance.now() - state.captionTrack.elapsed;
  els.captionPlayBtn.textContent = 'Ⅱ 暂停';
  state.captionTrack.rafId = requestAnimationFrame(captionPlaybackTick);
}

function captionStartForCurrentContext() {
  if (!els.captionTrackPanel.hidden) return Math.round(state.captionTrack.elapsed);
  if (state.preview.open) return Math.round(state.preview.elapsed);
  const node = selectedNode();
  const index = previewNodes().findIndex((entry) => entry.id === node?.id);
  return index >= 0 ? previewStartForIndex(index) : 0;
}

function openCaptionTrackPanel() {
  closeLibraryPanel();
  closeGeneratedAssetsPanel();
  closePromptLibraryPanel();
  stopCaptionPlayback();
  state.captionTrack.elapsed = state.preview.open
    ? state.preview.elapsed
    : captionStartForCurrentContext();
  els.captionTrackPanel.hidden = false;
  els.captionTrackBackdrop.hidden = false;
  renderCaptionTrack();
  requestAnimationFrame(() => {
    const duration = captionTrackDurationMs();
    const playheadX =
      (state.captionTrack.elapsed / duration) * els.captionTrackCanvas.getBoundingClientRect().width;
    els.captionTrackScroll.scrollLeft = Math.max(
      0,
      playheadX - els.captionTrackScroll.clientWidth / 2,
    );
  });
}

function closeCaptionTrackPanel() {
  stopCaptionPlayback();
  els.captionTrackPanel.hidden = true;
  els.captionTrackBackdrop.hidden = true;
  state.captionTrack.drag = null;
}

function renderCaptionEditor() {
  const caption = selectedCaption();
  els.captionEditor.hidden = !caption;
  if (!caption) return;
  els.captionText.value = caption.text || '';
  els.captionStart.value = (caption.startMs / 1000).toFixed(2);
  els.captionEnd.value = (caption.endMs / 1000).toFixed(2);
}

async function persistCaption(caption) {
  const updated = await api(`/api/captions/${caption.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      text: caption.text,
      startMs: caption.startMs,
      endMs: caption.endMs,
      anchorNodeId: caption.anchorNodeId || null,
    }),
  });
  const index = captions().findIndex((entry) => entry.id === updated.id);
  if (index >= 0) captions()[index] = updated;
  captions().sort((a, b) => a.startMs - b.startMs);
  renderCaptionTrack();
  return updated;
}

function beginCaptionDrag(event, caption, mode) {
  event.preventDefault();
  event.stopPropagation();
  const laneRect = els.captionLane.getBoundingClientRect();
  if (!laneRect.width) return;
  const duration = captionTrackDurationMs();
  const origin = {
    x: event.clientX,
    startMs: caption.startMs,
    endMs: caption.endMs,
  };
  state.captionTrack.selectedId = caption.id;
  state.captionTrack.drag = { captionId: caption.id, mode };
  renderCaptionEditor();

  const onMove = (moveEvent) => {
    const snapMs = captionSnapMs();
    const deltaMs =
      Math.round((((moveEvent.clientX - origin.x) / laneRect.width) * duration) / snapMs) *
      snapMs;
    if (mode === 'start') {
      caption.startMs = Math.max(0, Math.min(origin.endMs - 100, origin.startMs + deltaMs));
    } else if (mode === 'end') {
      caption.endMs = Math.min(
        duration,
        Math.max(origin.startMs + 100, origin.endMs + deltaMs),
      );
    } else {
      const length = origin.endMs - origin.startMs;
      caption.startMs = Math.max(0, Math.min(duration - length, origin.startMs + deltaMs));
      caption.endMs = caption.startMs + length;
    }
    setCaptionWorkbenchElapsed(mode === 'end' ? caption.endMs : caption.startMs);
    renderCaptionTrack();
  };
  const onEnd = async () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    state.captionTrack.drag = null;
    try {
      await persistCaption(caption);
      setGenStatus('字幕时间已更新', 'success');
    } catch (err) {
      await loadTimeline();
      setGenStatus(`字幕时间保存失败：${err.message}`, 'error');
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd, { once: true });
}

function renderCaptionTrack() {
  const items = [...captions()].sort((a, b) => a.startMs - b.startMs);
  const duration = captionTrackDurationMs();
  const canvasWidth = applyCaptionCanvasWidth();
  const rowEnds = [];
  const rows = new Map();
  for (const caption of items) {
    let row = rowEnds.findIndex((endMs) => caption.startMs >= endMs);
    if (row < 0) {
      row = rowEnds.length;
      rowEnds.push(caption.endMs);
    } else {
      rowEnds[row] = caption.endMs;
    }
    rows.set(caption.id, row);
  }
  els.captionTrackSummary.textContent = `${items.length} 条字幕 · ${(duration / 1000).toFixed(1)} 秒`;
  els.captionTrackEmpty.hidden = items.length > 0;
  els.captionRuler.innerHTML = '';
  const tickInterval = captionRulerIntervalMs(duration, canvasWidth);
  for (let time = 0; time <= duration; time += tickInterval) {
    const tick = document.createElement('span');
    tick.style.left = `${(time / duration) * 100}%`;
    tick.textContent = formatCaptionRulerTime(time);
    els.captionRuler.appendChild(tick);
  }
  if (duration % tickInterval !== 0) {
    const finalTick = document.createElement('span');
    finalTick.style.left = '100%';
    finalTick.textContent = formatCaptionRulerTime(duration);
    els.captionRuler.appendChild(finalTick);
  }

  els.captionShotLane.innerHTML = '';
  let shotCursor = 0;
  for (const node of previewNodes()) {
    const shotDuration = nodeDuration(node);
    const shot = document.createElement('button');
    shot.type = 'button';
    shot.className = 'caption-shot';
    shot.style.left = `${(shotCursor / duration) * 100}%`;
    shot.style.width = `${Math.max(0.8, (shotDuration / duration) * 100)}%`;
    shot.title = `${node.title || '未命名镜头'} · ${(shotDuration / 1000).toFixed(1)}s`;
    shot.innerHTML = `
      ${node.imageUrl ? imgAsset(node.imageUrl) : '<span class="caption-shot-empty"></span>'}
      <strong>${escapeHtml(node.title || '未命名')}</strong>
    `;
    const shotStart = shotCursor;
    shot.addEventListener('click', (event) => {
      event.stopPropagation();
      stopCaptionPlayback();
      setCaptionWorkbenchElapsed(shotStart);
    });
    els.captionShotLane.appendChild(shot);
    shotCursor += shotDuration;
  }
  resolveImagesIn(els.captionShotLane);
  els.captionLane.innerHTML = '';
  els.captionLane.style.height = `${Math.max(76, rowEnds.length * 34 + 12)}px`;
  for (const caption of items) {
    const bar = document.createElement('div');
    bar.className = `caption-block${caption.id === state.captionTrack.selectedId ? ' selected' : ''}`;
    bar.style.left = `${(caption.startMs / duration) * 100}%`;
    bar.style.width = `${Math.max(0.8, ((caption.endMs - caption.startMs) / duration) * 100)}%`;
    bar.style.top = `${8 + (rows.get(caption.id) || 0) * 34}px`;
    bar.title = `${(caption.startMs / 1000).toFixed(2)}s – ${(caption.endMs / 1000).toFixed(2)}s`;
    bar.innerHTML = `
      <button type="button" class="caption-resize caption-resize-start" aria-label="调整字幕开始时间"></button>
      <span>${escapeHtml(caption.text)}</span>
      <button type="button" class="caption-resize caption-resize-end" aria-label="调整字幕结束时间"></button>
    `;
    bar.addEventListener('click', () => {
      state.captionTrack.selectedId = caption.id;
      stopCaptionPlayback();
      setCaptionWorkbenchElapsed(caption.startMs);
      renderCaptionTrack();
    });
    bar.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.caption-resize-start')) beginCaptionDrag(event, caption, 'start');
      else if (event.target.closest('.caption-resize-end')) beginCaptionDrag(event, caption, 'end');
      else beginCaptionDrag(event, caption, 'move');
    });
    els.captionLane.appendChild(bar);
  }
  renderCaptionEditor();
  renderCaptionWorkbenchFrame();
}

async function addCaption() {
  const startMs = captionStartForCurrentContext();
  const caption = await api('/api/captions', {
    method: 'POST',
    body: JSON.stringify({
      text: '新字幕',
      startMs,
      endMs: startMs + 2000,
      anchorNodeId: selectedNode()?.id || null,
    }),
  });
  captions().push(caption);
  captions().sort((a, b) => a.startMs - b.startMs);
  state.captionTrack.selectedId = caption.id;
  renderCaptionTrack();
  els.captionText.focus();
}

async function saveCaptionEditor() {
  const caption = selectedCaption();
  if (!caption) return;
  const text = els.captionText.value.trim();
  const startMs = Math.round(Number(els.captionStart.value) * 1000);
  const endMs = Math.round(Number(els.captionEnd.value) * 1000);
  if (!text) {
    setGenStatus('字幕内容不能为空', 'error');
    return;
  }
  caption.text = text;
  caption.startMs = Number.isFinite(startMs) ? Math.max(0, startMs) : caption.startMs;
  caption.endMs = Number.isFinite(endMs)
    ? Math.max(caption.startMs + 100, endMs)
    : caption.endMs;
  try {
    await persistCaption(caption);
    setGenStatus('字幕已保存', 'success');
  } catch (err) {
    setGenStatus(`字幕保存失败：${err.message}`, 'error');
  }
}

async function deleteSelectedCaption() {
  const caption = selectedCaption();
  if (!caption) return;
  const confirmed = await showAppDialog({
    title: '删除字幕',
    message: `确定删除「${caption.text}」？删除后无法恢复。`,
    confirmLabel: '删除字幕',
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await api(`/api/captions/${caption.id}`, { method: 'DELETE' });
    state.timeline.captions = captions().filter((entry) => entry.id !== caption.id);
    state.captionTrack.selectedId = null;
    renderCaptionTrack();
    setGenStatus('字幕已删除', 'success');
  } catch (err) {
    setGenStatus(`字幕删除失败：${err.message}`, 'error');
  }
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
    tag.innerHTML = `${imgAsset(refs[index])}<span>@${index + 1}</span>`;
    tag.addEventListener('click', () => insertReferenceMention(index));
    els.promptReferenceTags.appendChild(tag);
  }
  resolveImagesIn(els.promptReferenceTags);
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
    option.innerHTML = `${imgAsset(url)}<strong>@${index + 1}</strong>`;
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      insertReferenceMention(index);
    });
    els.referenceMentionMenu.appendChild(option);
  }
  els.referenceMentionMenu.hidden = false;
  resolveImagesIn(els.referenceMentionMenu);
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
    const role =
      els.genMode.value === 'chain32'
        ? index === 0
          ? ' · 首帧 K0'
          : index === 1
            ? ' · 尾帧 K4'
            : ''
        : '';
    chip.title = `点击 @${index + 1} 插入 Prompt${role}`;
    chip.innerHTML = `
      ${imgAsset(url)}
      <button type="button" class="ref-chip-mention" aria-label="插入参考图 @${index + 1}">@${index + 1}${role ? role.replace(' · ', ' ') : ''}</button>
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
  resolveImagesIn(els.refChips);
  updateReferenceCount();
  renderPromptReferenceTags();
  if (els.genMode.value === 'chain32') renderChain32Keyframes();
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
  const hasFrames = Boolean(nodeAnimation(node)?.frameUrls?.length);
  els.addToLibraryBtn.disabled = !hasImage;
  els.useCurrentRefBtn.disabled = !hasImage;
  els.saveFlipbookFrameBtn.disabled = !hasFrames;
}

function updateNodeActions() {
  const hasNode = Boolean(selectedNode());
  const hasPreviewNode = previewNodes().length > 0;
  const hasCurrentAnimation = Boolean(nodeAnimation()?.frameUrls?.length);
  els.saveNodeTopBtn.disabled = !hasNode;
  els.deleteNodeTopBtn.disabled = !hasNode;
  els.imageUpload.disabled = !hasNode;
  els.fillPromptBtn.disabled = !hasNode;
  els.genPrompt.disabled = !hasNode;
  els.previewBtn.disabled = !hasPreviewNode;
  els.workbenchPreviewBtn.disabled = !hasCurrentAnimation;
}

async function loadLibrary() {
  state.library = await api('/api/library');
  try {
    await hydrateActiveProjectSeedAssets(state.library);
    clearDisplayUrlCache();
  } catch {
    /* seed hydrate is best-effort */
  }
  renderLibraryGrid();
}

function openLibrary(mode = 'manage') {
  if (mode === 'select' && !selectedNode()) {
    setGenStatus('请先选择时间线节点，再选择参考图', 'error');
    return;
  }
  closeCaptionTrackPanel();
  closeGeneratedAssetsPanel();
  closePromptLibraryPanel();
  state.libraryMode = mode;
  const selecting = mode === 'select';
  els.libraryTitle.textContent = selecting ? '选择参考图' : '设定集管理';
  els.libraryKicker.textContent = selecting ? 'CHOOSE REFERENCES' : 'REFERENCE LIBRARY';
  els.libraryHint.textContent = selecting
    ? '点击图片进行多选；已选参考会用于当前节点出图'
    : '保存角色、场景、风格参考，之后可以重复使用';
  els.libraryPanel.classList.toggle('is-selecting', selecting);
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

async function loadGeneratedAssets() {
  state.generatedAssets = await api('/api/generated-assets');
  renderGeneratedAssets();
}

async function openGeneratedAssets() {
  closeLibraryPanel();
  closeCaptionTrackPanel();
  closePromptLibraryPanel();
  els.generatedAssetsSearch.value = '';
  els.generatedAssetsFilter.value = 'all';
  els.generatedAssetsPanel.hidden = false;
  els.generatedAssetsBackdrop.hidden = false;
  els.generatedAssetsGrid.innerHTML = '<p class="generated-assets-empty">正在加载素材…</p>';
  try {
    await loadGeneratedAssets();
  } catch (err) {
    els.generatedAssetsGrid.innerHTML = `<p class="generated-assets-empty">素材仓库加载失败<br>${escapeHtml(err.message)}</p>`;
  }
}

function closeGeneratedAssetsPanel() {
  stopGeneratedAssetPreview();
  els.generatedAssetsPanel.hidden = true;
  els.generatedAssetsBackdrop.hidden = true;
}

function generatedAssetDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function generatedAssetFrameUrls(item) {
  if (!item) return [];
  const animation = item.animation;
  if (Array.isArray(animation?.frameUrls) && animation.frameUrls.length) {
    return animation.frameUrls;
  }
  const fromSegments = [];
  for (const segment of animation?.segments || []) {
    for (const url of segment?.frameUrls || []) fromSegments.push(url);
  }
  if (fromSegments.length) return fromSegments;
  const single = item.coverUrl || item.imageUrl;
  return single ? [single] : [];
}

function stopGeneratedAssetPreview() {
  if (state.assetPreview.rafId) {
    cancelAnimationFrame(state.assetPreview.rafId);
    state.assetPreview.rafId = null;
  }
  state.assetPreview.playing = false;
  state.assetPreview.assetId = null;
  state.assetPreview.index = 0;
  state.assetPreview.startedAt = 0;
}

function showGeneratedAssetFrame(assetId, index) {
  const card = els.generatedAssetsGrid.querySelector(`[data-asset-id="${assetId}"]`);
  if (!card) return;
  const item = (state.generatedAssets.items || []).find((entry) => entry.id === assetId);
  const frameUrls = generatedAssetFrameUrls(item);
  if (!frameUrls.length) return;
  const safeIndex = ((index % frameUrls.length) + frameUrls.length) % frameUrls.length;
  state.assetPreview.index = safeIndex;
  const coverImage = card.querySelector('.generated-asset-cover-image');
  const label = card.querySelector('.generated-asset-frame-label');
  const playBtn = card.querySelector('.generated-asset-play');
  if (coverImage) {
    const next = frameUrls[safeIndex];
    if (coverImage.getAttribute('data-asset') !== next) {
      setImgSrc(coverImage, next);
    }
  }
  if (label) label.textContent = `${safeIndex + 1} / ${frameUrls.length}`;
  if (playBtn) {
    playBtn.textContent = state.assetPreview.playing && state.assetPreview.assetId === assetId
      ? 'Ⅱ 暂停'
      : '▶ 播放';
    playBtn.setAttribute(
      'aria-label',
      state.assetPreview.playing && state.assetPreview.assetId === assetId ? '暂停预览' : '播放预览',
    );
  }
  for (const frame of card.querySelectorAll('.generated-asset-frame')) {
    frame.classList.toggle('active', Number(frame.dataset.frameIndex) === safeIndex);
  }
}

function playGeneratedAssetPreview(item, { fromIndex = 0, resume = false } = {}) {
  const frameUrls = generatedAssetFrameUrls(item);
  if (frameUrls.length < 2) {
    openLightbox(frameUrls[0] || item.coverUrl || item.imageUrl, item.name);
    return;
  }
  if (!resume && state.assetPreview.playing && state.assetPreview.assetId === item.id) {
    const pausedIndex = state.assetPreview.index;
    stopGeneratedAssetPreview();
    state.assetPreview.assetId = item.id;
    state.assetPreview.index = pausedIndex;
    showGeneratedAssetFrame(item.id, pausedIndex);
    return;
  }
  stopGeneratedAssetPreview();
  state.assetPreview.assetId = item.id;
  state.assetPreview.playing = true;
  state.assetPreview.index = fromIndex;
  const fps = normalizeFps(item.fps || item.animation?.fps, 4);
  const frameDuration = Math.max(1, Math.round(1000 / fps));
  state.assetPreview.startedAt = performance.now() - fromIndex * frameDuration;
  showGeneratedAssetFrame(item.id, fromIndex);
  const tick = (now) => {
    if (!state.assetPreview.playing || state.assetPreview.assetId !== item.id) return;
    const frameIndex = Math.floor((now - state.assetPreview.startedAt) / frameDuration) % frameUrls.length;
    if (frameIndex !== state.assetPreview.index) showGeneratedAssetFrame(item.id, frameIndex);
    state.assetPreview.rafId = requestAnimationFrame(tick);
  };
  state.assetPreview.rafId = requestAnimationFrame(tick);
}

function renderGeneratedAssets() {
  const resumePreview = state.assetPreview.playing
    ? { id: state.assetPreview.assetId, index: state.assetPreview.index }
    : null;
  if (state.assetPreview.rafId) {
    cancelAnimationFrame(state.assetPreview.rafId);
    state.assetPreview.rafId = null;
  }
  state.assetPreview.playing = false;

  const items = state.generatedAssets.items || [];
  const query = els.generatedAssetsSearch.value.trim().toLowerCase();
  const type = els.generatedAssetsFilter.value;
  const visibleItems = items.filter((item) => {
    if (type !== 'all' && item.type !== type) return false;
    return `${item.name || ''} ${item.prompt || ''} ${item.model || ''}`
      .toLowerCase()
      .includes(query);
  });
  els.generatedAssetsGrid.innerHTML = '';

  if (!visibleItems.length) {
    els.generatedAssetsGrid.innerHTML = items.length
      ? '<p class="generated-assets-empty">没有匹配的素材</p>'
      : '<p class="generated-assets-empty">素材仓库还是空的<br>生成图片或动画后会自动保存在这里</p>';
    return;
  }

  for (const item of visibleItems) {
    const isAnimation = item.type === 'animation';
    const frameUrls = generatedAssetFrameUrls(item);
    const expanded = state.expandedGeneratedAssets.has(item.id);
    const isPlaying = resumePreview?.id === item.id;
    const currentIndex = isPlaying ? resumePreview.index : 0;
    const coverUrl = (isAnimation && frameUrls[currentIndex]) || item.coverUrl || item.imageUrl || '';
    const meta = [
      isAnimation ? `${frameUrls.length || item.frameCount || 0} 帧` : '单张图片',
      isAnimation && (item.fps || item.animation?.fps) ? `${item.fps || item.animation.fps} FPS` : '',
      item.model || '',
      generatedAssetDate(item.updatedAt || item.createdAt),
    ].filter(Boolean);
    const card = document.createElement('article');
    card.className = `generated-asset-card${isAnimation ? ' is-animation' : ''}`;
    card.dataset.assetId = item.id;
    card.innerHTML = `
      <div class="generated-asset-cover${isAnimation ? ' is-animation' : ''}">
        <button type="button" class="generated-asset-cover-hit" aria-label="${isAnimation ? '放大查看当前帧' : '查看图片'}">
          ${imgAsset(coverUrl, 'generated-asset-cover-image', item.name || '')}
        </button>
        <span class="generated-asset-type">${isAnimation ? '动画' : '图片'}</span>
        ${isAnimation
          ? `<span class="generated-asset-frame-label">${currentIndex + 1} / ${frameUrls.length || 1}</span>
             <button type="button" class="generated-asset-play" aria-label="播放预览">${isPlaying ? 'Ⅱ 暂停' : '▶ 播放'}</button>`
          : ''}
      </div>
      <div class="generated-asset-body">
        <div class="generated-asset-heading">
          <strong title="${escapeHtml(item.name || '')}">${escapeHtml(item.name || '未命名素材')}</strong>
          <button type="button" class="generated-asset-delete" aria-label="删除素材">×</button>
        </div>
        <p class="generated-asset-meta">${escapeHtml(meta.join(' · '))}</p>
        ${item.prompt ? `<p class="generated-asset-prompt" title="${escapeHtml(item.prompt)}">${escapeHtml(item.prompt)}</p>` : ''}
        <div class="generated-asset-actions">
          <button type="button" class="btn btn-primary btn-sm generated-asset-apply"${selectedNode() ? '' : ' disabled'}>应用到当前节点</button>
          <button type="button" class="btn btn-ghost btn-sm generated-asset-rename">重命名</button>
          ${isAnimation ? `<button type="button" class="btn btn-ghost btn-sm generated-asset-toggle">${expanded ? '收起帧' : `查看帧 (${frameUrls.length})`}</button>` : ''}
        </div>
        ${isAnimation
          ? `<div class="generated-asset-frames"${expanded ? '' : ' hidden'}>${frameUrls
              .map(
                (url, index) =>
                  `<button type="button" class="generated-asset-frame${index === currentIndex ? ' active' : ''}" data-frame-index="${index}" title="预览第 ${index + 1} 帧">${imgAsset(url, '', `第 ${index + 1} 帧`)}</button>`,
              )
              .join('')}</div>`
          : ''}
      </div>
    `;

    card.querySelector('.generated-asset-cover-hit').addEventListener('click', () => {
      if (isAnimation) {
        openLightbox(frameUrls[state.assetPreview.assetId === item.id ? state.assetPreview.index : 0] || coverUrl, item.name);
        return;
      }
      openLightbox(item.coverUrl || item.imageUrl, item.name);
    });
    card.querySelector('.generated-asset-play')?.addEventListener('click', (event) => {
      event.stopPropagation();
      playGeneratedAssetPreview(item, {
        fromIndex: state.assetPreview.assetId === item.id ? state.assetPreview.index : 0,
      });
    });
    card.querySelector('.generated-asset-apply').addEventListener('click', async () => {
      const node = selectedNode();
      if (!node) {
        setGenStatus('请先选择要应用素材的时间线节点', 'error');
        return;
      }
      try {
        const data = await api(`/api/generated-assets/${item.id}/apply`, {
          method: 'POST',
          body: JSON.stringify({ nodeId: node.id }),
        });
        const index = state.timeline.nodes.findIndex((entry) => entry.id === node.id);
        if (index >= 0) state.timeline.nodes[index] = data.node;
        renderNodes();
        renderEditor();
        setGenStatus(`已应用素材：${item.name}`, 'success');
      } catch (err) {
        setGenStatus(`应用素材失败：${err.message}`, 'error');
      }
    });
    card.querySelector('.generated-asset-rename').addEventListener('click', async () => {
      const name = await openAppDialog({
        title: '重命名素材',
        message: '为这份素材设置一个便于查找的名称。',
        confirmLabel: '保存名称',
        input: {
          label: '素材名称',
          value: item.name || '',
          placeholder: '输入素材名称',
        },
      });
      if (name === null || !name.trim() || name.trim() === item.name) return;
      try {
        await api(`/api/generated-assets/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim() }),
        });
        await loadGeneratedAssets();
      } catch (err) {
        setGenStatus(`重命名失败：${err.message}`, 'error');
      }
    });
    card.querySelector('.generated-asset-delete').addEventListener('click', async () => {
      const confirmed = await openAppDialog({
        title: '删除素材',
        message: `确定删除「${item.name}」？\n正在被节点使用的图片文件会继续保留。`,
        confirmLabel: '删除素材',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        if (state.assetPreview.assetId === item.id) stopGeneratedAssetPreview();
        await api(`/api/generated-assets/${item.id}`, { method: 'DELETE' });
        state.expandedGeneratedAssets.delete(item.id);
        await loadGeneratedAssets();
        setGenStatus(`已删除素材：${item.name}`, 'success');
      } catch (err) {
        setGenStatus(`删除素材失败：${err.message}`, 'error');
      }
    });
    const toggle = card.querySelector('.generated-asset-toggle');
    toggle?.addEventListener('click', () => {
      if (state.expandedGeneratedAssets.has(item.id)) state.expandedGeneratedAssets.delete(item.id);
      else state.expandedGeneratedAssets.add(item.id);
      renderGeneratedAssets();
    });
    for (const frame of card.querySelectorAll('.generated-asset-frame')) {
      frame.addEventListener('click', () => {
        const index = Number(frame.dataset.frameIndex);
        if (state.assetPreview.playing && state.assetPreview.assetId === item.id) {
          stopGeneratedAssetPreview();
        }
        showGeneratedAssetFrame(item.id, index);
        state.assetPreview.assetId = item.id;
        state.assetPreview.index = index;
      });
      frame.addEventListener('dblclick', () => {
        const index = Number(frame.dataset.frameIndex);
        openLightbox(frameUrls[index], `${item.name} · 第 ${index + 1} 帧`);
      });
    }
    els.generatedAssetsGrid.appendChild(card);
  }
  resolveImagesIn(els.generatedAssetsGrid);

  if (resumePreview) {
    const stillVisible = visibleItems.some((item) => item.id === resumePreview.id);
    if (!stillVisible) {
      stopGeneratedAssetPreview();
      return;
    }
    const item = items.find((entry) => entry.id === resumePreview.id);
    if (item) {
      playGeneratedAssetPreview(item, { fromIndex: resumePreview.index, resume: true });
    }
  }
}

async function loadPromptLibrary() {
  state.promptLibrary = await api('/api/prompts');
  syncPromptBindingsForMode();
  renderPromptLibrary();
  updateFlipbookUi();
}

async function openPromptLibrary({ pickTemplate = false } = {}) {
  closeLibraryPanel();
  closeCaptionTrackPanel();
  closeGeneratedAssetsPanel();
  state.flipbook.pickingTemplate = pickTemplate ? els.genMode.value : false;
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
  const mode = els.genMode.value;
  const role = promptRole(item);
  if (!promptUsableInMode(item, mode)) {
    setGenStatus(`“${PROMPT_ROLE_LABELS[role] || role}”模板不适用于当前模式`, 'error');
    return;
  }
  if (role === 'flipbook') {
    const hasPlaceholders = /\{(?:frameCount|sheetFrameCount|columns|rows)\}/.test(item.content);
    if (!hasPlaceholders) {
      setGenStatus('翻页图集模板缺少帧数或网格占位符', 'error');
      return;
    }
    if (!setFlipbookTemplate(item)) return;
    closePromptLibraryPanel();
    setGenStatus(`已绑定翻页图集模板：${item.name}`, 'success');
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
  const mode = els.genMode.value;
  const bindings = promptBindingsForMode(mode);
  const modeConfig = promptModeConfig(mode);
  const visibleItems = items.filter((item) => {
    if (state.flipbook.pickingTemplate === 'flipbook' && promptRole(item) !== 'flipbook') {
      return false;
    }
    if (
      state.flipbook.pickingTemplate === 'chain32' &&
      !modeConfig.requiredRoles.includes(promptRole(item))
    ) {
      return false;
    }
    return `${item.name} ${item.content}`.toLowerCase().includes(query);
  });
  els.promptLibraryList.innerHTML = '';

  if (visibleItems.length === 0) {
    els.promptLibraryList.innerHTML = items.length
      ? '<p class="prompt-library-empty">没有匹配的提词</p>'
      : '<p class="prompt-library-empty">提词库是空的<br>可以新建，或保存当前 Prompt</p>';
    return;
  }

  for (const item of visibleItems) {
    const role = promptRole(item);
    const roleLabel = PROMPT_ROLE_LABELS[role] || role;
    const usable = promptUsableInMode(item, mode);
    const automaticallyBound =
      mode === 'chain32' &&
      ((role === 'anchored-keyframe' && bindings.keyframe?.id === item.id) ||
        (role === 'anchored-segment' && bindings.segment?.id === item.id));
    const atlasBound = role === 'flipbook' && bindings.atlas?.id === item.id && mode !== 'single';
    const useLabel = automaticallyBound
      ? '已自动绑定'
      : atlasBound
        ? '当前已绑定'
        : usable
          ? role === 'flipbook'
            ? '绑定到当前模式'
            : '使用此提词'
          : '不适用于当前模式';
    const card = document.createElement('article');
    card.className = `prompt-library-card${usable || automaticallyBound ? '' : ' is-incompatible'}`;
    card.innerHTML = `
      <div class="prompt-library-card-header">
        <strong>${escapeHtml(item.name)}${
          roleLabel ? ` <em class="prompt-role-tag">${roleLabel}</em>` : ''
        }</strong>
        <div class="prompt-library-card-tools">
          <button type="button" class="prompt-card-edit" aria-label="编辑">编辑</button>
          <button type="button" class="prompt-card-delete" aria-label="删除"${SYSTEM_PROMPT_IDS.has(item.id) ? ' disabled title="系统模板不可删除，可直接编辑"' : ''}>×</button>
        </div>
      </div>
      <p>${escapeHtml(item.content)}</p>
      <button type="button" class="btn btn-primary btn-sm prompt-card-use"${!usable || automaticallyBound || atlasBound ? ' disabled' : ''}>${useLabel}</button>
    `;
    card.querySelector('.prompt-card-use').addEventListener('click', () => useLibraryPrompt(item));
    card.querySelector('.prompt-card-edit').addEventListener('click', () => startPromptEdit(item));
    card.querySelector('.prompt-card-delete').addEventListener('click', async () => {
      if (SYSTEM_PROMPT_IDS.has(item.id)) return;
      const confirmed = await openAppDialog({
        title: '删除提词',
        message: `确定删除「${item.name}」？此操作无法撤销。`,
        confirmLabel: '删除提词',
        tone: 'danger',
      });
      if (!confirmed) return;
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
        ${imgAsset(item.imageUrl, '', item.name)}
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
      const confirmed = await openAppDialog({
        title: '删除设定',
        message: `确定从设定集删除「${item.name}」？`,
        confirmLabel: '删除设定',
        tone: 'danger',
      });
      if (!confirmed) return;
      await api(`/api/library/${item.id}`, { method: 'DELETE' });
      removeGenRef(item.imageUrl);
      await loadLibrary();
    });

    els.libraryGrid.appendChild(card);
  }
  resolveImagesIn(els.libraryGrid);
  updateReferenceCount();
}

function showLibraryNameModal(
  imageUrl,
  defaultName = '',
  target = 'library',
  metadata = null,
) {
  state.pendingLibraryImageUrl = imageUrl;
  state.pendingLibraryTarget = target;
  state.pendingLibraryMetadata = metadata;
  els.libraryNameTitle.textContent = target === 'generated-frame' ? '保存当前帧' : '加入设定集';
  els.libraryNameInput.placeholder =
    target === 'generated-frame' ? '例如：转身中间帧' : '例如：主角形象、办公室场景';
  els.libraryNameInput.value = defaultName;
  els.libraryNameModal.hidden = false;
  els.libraryNameInput.focus();
}

function hideLibraryNameModal() {
  els.libraryNameModal.hidden = true;
  state.pendingLibraryImageUrl = null;
  state.pendingLibraryTarget = 'library';
  state.pendingLibraryMetadata = null;
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
  const res = await fetchWithLocal('/api/library', { method: 'POST', body: form, _formData: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  await loadLibrary();
  return data;
}

async function uploadRefFile(file) {
  const form = new FormData();
  form.append('image', file);
  const res = await fetchWithLocal('/api/refs/upload', { method: 'POST', body: form, _formData: form });
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
  showLibraryNameModal(imageUrl, defaultName, 'library');
}

function requestSaveCurrentFrame() {
  const node = selectedNode();
  const animation = nodeAnimation(node);
  if (!node || !animation) return;
  const frameIndex = Math.max(
    0,
    Math.min(animation.frameUrls.length - 1, state.flipbook.previewIndex),
  );
  const imageUrl = animation.frameUrls[frameIndex];
  const sourceAsset = (state.generatedAssets.items || []).find(
    (item) => item.type === 'animation' && item.animation?.frameUrls?.includes(imageUrl),
  );
  showLibraryNameModal(
    imageUrl,
    `${node.title || '分镜'} - 帧 ${frameIndex + 1}`,
    'generated-frame',
    {
      nodeId: node.id,
      frameIndex,
      prompt: node.imagePrompt || '',
      sourceAssetId: sourceAsset?.id || null,
    },
  );
}

async function saveFrameToGeneratedAssets(imageUrl, name, metadata = {}) {
  const asset = await api('/api/generated-assets/from-frame', {
    method: 'POST',
    body: JSON.stringify({ imageUrl, name, ...metadata }),
  });
  const index = (state.generatedAssets.items || []).findIndex((item) => item.id === asset.id);
  if (index >= 0) state.generatedAssets.items[index] = asset;
  else state.generatedAssets.items.unshift(asset);
  if (!els.generatedAssetsPanel.hidden) renderGeneratedAssets();
  setGenStatus(`当前帧已保存到素材仓库：${name}`, 'success');
}

async function confirmAddToLibrary() {
  const url = state.pendingLibraryImageUrl;
  const target = state.pendingLibraryTarget;
  const metadata = state.pendingLibraryMetadata;
  const name = els.libraryNameInput.value.trim() || '未命名参考';
  if (!url) return;
  hideLibraryNameModal();
  try {
    if (target === 'generated-frame') {
      await saveFrameToGeneratedAssets(url, name, metadata || {});
    } else {
      await saveToLibrary(url, name);
    }
  } catch (err) {
    setGenStatus(
      `${target === 'generated-frame' ? '保存当前帧失败' : '加入设定集失败'}：${err.message}`,
      'error',
    );
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
  const selectedCount = state.selectedIds.size;
  els.timelineNodeCount.textContent =
    selectedCount > 1 ? `${count} 幕 · ${selectedCount} 已选` : `${count} 幕`;
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
  if (!url) {
    els.imagePreview.classList.add('is-empty');
    els.imagePreview.innerHTML = '<span class="image-placeholder">暂无图片</span>';
    setImagePreviewAspectFromSize(els.genSize.value);
    return;
  }

  els.imagePreview.classList.remove('is-empty');
  let image = els.imagePreview.querySelector('img');
  if (!image) {
    els.imagePreview.innerHTML = '<img alt="分镜图" />';
    image = els.imagePreview.querySelector('img');
  }

  image.onclick = (event) => {
    event.stopPropagation();
    openLightbox(url, '分镜图');
  };

  if (image.dataset.sourceUrl !== url) {
    image.addEventListener('load', () => {
      setImagePreviewAspect(image.naturalWidth, image.naturalHeight);
    }, { once: true });
    image.dataset.sourceUrl = url;
    setImgSrc(image, url);
  }

  if (image.complete && image.naturalWidth) {
    setImagePreviewAspect(image.naturalWidth, image.naturalHeight);
  }
}

function resizePromptComposer() {
  els.genPrompt.style.height = 'auto';
  els.genPrompt.style.height = `${Math.min(240, Math.max(92, els.genPrompt.scrollHeight))}px`;
}

function openLightbox(url, alt = '') {
  if (!url) return;
  const cleanUrl = String(url).split('?')[0];
  setImgSrc(els.lightboxImage, cleanUrl);
  els.lightboxImage.alt = alt || '';
  els.imageLightbox.hidden = false;
  els.lightboxClose.focus();
}

function closeLightbox() {
  if (els.imageLightbox.hidden) return;
  els.imageLightbox.hidden = true;
  setImgSrc(els.lightboxImage, '');
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
  if (loading) {
    els.generateBtn.textContent = `生成中 ${Math.round(gen.progress)}%`;
    return;
  }
  if (els.genMode.value === 'chain32') {
    const phase = anchoredPhase();
    els.generateBtn.textContent =
      phase === 'awaiting-confirm'
        ? '确认关键帧并生成'
        : phase === 'segments'
          ? '继续缺失分段'
          : phase === 'complete'
            ? '重新生成关键帧'
            : '生成中间关键帧';
    return;
  }
  els.generateBtn.textContent = els.genMode.value === 'flipbook' ? '生成动画' : '生成图片';
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
    if (!state.selectedIds.has(node.id)) {
      state.selectedIds = new Set([node.id]);
      state.selectedId = node.id;
      renderEditor();
    }
    state.dragId = node.id;
    state.dragIds =
      state.selectedIds.has(node.id) && state.selectedIds.size > 1
        ? selectedNodeIdsInOrder()
        : [node.id];
    state.lastDragAt = Date.now();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.setData('application/x-script-flow-node-count', String(state.dragIds.length));
    if (state.dragIds.length > 1) {
      const ghost = document.createElement('div');
      ghost.className = 'node-group-drag-ghost';
      ghost.textContent = `${state.dragIds.length} 个节点`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 24, 18);
      setTimeout(() => ghost.remove(), 0);
    }
    els.timelineScroll.classList.add('is-dragging');
    startAutoScroll();
    requestAnimationFrame(() => {
      for (const item of els.nodesLayer.querySelectorAll('.timeline-node')) {
        const inGroup = state.dragIds.includes(item.dataset.id);
        item.classList.toggle('group-dragging', inGroup);
        item.classList.toggle('dragging', item.dataset.id === node.id);
      }
      updateTrackWidth();
    });
  });

  el.addEventListener('dragend', () => {
    state.dragId = null;
    state.dragIds = [];
    state.lastDragAt = Date.now();
    state.dropTarget = null;
    state.pointerY = null;
    clearDropIndicators();
    stopAutoScroll();
    els.timelineScroll.classList.remove('is-dragging');
    for (const item of els.nodesLayer.querySelectorAll('.timeline-node')) {
      item.classList.remove('dragging', 'group-dragging');
    }
    renderNodes();
    renderEditor();
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    state.pointerY = e.clientY;
    if (state.dragIds.includes(node.id)) {
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
    if (fromId && !state.dragIds.includes(toId)) {
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
      reorderNodesToIndex(fromId, state.timeline.nodes.length);
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
    const isSelected = state.selectedIds.has(node.id) || node.id === state.selectedId;
    const isGroupDragging = state.dragIds.includes(node.id);
    const el = document.createElement('div');
    el.className = `timeline-node side-${node.side}${isSelected ? ' selected' : ''}${node.id === state.selectedId ? ' primary-selected' : ''}${state.dragId === node.id ? ' dragging' : ''}${isGroupDragging ? ' group-dragging' : ''}${node.includeInPreview === false ? ' excluded-preview' : ''}`;
    el.dataset.id = node.id;
    el.draggable = true;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute(
      'aria-label',
      `${startLabel}，${node.title || '未命名节点'}${isSelected ? '，已选中' : ''}${node.includeInPreview === false ? '，不参与动画预览' : ''}，拖拽可排序`,
    );

    el.innerHTML = `
      <button type="button" class="node-insert node-insert-before" aria-label="在此处添加节点" title="在此处添加节点">+</button>
      <div class="node-tick"></div>
      <div class="node-dot"></div>
      ${isSelected && state.selectedIds.size > 1 ? '<span class="node-multi-check" aria-hidden="true">✓</span>' : ''}
      <span class="node-generation-badge" hidden></span>
      ${node.includeInPreview === false ? '<span class="node-preview-state" title="不参与动画预览">仅记录</span>' : ''}
      <div class="node-card">
        <div class="node-time">${escapeHtml(startLabel)}</div>
        <div class="node-title">${escapeHtml(node.title || '未命名')}</div>
        ${node.script ? `<div class="node-script-preview">${escapeHtml(truncate(node.script))}</div>` : ''}
        ${node.imageUrl ? imgAsset(node.imageUrl, 'node-thumb') : ''}
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
      if (Date.now() - state.lastDragAt < 250) return;
      selectNode(node.id, { additive: e.shiftKey || e.ctrlKey || e.metaKey });
    });

    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectNode(node.id, { additive: e.shiftKey || e.ctrlKey || e.metaKey });
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
  resolveImagesIn(els.nodesLayer);
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

  const animation = nodeAnimation(node);
  if (animation) {
    els.genMode.value =
      animation.mode === 'chain32' || animation.mode === 'anchored-chain32'
        ? 'chain32'
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
    state.selectedIds.add(pending.node.id);
    state.selectedId = pending.node.id;
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
  state.selectedIds.add(pending.node.id);
  renderNodes();
  renderEditor();
}

async function loadTimeline() {
  state.timeline = await api('/api/timeline');
  if (!Array.isArray(state.timeline.captions)) state.timeline.captions = [];
  const validIds = new Set(state.timeline.nodes.map((node) => node.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => validIds.has(id)));
  if (state.selectedId && validIds.has(state.selectedId)) {
    state.selectedIds.add(state.selectedId);
  } else {
    state.selectedId = selectedNodeIdsInOrder().at(-1) || null;
  }
  syncLocalTiming();
  els.timelineTitle.value = state.timeline.title || '';
  renderNodes();
  renderEditor();
  if (!els.captionTrackPanel.hidden) renderCaptionTrack();
}

async function loadProviders() {
  state.providers = await api('/api/providers');
  renderProviderSelect();
}

function selectedNodeIdsInOrder() {
  return state.timeline.nodes
    .filter((node) => state.selectedIds.has(node.id))
    .map((node) => node.id);
}

function selectNode(id, { additive = false, scroll = true } = {}) {
  if (additive) {
    if (state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
      if (state.selectedId === id) {
        const remaining = selectedNodeIdsInOrder();
        state.selectedId = remaining[remaining.length - 1] || null;
      }
    } else {
      state.selectedIds.add(id);
      state.selectedId = id;
    }
  } else {
    state.selectedIds = new Set([id]);
    state.selectedId = id;
  }
  renderNodes();
  renderEditor();
  if (!scroll || !state.selectedId) return;
  requestAnimationFrame(() => {
    els.nodesLayer
      .querySelector(`[data-id="${state.selectedId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
}

async function saveTitle() {
  state.timeline.title = els.timelineTitle.value;
  await api('/api/timeline', {
    method: 'PUT',
    body: JSON.stringify({ title: state.timeline.title }),
  });
  scheduleAutoSync();
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
  };
  if (els.genMode.value === 'flipbook' && node.animation) {
    payload.animation = {
      ...node.animation,
      userPrompt: els.genPrompt.value.trim(),
      fps: normalizeFps(els.flipbookFps.value, node.animation.fps || 4),
    };
  } else if (els.genMode.value === 'chain32' && node.animation && isAnyChain32(node.animation)) {
    payload.animation = {
      ...node.animation,
      userPrompt: els.genPrompt.value.trim(),
      segmentPrompts: chain32PromptValues(),
      fps: normalizeFps(els.flipbookFps.value, node.animation.fps || 8),
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
  scheduleAutoSync();
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
    state.selectedIds.delete(node.id);
    const remainingSelection = selectedNodeIdsInOrder();
    state.selectedId = remainingSelection[remainingSelection.length - 1] || null;
    renderNodes();
    renderEditor();

    const timerId = setTimeout(() => {
      commitPendingDelete();
    }, UNDO_MS);

    state.pendingDelete = { node: nodeCopy, index, timerId };
    showUndoToast(label);
  }, 220);
}

function movingNodeIds(fromId) {
  const active = state.dragIds.length
    ? state.dragIds
    : state.selectedIds.has(fromId)
      ? selectedNodeIdsInOrder()
      : [fromId];
  return active.includes(fromId) ? active : [fromId];
}

async function reorderNodes(fromId, toId, position) {
  const previousNodes = [...state.timeline.nodes];
  const nodes = [...state.timeline.nodes];
  const moveIds = movingNodeIds(fromId);
  const moveSet = new Set(moveIds);
  if (moveSet.has(toId)) return;
  const moved = nodes.filter((node) => moveSet.has(node.id));
  const remaining = nodes.filter((node) => !moveSet.has(node.id));
  const targetIdx = remaining.findIndex((node) => node.id === toId);
  if (!moved.length || targetIdx < 0) return;
  const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
  remaining.splice(insertIdx, 0, ...moved);
  applyNodeSides(remaining);

  state.timeline.nodes = remaining;
  syncLocalTiming();
  renderNodes();
  renderEditor();

  try {
    state.timeline = await api('/api/nodes/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: remaining.map((node) => node.id) }),
    });
    syncLocalTiming();
    renderNodes();
    renderEditor();
    if (moved.length > 1) setGenStatus(`已批量移动 ${moved.length} 个节点`, 'success');
  } catch (err) {
    applyNodeSides(previousNodes);
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
  const moveIds = movingNodeIds(fromId);
  const moveSet = new Set(moveIds);
  const moved = nodes.filter((node) => moveSet.has(node.id));
  if (!moved.length) return;
  const removedBeforeTarget = nodes
    .slice(0, Math.max(0, targetIndex))
    .filter((node) => moveSet.has(node.id)).length;
  const remaining = nodes.filter((node) => !moveSet.has(node.id));
  const clamped = Math.max(
    0,
    Math.min(targetIndex - removedBeforeTarget, remaining.length),
  );
  remaining.splice(clamped, 0, ...moved);
  applyNodeSides(remaining);

  state.timeline.nodes = remaining;
  syncLocalTiming();
  renderNodes();
  renderEditor();

  try {
    state.timeline = await api('/api/nodes/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: remaining.map((node) => node.id) }),
    });
    syncLocalTiming();
    renderNodes();
    renderEditor();
    if (moved.length > 1) setGenStatus(`已批量移动 ${moved.length} 个节点`, 'success');
  } catch (err) {
    applyNodeSides(previousNodes);
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

  const res = await fetchWithLocal(`/api/nodes/${node.id}/upload`, {
    method: 'POST',
    body: form,
    _formData: form,
  });
  const updated = await res.json();
  const nodeData = updated.node || updated;

  const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) {
    state.timeline.nodes[idx] = nodeData;
  }
  renderImagePreview(nodeData.imageUrl);
  renderNodes();
  updateImageActions();
}

function buildAnchoredChainRequest(previousRequest = null) {
  const node = previousRequest
    ? state.timeline.nodes.find((item) => item.id === previousRequest.nodeId)
    : selectedNode();
  const [provider, model] = previousRequest
    ? [previousRequest.provider, previousRequest.model]
    : els.genProvider.value.split('::');
  const refs = previousRequest?.referenceUrls || [...getGenRefs()];
  const segmentPrompts = previousRequest?.segmentPrompts || chain32PromptValues();
  const userPrompt = previousRequest?.userPrompt ?? els.genPrompt.value.trim();
  const bindings = promptBindingsForMode('chain32');
  const existing =
    isAnchoredAnimation(node?.animation) &&
    (!previousRequest?.chainId || node.animation.chainId === previousRequest.chainId)
      ? node.animation
      : null;
  const restart =
    previousRequest?.restart ||
    (!previousRequest && anchoredPhase(existing) === 'complete');
  const chainId = restart
    ? `chain${Date.now().toString(36)}`
    : previousRequest?.chainId || existing?.chainId || `chain${Date.now().toString(36)}`;

  return {
    mode: 'anchored-chain32',
    nodeId: node.id,
    provider,
    model,
    prompt: userPrompt || 'anchored-chain',
    userPrompt,
    size: previousRequest?.size || els.genSize.value,
    referenceUrls: refs,
    fps: previousRequest?.fps || normalizeFps(els.flipbookFps.value, 8),
    templateId: previousRequest?.templateId ?? bindings.atlas?.id ?? state.flipbook.templateId,
    atlasTemplateId:
      previousRequest?.atlasTemplateId ?? bindings.atlas?.id ?? state.flipbook.templateId,
    keyframeTemplateId:
      previousRequest?.keyframeTemplateId ?? bindings.keyframe?.id ?? 'panchored-keyframe',
    segmentTemplateId:
      previousRequest?.segmentTemplateId ?? bindings.segment?.id ?? 'panchored-segment',
    templateContent:
      previousRequest?.templateContent ?? bindings.atlas?.content ?? state.flipbook.templateContent,
    segmentPrompts,
    chainId,
    phase: previousRequest?.phase || null,
    forceKeyframeIndexes: previousRequest?.forceKeyframeIndexes || null,
    forceSegmentIndexes: previousRequest?.forceSegmentIndexes || null,
    restart: Boolean(restart),
  };
}

async function generateAnchoredKeyframe(request, keyframeIndex, { force = false } = {}) {
  state.flipbook.keyframeStatus[keyframeIndex] = 'loading';
  renderChain32Keyframes();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  try {
    const node = state.timeline.nodes.find((n) => n.id === request.nodeId);
    const prompt = await composeAnchoredKeyframePrompt(
      request.userPrompt,
      keyframeIndex,
      request.segmentPrompts || [],
      state.promptLibrary,
    );
    const prepared = await prepareGenerateRequest({
      ...request,
      prompt,
      referenceUrls: request.referenceUrls || [],
    });
    const data = await api('/api/generate-animation-chain/keyframe', {
      method: 'POST',
      body: JSON.stringify({ ...prepared, keyframeIndex, force }),
      signal: controller.signal,
    });
    const applied = await applyKeyframeGeneration(node, request, data);
    state.flipbook.keyframeStatus[keyframeIndex] = 'ready';
    return applied;
  } catch (err) {
    state.flipbook.keyframeStatus[keyframeIndex] = 'error';
    throw err;
  } finally {
    clearTimeout(timeoutId);
    renderChain32Keyframes();
  }
}

async function generateAnchoredSegment(request, segmentIndex, { force = false } = {}) {
  state.flipbook.segmentStatus[segmentIndex] = 'loading';
  renderChain32Progress();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS * 2);
  const segmentUserPrompt = [request.userPrompt, request.segmentPrompts?.[segmentIndex]]
    .filter(Boolean)
    .join('\n');
  const segmentPrompt = fillFlipbookTemplate(
    request.templateContent || '',
    segmentUserPrompt,
    9,
  );
  try {
    const prepared = await prepareGenerateRequest({
      ...request,
      prompt: segmentPrompt,
      referenceUrls: request.referenceUrls || [],
    });
    const data = await api('/api/generate-animation-chain/segment', {
      method: 'POST',
      body: JSON.stringify({
        ...prepared,
        mode: 'anchored-chain32',
        segmentIndex,
        force,
        columns: 2,
        rows: 2,
      }),
      signal: controller.signal,
    });
    const node = state.timeline.nodes.find((n) => n.id === request.nodeId);
    const applied = await applySegmentGeneration(node, request, data);
    state.flipbook.segmentStatus[segmentIndex] = 'ready';
    return applied;
  } catch (err) {
    state.flipbook.segmentStatus[segmentIndex] = 'error';
    throw err;
  } finally {
    clearTimeout(timeoutId);
    renderChain32Progress();
  }
}

function applyAnchoredNode(nodeId, data) {
  const idx = state.timeline.nodes.findIndex((item) => item.id === nodeId);
  if (idx >= 0 && data?.node) state.timeline.nodes[idx] = data.node;
  renderNodes();
  updateImageActions();
  updateNodeActions();
  renderChain32Keyframes(data?.node);
  renderChain32Progress(data?.node);
  if (state.selectedId === nodeId) {
    renderFlipbookResult();
    if (data?.animation?.frameUrls?.length) {
      showFlipbookFrame(Math.max(0, data.animation.frameUrls.length - 1));
    } else if (data?.imageUrl) {
      renderImagePreview(data.imageUrl);
    }
  }
}

async function generateChain32Keyframes(node, baseRequest, indexes = [1, 2, 3]) {
  const request = { ...baseRequest, phase: 'keyframes' };
  const controller = new AbortController();
  const activeGeneration = startGenerationProgress(request, controller);
  clearGenerationTimer(node.id);
  activeGeneration.lastRequest = request;
  activeGeneration.progress = 5;
  activeGeneration.message = `并行生成关键帧 ${indexes.map((i) => `K${i}`).join(' / ')}…`;
  if (state.selectedId === node.id) {
    setGenStatus(activeGeneration.message, 'loading');
    renderGenerationState();
    renderChain32Keyframes(node);
  }

  try {
    const results = await Promise.allSettled(
      indexes.map((keyframeIndex) =>
        generateAnchoredKeyframe(request, keyframeIndex, {
          force: Boolean(baseRequest.forceKeyframeIndexes?.includes(keyframeIndex)),
        }).then((data) => {
          applyAnchoredNode(node.id, data);
          const done = indexes.filter((i) => state.flipbook.keyframeStatus[i] === 'ready').length;
          activeGeneration.progress = Math.min(39, 5 + (done / indexes.length) * 34);
          activeGeneration.message = `关键帧进度 ${done}/${indexes.length}`;
          updateTimelineGenerationBadge(node.id);
          if (state.selectedId === node.id) renderGenerationState();
          return data;
        }),
      ),
    );

    const latest = state.timeline.nodes.find((item) => item.id === node.id) || node;
    const failures = results
      .map((result, index) => ({ result, keyframeIndex: indexes[index] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length) {
      const message = failures
        .map(({ keyframeIndex, result }) => `K${keyframeIndex}: ${result.reason?.message || '失败'}`)
        .join('；');
      finishGeneration(node.id, 'error', message);
      if (state.selectedId === node.id) {
        setGenStatus(`${message}（可单独重生成失败的关键帧）`, 'error');
        renderChain32Keyframes(latest);
      }
      return;
    }

    const completedGeneration = finishGeneration(node.id, 'success', '中间关键帧已就绪，请确认');
    if (state.selectedId === node.id) {
      setGenStatus('K1 / K2 / K3 已生成，请确认后开始四段并行生成', 'success');
      renderChain32Keyframes(latest);
      updateFlipbookUi();
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
      if (state.selectedId === node.id) setGenStatus(err.message, 'error');
    }
  } finally {
    if (state.selectedId === node.id) renderGenerationState();
  }
}

async function generateChain32Segments(node, baseRequest, indexes = [0, 1, 2, 3]) {
  const request = { ...baseRequest, phase: 'segments' };
  const controller = new AbortController();
  const activeGeneration = startGenerationProgress(request, controller);
  clearGenerationTimer(node.id);
  activeGeneration.lastRequest = request;
  activeGeneration.progress = 45;
  activeGeneration.message = `并行生成分段 ${indexes.map((i) => i + 1).join('/')}…`;
  if (state.selectedId === node.id) {
    setGenStatus(activeGeneration.message, 'loading');
    renderGenerationState();
  }

  try {
    const confirmData = await confirmKeyframesLocally(node.id, request.chainId);
    applyAnchoredNode(node.id, confirmData);

    const results = await Promise.allSettled(
      indexes.map((segmentIndex) =>
        generateAnchoredSegment(request, segmentIndex, {
          force: Boolean(baseRequest.forceSegmentIndexes?.includes(segmentIndex)),
        }).then((data) => {
          applyAnchoredNode(node.id, data);
          const slots = anchoredSegmentSlots(data.animation);
          const done = slots.filter(Boolean).length;
          activeGeneration.progress = 45 + (done / 4) * 55;
          activeGeneration.message = `分段进度 ${done}/4`;
          updateTimelineGenerationBadge(node.id);
          if (state.selectedId === node.id) renderGenerationState();
          return data;
        }),
      ),
    );

    const latest = state.timeline.nodes.find((item) => item.id === node.id) || node;
    const failures = results
      .map((result, index) => ({ result, segmentIndex: indexes[index] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length) {
      const message = failures
        .map(
          ({ segmentIndex, result }) =>
            `第 ${segmentIndex + 1} 段: ${result.reason?.message || '失败'}`,
        )
        .join('；');
      finishGeneration(node.id, 'error', message);
      if (state.selectedId === node.id) {
        setGenStatus(`${message}（可继续重试缺失分段）`, 'error');
        renderChain32Progress(latest);
        updateFlipbookUi();
      }
      return;
    }

    const completedGeneration = finishGeneration(node.id, 'success', '32 帧锚点接力完成');
    if (state.selectedId === node.id) {
      setGenStatus('32 个独立画面已生成并应用到节点', 'success');
      renderFlipbookResult();
      showFlipbookFrame(0);
      updateFlipbookUi();
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
      if (state.selectedId === node.id) setGenStatus(err.message, 'error');
    }
  } finally {
    if (state.selectedId === node.id) renderGenerationState();
  }
}

async function regenerateAnchoredKeyframe(keyframeIndex) {
  const node = selectedNode();
  if (!node || generationFor(node.id)?.status === 'loading') return;
  if (getGenRefs().length < 2) {
    setGenStatus('需要 @1 首帧与 @2 尾帧参考图', 'error');
    return;
  }
  if (!els.genPrompt.value.trim()) {
    setGenStatus('请填写 32 帧动画的主提示词', 'error');
    return;
  }
  const request = buildAnchoredChainRequest({
    ...buildAnchoredChainRequest(),
    forceKeyframeIndexes: [keyframeIndex],
    phase: 'keyframes',
  });
  await generateChain32Keyframes(node, request, [keyframeIndex]);
}

async function confirmAnchoredKeyframesAndGenerate() {
  const node = selectedNode();
  if (!node || generationFor(node.id)?.status === 'loading') return;
  if (!isAnchoredAnimation(node.animation)) {
    setGenStatus('请先生成中间关键帧', 'error');
    return;
  }
  const slots = anchoredSegmentSlots(node.animation);
  const missing = [];
  for (let i = 0; i < 4; i += 1) {
    if (!slots[i]) missing.push(i);
  }
  const request = buildAnchoredChainRequest({
    chainId: node.animation.chainId,
    phase: 'segments',
    forceSegmentIndexes: missing.length && missing.length < 4 ? missing : null,
  });
  await generateChain32Segments(node, request, missing.length ? missing : [0, 1, 2, 3]);
}

async function generateChain32(node, baseRequest) {
  const refs = baseRequest.referenceUrls || getGenRefs();
  if (refs.length < 2) {
    setGenStatus('32 帧锚点接力需要至少两张参考图：@1 首帧 K0，@2 尾帧 K4', 'error');
    return;
  }
  if (!baseRequest.userPrompt?.trim()) {
    setGenStatus('请填写 32 帧动画的主提示词', 'error');
    return;
  }
  const bindings = promptBindingsForMode('chain32');
  if (!bindings.atlas) {
    setGenStatus('提词库缺少“翻页图集”模板，请打开提词库确认', 'error');
    return;
  }
  if (!bindings.keyframe) {
    setGenStatus('提词库缺少「32帧锚点·中间关键帧」，请打开提词库确认', 'error');
    return;
  }
  if (!bindings.segment) {
    setGenStatus('提词库缺少「32帧锚点·分段约束」，请打开提词库确认', 'error');
    return;
  }
  baseRequest.templateId ||= bindings.atlas.id;
  baseRequest.atlasTemplateId ||= bindings.atlas.id;
  baseRequest.keyframeTemplateId ||= bindings.keyframe.id;
  baseRequest.segmentTemplateId ||= bindings.segment.id;
  baseRequest.templateContent ||= bindings.atlas.content;
  if (!baseRequest.templateContent) {
    const fallback = bindings.atlas;
    if (fallback) {
      baseRequest.templateId = fallback.id;
      baseRequest.templateContent = fallback.content;
      if (!state.flipbook.templateContent) setFlipbookTemplate(fallback);
    }
  }

  const animation = node.animation;
  const sameChain =
    isAnchoredAnimation(animation) && animation.chainId === baseRequest.chainId;
  const phase = baseRequest.phase || (sameChain ? anchoredPhase(animation) : 'keyframes');

  if (phase === 'segments' || phase === 'awaiting-confirm') {
    const slots = sameChain ? anchoredSegmentSlots(animation) : [null, null, null, null];
    if (phase === 'awaiting-confirm' || sameChain?.keyframesConfirmed) {
      const missing = [];
      for (let i = 0; i < 4; i += 1) {
        if (!slots[i]) missing.push(i);
      }
      if (sameChain?.keyframesConfirmed && missing.length === 0 && !baseRequest.restart) {
        setGenStatus('32 帧已完成；点“重新生成关键帧”可开新链条', 'success');
        return;
      }
      return generateChain32Segments(
        node,
        baseRequest,
        missing.length ? missing : [0, 1, 2, 3],
      );
    }
  }

  if (phase === 'complete' || baseRequest.restart) {
    state.flipbook.keyframeStatus = {};
    state.flipbook.segmentStatus = {};
  }

  const existingUrls = sameChain ? animation.keyframeUrls || [] : [];
  const indexes =
    baseRequest.forceKeyframeIndexes?.length
      ? baseRequest.forceKeyframeIndexes
      : [1, 2, 3].filter((index) => !existingUrls[index] || baseRequest.restart);
  return generateChain32Keyframes(
    node,
    { ...baseRequest, restart: Boolean(baseRequest.restart) },
    indexes.length ? indexes : [1, 2, 3],
  );
}

async function generateImage(previousRequest = null) {
  const node = previousRequest
    ? state.timeline.nodes.find((item) => item.id === previousRequest.nodeId)
    : selectedNode();
  if (!node) return;
  if (generationFor(node.id)?.status === 'loading') return;

  const mode = previousRequest?.mode || els.genMode.value || 'single';
  if (mode === 'chain32' || mode === 'anchored-chain32') {
    const request =
      previousRequest?.mode === 'anchored-chain32' || previousRequest?.mode === 'chain32'
        ? {
            ...previousRequest,
            mode: 'anchored-chain32',
            segmentPrompts: previousRequest.segmentPrompts || chain32PromptValues(),
          }
        : buildAnchoredChainRequest();
    return generateChain32(node, request);
  }

  const [provider, model] = previousRequest
    ? [previousRequest.provider, previousRequest.model]
    : els.genProvider.value.split('::');

  let prompt = previousRequest?.prompt;
  let frameCount;
  let outputFrameCount;
  let columns;
  let rows;
  let fps;

  if (!previousRequest && mode === 'flipbook') {
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
    outputFrameCount = composed.outputFrameCount;
    columns = composed.columns;
    rows = composed.rows;
    fps = normalizeFps(els.flipbookFps.value, 4);
  } else if (previousRequest?.mode === 'flipbook') {
    frameCount = previousRequest.frameCount;
    outputFrameCount = previousRequest.outputFrameCount;
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
          outputFrameCount,
          columns,
          rows,
          fps,
          templateId: state.flipbook.templateId,
          templateContent: state.flipbook.templateContent,
        }
      : {}),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  if (state.selectedId === node.id) {
    setGenStatus(mode === 'flipbook' ? '动画生成中…' : '图片生成中…', 'loading');
  }
  const activeGeneration = startGenerationProgress(request, controller);

  try {
    const prepared = await prepareGenerateRequest(request);
    const endpoint = mode === 'flipbook' ? '/api/generate-animation' : '/api/generate';
    const data = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(prepared),
      signal: controller.signal,
    });

    let result;
    if (mode === 'flipbook') {
      result = await applyFlipbookGeneration(node.id, data, prompt);
    } else {
      result = await applySingleGeneration(node.id, data, prompt);
    }

    const idx = state.timeline.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) {
      state.timeline.nodes[idx] = result.node;
    }
    await autoSyncIfConnected();
    renderNodes();
    updateImageActions();
    updateNodeActions();
    const completedGeneration = finishGeneration(
      node.id,
      'success',
      mode === 'flipbook' ? '动画生成完成' : '生成完成',
    );
    if (state.selectedId === node.id) {
      if (mode === 'flipbook') {
        renderImagePreview(result.imageUrl || result.node.imageUrl);
        renderFlipbookResult();
        showFlipbookFrame(0);
        setGenStatus(`已裁切 ${result.animation?.frameCount || 0} 帧并应用到节点`, 'success');
      } else {
        renderImagePreview(result.imageUrl);
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
  renderPreviewCaption(previewStartForIndex(index) + localElapsed);
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
    if (els.previewImage.getAttribute('data-asset') !== imageUrl) {
      setImgSrc(els.previewImage, imageUrl);
    }
  } else {
    setImgSrc(els.previewImage, '');
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
  renderPreviewCaption(state.preview.elapsed);
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
  els.workbenchPreviewBtn.addEventListener('click', () => {
    if (state.flipbook.previewPlaying) stopFlipbookPreview();
    else playFlipbookPreview();
  });
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

  els.timelineScroll.addEventListener('click', (event) => {
    if (event.target.closest('.timeline-node, .timeline-empty-add')) return;
    state.selectedIds.clear();
    state.selectedId = null;
    renderNodes();
    renderEditor();
  });

  els.timelineScroll.addEventListener('dblclick', (e) => {
    if (e.target.closest('.timeline-node') || Date.now() - state.lastDragAt < 700) return;
    addNode();
  });

  els.closeEditor.addEventListener('click', () => {
    state.selectedId = null;
    state.selectedIds.clear();
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
    updateGenerateButton();
    renderRefChips();
    if (!els.promptLibraryPanel.hidden) renderPromptLibrary();
    if (els.genMode.value === 'single') stopFlipbookPreview();
  });
  els.flipbookFrames.addEventListener('change', updateFlipbookUi);
  els.chain32SegmentPrompts.forEach((input) => {
    input.addEventListener('input', updateFlipbookUi);
  });
  els.chain32ConfirmBtn?.addEventListener('click', () => {
    confirmAnchoredKeyframesAndGenerate();
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
    if (els.genMode.value === 'flipbook' || els.genMode.value === 'chain32') {
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

  els.captionTrackBtn.addEventListener('click', openCaptionTrackPanel);
  els.openCaptionTrackEditor.addEventListener('click', openCaptionTrackPanel);
  els.closeCaptionTrack.addEventListener('click', closeCaptionTrackPanel);
  els.captionTrackBackdrop.addEventListener('click', closeCaptionTrackPanel);
  els.captionPreviewImage.addEventListener('load', updateCaptionPreviewAspect);
  els.captionZoom.addEventListener('input', (event) => setCaptionZoom(event.target.value));
  els.captionZoomOut.addEventListener('click', () => setCaptionZoom(state.captionTrack.zoom - 1));
  els.captionZoomIn.addEventListener('click', () => setCaptionZoom(state.captionTrack.zoom + 1));
  els.captionZoomFit.addEventListener('click', () => {
    setCaptionZoom(1);
    els.captionTrackScroll.scrollLeft = 0;
  });
  els.captionTrackScroll.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setCaptionZoom(state.captionTrack.zoom + (event.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );
  els.captionPlayBtn.addEventListener('click', toggleCaptionPlayback);
  els.captionJumpSelectedBtn.addEventListener('click', () => {
    const caption = selectedCaption();
    if (!caption) {
      setGenStatus('请先选择一条字幕', 'error');
      return;
    }
    stopCaptionPlayback();
    setCaptionWorkbenchElapsed(caption.startMs);
  });
  els.captionTrackCanvas.addEventListener('click', (event) => {
    if (event.target.closest('.caption-block, .caption-shot')) return;
    const rect = els.captionTrackCanvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    stopCaptionPlayback();
    setCaptionWorkbenchElapsed(ratio * captionTrackDurationMs());
  });
  els.addCaptionBtn.addEventListener('click', () => {
    addCaption().catch((err) => setGenStatus(`添加字幕失败：${err.message}`, 'error'));
  });
  els.captionEditor.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCaptionEditor();
  });
  els.deleteCaptionBtn.addEventListener('click', deleteSelectedCaption);

  els.generatedAssetsBtn.addEventListener('click', openGeneratedAssets);
  els.closeGeneratedAssets.addEventListener('click', closeGeneratedAssetsPanel);
  els.generatedAssetsBackdrop.addEventListener('click', closeGeneratedAssetsPanel);
  els.generatedAssetsSearch.addEventListener('input', renderGeneratedAssets);
  els.generatedAssetsFilter.addEventListener('change', renderGeneratedAssets);

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
  els.saveFlipbookFrameBtn.addEventListener('click', requestSaveCurrentFrame);
  els.libraryNameCancel.addEventListener('click', hideLibraryNameModal);
  els.libraryNameConfirm.addEventListener('click', confirmAddToLibrary);
  els.appDialogCancel.addEventListener('click', () => closeAppDialog(null));
  els.appDialogConfirm.addEventListener('click', confirmAppDialog);
  els.appDialog.addEventListener('click', (event) => {
    if (event.target === els.appDialog) closeAppDialog(null);
  });

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
    if (!els.appDialog.hidden) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAppDialog(null);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        confirmAppDialog();
      }
      return;
    }
    if (!els.imageLightbox.hidden && e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
      return;
    }
    if (!els.captionTrackPanel.hidden && e.key === ' ') {
      if (!e.target.matches('input, textarea, select, [contenteditable="true"]')) {
        e.preventDefault();
        toggleCaptionPlayback();
      }
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
      else if (!els.captionTrackPanel.hidden) closeCaptionTrackPanel();
      else if (!els.generatedAssetsPanel.hidden) closeGeneratedAssetsPanel();
      else if (!els.promptLibraryPanel.hidden) closePromptLibraryPanel();
      else if (!els.libraryPanel.hidden) closeLibraryPanel();
      else if (state.selectedIds.size > 1 && state.selectedId) {
        state.selectedIds = new Set([state.selectedId]);
        renderNodes();
      }
    }
  });

  window.addEventListener('resize', updateTrackWidth);
  window.addEventListener('resize', () => {
    updateCaptionPreviewAspect();
    if (!els.captionTrackPanel.hidden) renderCaptionTrack();
  });
}

let projectMenuController = null;

async function reloadProjectData() {
  clearDisplayUrlCache();
  await Promise.all([loadTimeline(), loadProviders(), loadLibrary(), loadPromptLibrary()]);
  if (projectMenuController?.refreshList) await projectMenuController.refreshList();
  autoSyncIfConnected();
}

async function init() {
  const savedTheme = localStorage.getItem('script-flow-theme');
  const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(savedTheme || preferredTheme);
  setPanelWidth('timeline', localStorage.getItem('script-flow-timeline-width'), false);
  setPanelWidth('editor', localStorage.getItem('script-flow-editor-width'), false);
  bindEvents();
  updateFlipbookUi();
  await requestPersistentStorage();
  await initSettings();
  const projectHost = document.querySelector('#project-menu-host');
  const settingsHost = document.querySelector('#settings-host');
  if (projectHost) {
    projectMenuController = renderProjectMenu(projectHost, {
      prompt: (title, label, value) =>
        openAppDialog({ title, input: { label, placeholder: label, value } }),
      confirm: (title, message) =>
        openAppDialog({ title, message, confirmLabel: '开始导入' }),
      onSwitch: reloadProjectData,
      onFolder: () => autoSyncIfConnected(),
    });
  }
  if (settingsHost) mountSettingsPanel(settingsHost);
  window.addEventListener('script-flow-settings-saved', () => {
    loadProviders().catch(() => {});
  });
  setProjectChangeHandler(reloadProjectData);
  await initProjects();
  await reloadProjectData();
  resumeOpenJobs().catch(() => {});
}

init();
