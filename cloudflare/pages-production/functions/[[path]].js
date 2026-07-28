import worker from '../../worker.js';

export const onRequest = (context) => {
  const incoming = new URL(context.request.url);
  const normalizedPath = `/${incoming.pathname.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  let routedRequest = context.request;
  if (normalizedPath !== incoming.pathname) {
    incoming.pathname = normalizedPath;
    routedRequest = new Request(incoming, context.request);
  }
  const pathname = normalizedPath;
  if (pathname === '/health' || pathname.startsWith('/api/') || pathname.startsWith('/__load/')) {
    return worker.fetch(routedRequest, context.env, context);
  }
  return context.next();
};
