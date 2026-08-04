import { errorResponse, json } from './lib/runtime.js';
import { handleStudentRoutes } from './routes/student.js';

const CHECKIN_USER_HEADER = 'x-jinshan-checkin-user';
const CHECKIN_SERVICE_HEADER = 'x-jinshan-internal-service';
const CHECKIN_SERVICE_VERSION = 'checkin-v1';
const CHECKIN_SERVICE_BUILD = '20260805-checkin1';

const isCheckinRoute = (pathname) => pathname === '/api/checkins'
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
