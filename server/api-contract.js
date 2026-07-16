/**
 * Mounts the Vercel Functions API contract on Express so `npm start` works
 * without `vercel dev`. Handlers live in api/*.js and share lib/*.
 */
import unlockHandler from '../api/auth/unlock.js';
import statusHandler from '../api/auth/status.js';
import providersHandler from '../api/providers.js';
import generateHandler from '../api/generate.js';
import generateAnimationHandler from '../api/generate-animation.js';
import keyframeHandler from '../api/generate-animation-chain/keyframe.js';
import segmentHandler from '../api/generate-animation-chain/segment.js';
import seedLibraryHandler from '../api/seed/library.js';
import legacySnapshotHandler from '../api/legacy/snapshot.js';
import animationChainJobHandler from '../api/jobs/animation-chain.js';
import jobStatusHandler from '../api/jobs/status.js';

/**
 * Express already parsed JSON into req.body; Vercel handlers call readJsonBody
 * which reads the request stream. Re-expose the body as an async iterable.
 */
function wrapVercelHandler(handler) {
  return async (req, res, next) => {
    try {
      const bodyBuf = Buffer.from(JSON.stringify(req.body ?? {}));
      const wrappedReq = new Proxy(req, {
        get(target, prop, receiver) {
          if (prop === Symbol.asyncIterator) {
            return async function* () {
              yield bodyBuf;
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await handler(wrappedReq, res);
    } catch (err) {
      next(err);
    }
  };
}

export function mountApiContract(app) {
  app.post('/api/auth/unlock', wrapVercelHandler(unlockHandler));
  app.get('/api/auth/status', wrapVercelHandler(statusHandler));

  app.get('/api/providers', wrapVercelHandler(providersHandler));

  app.post('/api/generate', wrapVercelHandler(generateHandler));
  app.post('/api/generate-animation', wrapVercelHandler(generateAnimationHandler));
  app.post(
    '/api/generate-animation-chain/keyframe',
    wrapVercelHandler(keyframeHandler),
  );
  app.post(
    '/api/generate-animation-chain/segment',
    wrapVercelHandler(segmentHandler),
  );

  app.get('/api/seed/library', wrapVercelHandler(seedLibraryHandler));
  app.get('/api/legacy/snapshot', wrapVercelHandler(legacySnapshotHandler));

  app.post('/api/jobs/animation-chain', wrapVercelHandler(animationChainJobHandler));
  app.get('/api/jobs/:runId', async (req, res, next) => {
    try {
      req.query = { ...(req.query || {}), runId: req.params.runId };
      await wrapVercelHandler(jobStatusHandler)(req, res, next);
    } catch (err) {
      next(err);
    }
  });
}
