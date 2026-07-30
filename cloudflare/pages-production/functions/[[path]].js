import worker from '../../worker.js';
import { withD1Session } from '../../lib/d1-session-wrapper.js';
import { handleMemberFastV3Safe } from '../../routes/member-fast-v3-safe.js';

export const onRequest = async (context) => {
  const incoming = new URL(context.request.url);
  const normalizedPath = `/${incoming.pathname.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  let routedRequest = context.request;
  if (normalizedPath !== incoming.pathname) {
    incoming.pathname = normalizedPath;
    routedRequest = new Request(incoming, context.request);
  }
  const pathname = normalizedPath;
  if (pathname === '/health' || pathname.startsWith('/api/') || pathname.startsWith('/__load/')) {
    return withD1Session(routedRequest, context.env, async (request, env) => {
      if (pathname === '/api/media/member-checkin-fast' && request.method === 'POST') {
        return handleMemberFastV3Safe(request, env);
      }
      return worker.fetch(request, env, context);
    });
  }
  return context.next();
};
