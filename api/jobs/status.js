import { jsonResponse, setCors } from '../../lib/auth.js';
import { getJob } from './animation-chain.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const runId =
    req.query?.runId ||
    req.params?.runId ||
    req.url?.split('/').pop()?.split('?')[0];
  const job = getJob(runId);
  if (!job) {
    return jsonResponse(res, 404, { error: 'Job not found' });
  }
  return jsonResponse(res, 200, job);
}
