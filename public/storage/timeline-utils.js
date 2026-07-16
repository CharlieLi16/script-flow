export function normalizeDurationMs(value, fallback = 2000) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return fallback;
  return Math.min(600000, Math.max(500, Math.round(duration)));
}

export function formatTimeLabel(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function assignSides(nodes) {
  let cursor = 0;
  return nodes.map((node, index) => {
    const durationMs = normalizeDurationMs(node.durationMs);
    const timeLabel = formatTimeLabel(cursor);
    cursor += durationMs;
    return {
      ...node,
      durationMs,
      timeLabel,
      side: index % 2 === 0 ? 'up' : 'down',
    };
  });
}

export function createNodeId() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createCaptionId() {
  return `caption${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createLibraryId() {
  return `ref${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createPromptId() {
  return `prompt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createGeneratedAssetId() {
  return `asset${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createProjectId() {
  return `proj${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeCaption(input = {}, current = null) {
  const text = String(input.text ?? current?.text ?? '').trim();
  const startMs = Number(input.startMs ?? current?.startMs ?? 0);
  const endMs = Number(input.endMs ?? current?.endMs ?? startMs + 2000);
  return {
    text,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    anchorNodeId:
      input.anchorNodeId === undefined
        ? current?.anchorNodeId || null
        : input.anchorNodeId
          ? String(input.anchorNodeId)
          : null,
  };
}

export function migrateLegacyCaptions(timeline) {
  if (Array.isArray(timeline.captions)) return false;
  timeline.captions = [];
  return true;
}

export function normalizeAnimationPatch(current, patch) {
  if (!patch || typeof patch !== 'object') return current || null;
  return { ...(current || {}), ...patch };
}

export function nodeImageAssetUrls(node) {
  const urls = new Set();
  const add = (url) => {
    if (url?.startsWith('/images/')) urls.add(url);
  };
  add(node?.imageUrl);
  const animation = node?.animation;
  add(animation?.sourceUrl);
  for (const url of animation?.sourceUrls || []) add(url);
  add(animation?.keyframeSourceUrl);
  for (const url of animation?.frameUrls || []) add(url);
  for (const url of animation?.keyframeUrls || []) add(url);
  for (const batch of animation?.batches || []) {
    add(batch?.sourceUrl);
    add(batch?.anchorUrl);
    for (const url of batch?.frameUrls || []) add(url);
  }
  for (const segment of animation?.segments || []) {
    if (!segment) continue;
    add(segment?.sourceUrl);
    for (const url of segment?.sourceUrls || []) add(url);
    add(segment?.anchorUrl);
    add(segment?.startAnchorUrl);
    add(segment?.endAnchorUrl);
    for (const url of segment?.frameUrls || []) add(url);
    for (const batch of segment?.batches || []) {
      add(batch?.sourceUrl);
      add(batch?.anchorUrl);
      for (const url of batch?.frameUrls || []) add(url);
    }
  }
  return [...urls];
}

export function timelineReferencedImageUrls(timeline) {
  const urls = new Set();
  for (const node of timeline?.nodes || []) {
    for (const url of nodeImageAssetUrls(node)) urls.add(url);
    for (const url of node?.referenceUrls || []) {
      if (url?.startsWith('/images/') || url?.startsWith('/refs/')) urls.add(url);
    }
  }
  return [...urls];
}

export const PROMPT_MODE_MAP = {
  single: { requiredRoles: [], selectableRoles: ['general'] },
  flipbook: { requiredRoles: ['flipbook'], selectableRoles: ['flipbook'] },
  chain32: {
    requiredRoles: ['flipbook', 'anchored-keyframe', 'anchored-segment'],
    selectableRoles: ['flipbook'],
  },
};

export const ANCHORED_DEFAULTS = {
  'panchored-keyframe': {
    id: 'panchored-keyframe',
    name: '32帧锚点·中间关键帧',
    role: 'anchored-keyframe',
    content:
      '生成一张静止关键帧图，它是连续动作中的中间姿态。\n\n@1 是准确起点（0%）。@2 是准确终点（100%）。\n本图只能表现两者之间的 {progress} 中间状态。\n\n动作背景：{userPrompt}\n阶段重点：{phaseHint}\n\n要求：\n1. 不要原样复制 @1 或 @2。\n2. 不要提前完成整个动作，不要出现更靠后的阶段。\n3. 保持角色身份、服装、场景、光线、镜头和画风与 @1、@2 一致。\n4. 只输出一张铺满画幅的单图，不要分镜表，不要额外文字说明。',
  },
  'panchored-segment': {
    id: 'panchored-segment',
    name: '32帧锚点·分段约束',
    role: 'anchored-segment',
    content:
      '总体动作：{userPrompt}\n本段动作：{segmentPrompt}\n\n{startAlias} 是本批开始前的准确连续性锚点，只作为参考，不得重复画入四格。\n{endAnchorRule}\n\n本批严格生成 {frameCount} 个新画面，布局为 {columns} 列 × {rows} 行（从左到右、从上到下）。\n\n要求：\n1. 第 1 格必须发生在 {startAlias} 之后，并与其动作、构图和镜头连续，不得复制锚点。\n2. 四格严格遵守当前批次的阶段进度；非末批不得提前到达整段终点。\n3. 末批只有最后一格可以到达终点参考，程序会用精确尾锚点替换该格。\n4. 不得出现终点之后的动作，不得跳跃到后续阶段。\n5. 绝对不要画出任何可见分界：禁止白线、黑线、间距、边框、分栏或面板样式。\n6. 保持角色、服装、场景、光线、镜头和画风连续一致。\n7. 最终只输出完整分镜表图片，不要输出解释。',
  },
};

export function ensureAnchoredDefaults(library) {
  library.modeMap = structuredClone(PROMPT_MODE_MAP);
  const now = new Date().toISOString();
  for (const defaults of Object.values(ANCHORED_DEFAULTS)) {
    if (library.items.some((item) => item.id === defaults.id)) continue;
    library.items.push({ ...defaults, createdAt: now, updatedAt: now });
  }
  return library;
}

export function fillPromptTemplate(content, vars = {}) {
  let result = String(content || '');
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value == null ? '' : String(value));
  }
  return result
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
