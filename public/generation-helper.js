import * as repo from './storage/repository.js';
import { getAssetBlob, storeAssetFromBase64 } from './storage/assets.js';
import { fillPromptTemplate } from './storage/timeline-utils.js';
import { patchNode } from './storage/repository.js';
import { validateGenerationAccess } from './api-client.js';

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export async function buildReferenceData(referenceUrls = []) {
  const referenceData = [];
  for (const url of referenceUrls.filter(Boolean)) {
    if (url.startsWith('http')) {
      referenceData.push({ url });
      continue;
    }
    const blob = await getAssetBlob(repo.getActiveProjectId(), url);
    if (!blob) continue;
    referenceData.push({
      base64: await blobToBase64(blob),
      mime: blob.type || 'image/png',
    });
  }
  return referenceData;
}

export async function prepareGenerateRequest(request) {
  validateGenerationAccess(request.provider);
  const referenceData = await buildReferenceData(request.referenceUrls || []);
  return { ...request, referenceData };
}

export async function applySingleGeneration(nodeId, data, prompt) {
  const ext = data.ext || 'png';
  const logicalPath = `/images/${nodeId}-${Date.now()}.${ext}`;
  await storeAssetFromBase64(
    repo.getActiveProjectId(),
    logicalPath,
    data.imageBase64,
    data.mime || 'image/png',
  );
  const node = await patchNode(nodeId, {
    imageUrl: logicalPath,
    imagePrompt: prompt,
    animation: null,
  });
  return { imageUrl: logicalPath, node };
}

export async function applyFlipbookGeneration(nodeId, data, prompt) {
  const ext = data.ext || 'png';
  const sourcePath = data.sourcePath || `/images/${nodeId}-${Date.now()}.${ext}`;
  await storeAssetFromBase64(
    repo.getActiveProjectId(),
    sourcePath,
    data.imageBase64,
    data.mime || 'image/png',
  );

  for (const frame of data.frames || []) {
    await storeAssetFromBase64(
      repo.getActiveProjectId(),
      frame.logicalPath,
      frame.base64,
      frame.mime || 'image/png',
    );
  }

  const animation = data.animation;
  const node = await patchNode(nodeId, {
    imageUrl: data.imageUrl || animation?.frameUrls?.[0] || sourcePath,
    imagePrompt: prompt,
    animation,
  });
  await repo.upsertGeneratedAssetFromNode(node, {
    prompt,
    provider: data.provider,
    model: data.model,
    size: data.size,
  });
  return { imageUrl: node.imageUrl, animation, node };
}

function emptyKeyframeUrls(k0 = null, k4 = null) {
  return [k0 || null, null, null, null, k4 || null];
}

function midKeyframesReady(keyframeUrls) {
  return Boolean(keyframeUrls?.[1] && keyframeUrls?.[2] && keyframeUrls?.[3]);
}

function allKeyframesReady(keyframeUrls) {
  return Boolean(
    keyframeUrls?.[0] && keyframeUrls?.[1] && keyframeUrls?.[2] &&
    keyframeUrls?.[3] && keyframeUrls?.[4],
  );
}

function anchoredPhase(animation) {
  if (animation?.mode !== 'anchored-chain32') return null;
  const slots = animation.segments || [null, null, null, null];
  if (slots.every(Boolean) && animation.frameUrls?.length >= 32) return 'complete';
  if (animation.keyframesConfirmed) return 'segments';
  if (midKeyframesReady(animation.keyframeUrls)) return 'awaiting-confirm';
  return 'keyframes';
}

export async function composeAnchoredKeyframePrompt(userPrompt, keyframeIndex, segmentPrompts, promptLibrary) {
  const progress = { 1: '25%', 2: '50%', 3: '75%' }[keyframeIndex] || '50%';
  const phaseHint = segmentPrompts[keyframeIndex - 1] || '保持动作连续，不要越界';
  const item = promptLibrary.items.find((p) => p.role === 'anchored-keyframe' || p.id === 'panchored-keyframe');
  if (!item?.content) throw new Error('提词库缺少「32帧锚点·中间关键帧」模板');
  return fillPromptTemplate(item.content, {
    progress,
    userPrompt: userPrompt || 'continuous action',
    phaseHint,
  });
}

