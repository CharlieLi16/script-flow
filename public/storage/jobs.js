import { idbDelete, idbGet, idbGetByIndex, idbPut } from './idb.js';
import { getActiveProjectId } from './repository.js';

export async function rememberJob(job) {
  const projectId = getActiveProjectId();
  if (!projectId || !job?.id) return;
  await idbPut('jobs', {
    id: job.id,
    projectId,
    type: job.type || 'chain',
    status: job.status || 'queued',
    triggerRunId: job.triggerRunId || null,
    createdAt: job.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
}

export async function listRememberedJobs(projectId = getActiveProjectId()) {
  if (!projectId) return [];
  return idbGetByIndex('jobs', 'projectId', projectId);
}

export async function clearJob(id) {
  await idbDelete('jobs', id);
}

export async function pollJob(runId) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(runId)}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Job not found');
  await rememberJob(data);
  return data;
}

export async function resumeOpenJobs() {
  const jobs = await listRememberedJobs();
  const open = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const results = [];
  for (const job of open) {
    try {
      results.push(await pollJob(job.id));
    } catch {
      await clearJob(job.id);
    }
  }
  return results;
}
