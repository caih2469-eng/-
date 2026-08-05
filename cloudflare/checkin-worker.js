import { errorResponse, json } from './lib/runtime.js';
import { createMediaSigningAlignmentProof } from './lib/media-signing.js';
import { handleStudentRoutes } from './routes/student.js';

const CHECKIN_USER_HEADER = 'x-jinshan-checkin-user';
const CHECKIN_SERVICE_HEADER = 'x-jinshan-internal-service';
const CHECKIN_PROOF_CHALLENGE_HEADER = 'x-jinshan-checkin-proof-challenge';
const CHECKIN_SERVICE_VERSION = 'checkin-v1';
const CHECKIN_SERVICE_BUILD = '20260805-checkin1';
const CHECKIN_HEALTH_PATH = '/api/checkin-service-health';

const isCheckinRoute = (pathname) => pathname === CHECKIN_HEALTH_PATH
  || pathname === '/api/checkins'
  || pathname === '/api/checkins/history'
  || /^\/api\/tasks\/[^/]+\/member-checkin$/.test(pathname);

const serviceResponse = (response) => {
  const headers = new Headers(response.headers);
  headers.set('x-jinshan-service', 'checkin');
  headers.set('x-jinshan-service-version', CHECKIN_SERVICE_VERSION);
  headers.set('x-jinshan-service-build', CHECKIN_SERVICE_BUILD);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const internalUser = (request) => {
  if (request.headers.get(CHECKIN_SERVICE_HEADER) !== CHECKIN_SERVICE_VERSION) return null;
  const encoded = request.headers.get(CHECKIN_USER_HEADER) || '';
  if (!encoded) return null;
  try {
    const user = JSON.parse(decodeURIComponent(encoded));
    if (!user?.id || !user.role || !user.status) return null;
    return {
      id: user.id,
      role: user.role,
      trackId: user.trackId || null,
      status: user.status
    };
  } catch {
    return null;
  }
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (!isCheckinRoute(url.pathname)) {
        return serviceResponse(json({ error: '接口不存在' }, 404));
      }
      if (request.headers.get(CHECKIN_SERVICE_HEADER) !== CHECKIN_SERVICE_VERSION) {
        return serviceResponse(json({ error: '禁止直接访问打卡内部服务' }, 403));
      }
      if (url.pathname === CHECKIN_HEALTH_PATH && request.method === 'GET') {
        const challenge = request.headers.get(CHECKIN_PROOF_CHALLENGE_HEADER) || '';
        const challengeValid = /^[0-9a-f-]{32,64}$/i.test(challenge);
        const resourcesReady = Boolean(env.DB && env.UPLOADS && env.MEDIA_SIGNING_SECRET);
        const ready = resourcesReady && challengeValid;
        const mediaSigningProof = ready
          ? await createMediaSigningAlignmentProof(env, challenge)
          : null;
        return serviceResponse(json({
          ok: ready,
          service: 'checkin',
          version: CHECKIN_SERVICE_VERSION,
          environment: env.ENVIRONMENT || 'unknown',
          database: Boolean(env.DB),
          storage: Boolean(env.UPLOADS),
          mediaSigning: Boolean(env.MEDIA_SIGNING_SECRET),
          mediaSigningProof
        }, ready ? 200 : 503));
      }
      if (!env.MEDIA_SIGNING_SECRET) {
        return serviceResponse(json({ error: '打卡服务尚未完成媒体签名配置' }, 503));
      }
      const user = internalUser(request);
      if (!user) {
        return serviceResponse(json({ error: '禁止直接访问打卡内部服务' }, 403));
      }
      const response = await handleStudentRoutes(request, env, ctx, url, user);
      return serviceResponse(response || json({ error: '接口不存在' }, 404));
    } catch (error) {
      return serviceResponse(errorResponse(error));
    }
  }
};
