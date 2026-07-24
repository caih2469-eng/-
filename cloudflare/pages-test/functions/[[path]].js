import worker from '../../worker.js';

export const onRequest = (context) => {
  const pathname = new URL(context.request.url).pathname;
  if (pathname === '/health' || pathname.startsWith('/api/') || pathname.startsWith('/__load/')) {
    return worker.fetch(context.request, context.env, context);
  }
  return context.next();
};
