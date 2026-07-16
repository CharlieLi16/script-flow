import { randomUUID } from 'crypto';
import { jsonResponse, readJsonBody, requireGenerationAuth, setCors } from '../../lib/auth.js';

const jobStore = globalThis.__sfJobs || (globalThis.__sfJobs = new Map());

async function tryEnqueueTrigger(body, runId) {
  if (!process.env.TRIGGER_SECRET_KEY) return null;
  try {
    const { tasks } = await import('@trigger.dev/sdk/v3');
    const taskId = body.type === 'flipbook' ? 'flipbook-generate' : 'chain-segment';
    const handle = await tasks.trigger(taskId, {
      runId,
      nodeId: body.nodeId,
      segmentIndex: body.segmentIndex,
      // Team keys only — never forward personal BYOK into the queue.
      teamOnly: true,
    });
    return handle;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }
  try {
    const body = await readJsonBody(req);
    const { provider, type } = body;
    const auth = requireGenerationAuth(req, provider || 'openai');
    if (auth.keys.source !== 'team') {
      return jsonResponse(res, 400, {
        error: '后台长任务仅支持团队 Key；个人 Key 请在浏览器内分段生成',
      });
    }

    const runId = randomUUID();
    const job = {
      id: runId,
      status: 'queued',
      type: type || 'chain',
      createdAt: Date.now(),
      progress: 0,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    jobStore.set(runId, job);

    const handle = await tryEnqueueTrigger(body, runId);
    if (handle?.id) {
      job.status = 'running';
      job.triggerRunId = handle.id;
      jobStore.set(runId, job);
    }

    return jsonResponse(res, 202, { runId, status: job.status, triggerRunId: job.triggerRunId || null });
  } catch (err) {
    return jsonResponse(res, err.status || 500, { error: err.message || 'Failed to enqueue job' });
  }
}

export function getJob(runId) {
  const job = jobStore.get(runId);
  if (!job) return null;
  if (job.expiresAt && Date.now() > job.expiresAt) {
    jobStore.delete(runId);
    return null;
  }
  return job;
}

export function updateJob(runId, patch) {
  const job = jobStore.get(runId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  jobStore.set(runId, job);
  return job;
}
