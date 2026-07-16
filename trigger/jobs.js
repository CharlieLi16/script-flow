import { schedules, task } from '@trigger.dev/sdk/v3';
import { list, del } from '@vercel/blob';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Team-key long jobs: payload must NEVER include personal BYOK keys.
 * Personal long jobs stay client-orchestrated in the browser.
 */
export const flipbookGenerateTask = task({
  id: 'flipbook-generate',
  maxDuration: 600,
  run: async (payload) => {
    // Enqueued by api/jobs/animation-chain when Trigger is configured.
    // Worker implementations call lib/providers with server env keys only.
    return {
      status: 'accepted',
      type: 'flipbook',
      nodeId: payload?.nodeId || null,
      receivedAt: new Date().toISOString(),
    };
  },
});

export const chainSegmentTask = task({
  id: 'chain-segment',
  maxDuration: 600,
  run: async (payload) => {
    return {
      status: 'accepted',
      type: 'chain-segment',
      nodeId: payload?.nodeId || null,
      segmentIndex: payload?.segmentIndex ?? null,
      receivedAt: new Date().toISOString(),
    };
  },
});

export const cleanupTempBlobsTask = schedules.task({
  id: 'cleanup-temp-blobs',
  cron: '0 */6 * * *',
  run: async () => {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return { skipped: true, reason: 'BLOB_READ_WRITE_TOKEN missing' };
    }

    const cutoff = Date.now() - SEVEN_DAYS_MS;
    let cursor;
    let deleted = 0;
    do {
      const page = await list({ prefix: 'tmp/', cursor, token });
      for (const blob of page.blobs || []) {
        const uploaded = blob.uploadedAt ? new Date(blob.uploadedAt).getTime() : 0;
        if (uploaded && uploaded < cutoff) {
          await del(blob.url, { token });
          deleted += 1;
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return { deleted, at: new Date().toISOString() };
  },
});
