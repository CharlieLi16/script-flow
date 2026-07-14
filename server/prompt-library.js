import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROMPTS_PATH = path.join(DATA_DIR, 'prompts.json');
const EMPTY_LIBRARY = { items: [] };

export const PROMPT_MODE_MAP = {
  single: {
    requiredRoles: [],
    selectableRoles: ['general'],
  },
  flipbook: {
    requiredRoles: ['flipbook'],
    selectableRoles: ['flipbook'],
  },
  chain32: {
    requiredRoles: ['flipbook', 'anchored-keyframe', 'anchored-segment'],
    selectableRoles: ['flipbook'],
  },
};

export const PROMPT_IDS = {
  flipbookDefault: 'pflipbook-default',
  anchoredKeyframe: 'panchored-keyframe',
  anchoredSegment: 'panchored-segment',
};

const ANCHORED_DEFAULTS = {
  [PROMPT_IDS.anchoredKeyframe]: {
    id: PROMPT_IDS.anchoredKeyframe,
    name: '32帧锚点·中间关键帧',
    role: 'anchored-keyframe',
    content:
      '生成一张静止关键帧图，它是连续动作中的中间姿态。\n\n@1 是准确起点（0%）。@2 是准确终点（100%）。\n本图只能表现两者之间的 {progress} 中间状态。\n\n动作背景：{userPrompt}\n阶段重点：{phaseHint}\n\n要求：\n1. 不要原样复制 @1 或 @2。\n2. 不要提前完成整个动作，不要出现更靠后的阶段。\n3. 保持角色身份、服装、场景、光线、镜头和画风与 @1、@2 一致。\n4. 只输出一张铺满画幅的单图，不要分镜表，不要额外文字说明。',
  },
  [PROMPT_IDS.anchoredSegment]: {
    id: PROMPT_IDS.anchoredSegment,
    name: '32帧锚点·分段约束',
    role: 'anchored-segment',
    content:
      '总体动作：{userPrompt}\n本段动作：{segmentPrompt}\n\n{startAlias} 是本批开始前的准确连续性锚点，只作为参考，不得重复画入四格。\n{endAnchorRule}\n\n本批严格生成 {frameCount} 个新画面，布局为 {columns} 列 × {rows} 行（从左到右、从上到下）。\n\n要求：\n1. 第 1 格必须发生在 {startAlias} 之后，并与其动作、构图和镜头连续，不得复制锚点。\n2. 四格严格遵守当前批次的阶段进度；非末批不得提前到达整段终点。\n3. 末批只有最后一格可以到达终点参考，程序会用精确尾锚点替换该格。\n4. 不得出现终点之后的动作，不得跳跃到后续阶段。\n5. 绝对不要画出任何可见分界：禁止白线、黑线、间距、边框、分栏或面板样式。\n6. 保持角色、服装、场景、光线、镜头和画风连续一致。\n7. 最终只输出完整分镜表图片，不要输出解释。',
  },
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function createPromptId() {
  return `prompt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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

async function ensureAnchoredDefaults(library) {
  library.modeMap = structuredClone(PROMPT_MODE_MAP);
  let changed = false;
  const now = new Date().toISOString();
  for (const defaults of Object.values(ANCHORED_DEFAULTS)) {
    if (library.items.some((item) => item.id === defaults.id)) continue;
    library.items.push({
      ...defaults,
      createdAt: now,
      updatedAt: now,
    });
    changed = true;
  }
  if (changed) await writePromptLibrary(library);
  return library;
}

export async function readPromptLibrary() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(PROMPTS_PATH, 'utf8');
    const library = JSON.parse(raw);
    const normalized = Array.isArray(library?.items) ? library : structuredClone(EMPTY_LIBRARY);
    return ensureAnchoredDefaults(normalized);
  } catch {
    await writePromptLibrary(EMPTY_LIBRARY);
    return ensureAnchoredDefaults(structuredClone(EMPTY_LIBRARY));
  }
}

export async function getPromptById(id) {
  const library = await readPromptLibrary();
  return library.items.find((item) => item.id === id) || null;
}

export async function getPromptByRole(role) {
  const library = await readPromptLibrary();
  return library.items.find((item) => item.role === role) || null;
}

export async function writePromptLibrary(library) {
  await ensureDataDir();
  await fs.writeFile(PROMPTS_PATH, JSON.stringify(library, null, 2), 'utf8');
  return library;
}
