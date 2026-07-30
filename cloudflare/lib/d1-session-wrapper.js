const BOOKMARK_HEADER = 'x-d1-bookmark';

const sessionForRequest = (request, env) => {
  if (!env.DB || typeof env.DB.withSession !== 'function') {
    return { env, session: null };
  }
  const incoming = String(request.headers.get(BOOKMARK_HEADER) || '').slice(0, 1024);
  const readOnly = request.method === 'GET' || request.method === 'HEAD';
  const fallback = readOnly ? 'first-unconstrained' : 'first-primary';
  let session;
  try {
    session = env.DB.withSession(incoming || fallback);
  } catch {
    session = env.DB.withSession(fallback);
  }
  return { env: { ...env, DB: session }, session };
};

const attachBookmark = (response, session) => {
  const bookmark = session?.getBookmark?.();
  if (!bookmark) return response;
  const headers = new Headers(response.headers);
  headers.set(BOOKMARK_HEADER, bookmark);
  headers.set('access-control-expose-headers', [
    headers.get('access-control-expose-headers'),
    BOOKMARK_HEADER
  ].filter(Boolean).join(', '));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export const withD1Session = async (request, env, handler) => {
  const scoped = sessionForRequest(request, env);
  const response = await handler(request, scoped.env);
  return attachBookmark(response, scoped.session);
};