export async function applyKeyframeGeneration(node, request, data) {
  const logicalPath = data.logicalPath || `/images/kf-${request.chainId}-k${data.keyframeIndex}-${Date.now()}.png`;
  await storeAssetFromBase64(
    repo.getActiveProjectId(),
    logicalPath,
    data.imageBase64,
    data.mime || 'image/png',
  );

  const refs = request.referenceUrls || [];
  const k0 = refs[0];
  const k4 = refs[1];
  const previous = node.animation?.chainId === request.chainId ? node.animation : null;
  const keyframeUrls = emptyKeyframeUrls(k0, k4);
  if (previous?.keyframeUrls) {
    for (let i = 1; i <= 3; i += 1) keyframeUrls[i] = previous.keyframeUrls[i] || null;
  }
  keyframeUrls[0] = k0;
  keyframeUrls[4] = k4;
  keyframeUrls[data.keyframeIndex] = logicalPath;

  const animation = {
    mode: 'anchored-chain32',
    chainId: request.chainId,
    phase: midKeyframesReady(keyframeUrls) ? 'awaiting-confirm' : 'keyframes',
    keyframesConfirmed: false,
    keyframesConfirmedAt: null,
    keyframeUrls,
    sourceUrl: previous?.sourceUrl || logicalPath,
    frameUrls: [],
    frameCount: 0,
    columns: 3,
    rows: 3,
    fps: request.fps || 8,
    templateId: request.atlasTemplateId || request.templateId || null,
    templateContent: request.templateContent || '',
    userPrompt: request.userPrompt || '',
    segmentPrompts: request.segmentPrompts || [],
    totalFrames: 32,
    segmentSize: 8,
    segments: [null, null, null, null],
  };
  animation.phase = anchoredPhase(animation);

  const updated = await patchNode(node.id, {
    imageUrl: logicalPath,
    imagePrompt: request.userPrompt,
    animation,
  });
  return { node: updated, animation, imageUrl: logicalPath, keyframeIndex: data.keyframeIndex };
}

export async function confirmKeyframesLocally(nodeId, chainId) {
  const timeline = await repo.getTimeline();
  const node = timeline.nodes.find((n) => n.id === nodeId);
  if (!node?.animation || node.animation.chainId !== chainId) {
    throw new Error('未找到对应的锚点接力动画');
  }
  if (!allKeyframesReady(node.animation.keyframeUrls)) {
    throw new Error('请先生成全部中间关键帧 K1、K2、K3');
  }
  const animation = {
    ...node.animation,
    keyframesConfirmed: true,
    keyframesConfirmedAt: new Date().toISOString(),
    phase: 'segments',
  };
  const updated = await patchNode(nodeId, { animation });
  return { node: updated, animation, phase: 'segments' };
}

export async function applySegmentGeneration(node, request, data) {
  for (const frame of data.frames || []) {
    await storeAssetFromBase64(
      repo.getActiveProjectId(),
      frame.logicalPath,
      frame.base64,
      frame.mime || 'image/png',
    );
  }
  if (data.imageBase64 && data.sourcePath) {
    await storeAssetFromBase64(
      repo.getActiveProjectId(),
      data.sourcePath,
      data.imageBase64,
      data.mime || 'image/png',
    );
  }

  const chain = node.animation;
  const slots = [...(chain.segments || [null, null, null, null])];
  const segmentIndex = data.segmentIndex;
  const frameUrls = data.frameUrls || (data.frames || []).map((f) => f.logicalPath);
  const segment = {
    index: segmentIndex,
    sourceUrl: data.sourcePath,
    frameUrls,
    startAnchorUrl: chain.keyframeUrls?.[segmentIndex],
    endAnchorUrl: chain.keyframeUrls?.[segmentIndex + 1],
    createdAt: new Date().toISOString(),
  };
  slots[segmentIndex] = segment;
  const mergedFrames = slots.filter(Boolean).flatMap((s) => s.frameUrls || []);
  const complete = slots.every(Boolean);
  const animation = {
    ...chain,
    segments: slots,
    frameUrls: mergedFrames,
    frameCount: mergedFrames.length,
    phase: complete ? 'complete' : 'segments',
    sourceUrl: chain.sourceUrl || data.sourcePath,
  };
  const updated = await patchNode(node.id, {
    imageUrl: mergedFrames[0] || node.imageUrl,
    animation,
  });
  return { node: updated, animation, segmentIndex };
}
