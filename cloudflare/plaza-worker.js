import { errorResponse, json } from './lib/runtime.js';
import { handlePlazaRoutes } from './routes/plaza.js';

const USER_HEADER = 'x-jinshan-plaza-user';
const SERVICE_HEADER = 'x-jinshan-internal-service';

const parseInternalUser = (request) => {
  if (request.headers.get(SERVICE_HEADER) !== 'plaza-v1') return null;
  const encoded = request.headers.get(USER_HEADER);
  if (!encoded) return null;
  try {
    const user = JSON.parse(decodeURIComponent(encoded));
    if (!user?.id || !user?.role) return null;
    return {
      id: String(user.id),
      role: String(user.role),
      trackId: user.trackId ? String(user.trackId) : null,
      status: user.status ? String(user.status) : 'active'
    };
  } catch {
    return null;
  }
};

const withServiceHeader = (response) => {
  const headers = new Headers(response.headers);
  headers.set('x-jinshan-service', 'plaza');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const publicRanking = url.pathname === '/api/rankings';
      const user = publicRanking ? null : parseInternalUser(request);
      if (!publicRanking && !user) {
        return json({ error: '禁止直接访问活动广场内部服务' }, 403, {
          'x-jinshan-service': 'plaza'
        });
      }
      const response = await handlePlazaRoutes(request, env, ctx, url, user);
      return withServiceHeader(response || json({ error: '接口不存在' }, 404));
    } catch (error) {
      return withServiceHeader(errorResponse(error));
    }
  }
};
