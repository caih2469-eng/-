const BOOKMARK_HEADER = 'x-d1-bookmark';

const sessionForRequest = (request, env) => {
  if (!env.DB || typeof env.DB.withSession !== 'function') {
    return { env, session: null };
  }
  const incoming = String(request.headers.get(BOOKMARK_HEADER) || '').slice(0, 1024);
  const pathname = new URL(request.url).pathname;
  const readOnly = request.method === 'GET'
    || request.method === 'HEAD'
    || (request.method === 'POST' && pathname === '/api/session');
  const fallback = readOnly ? 'first-unconstrained' : 'first-primary';
  let session;
  try {
    session = env.DB.withSession(incoming || fallback);
  } catch {
    session = env.DB.withSession(fallback);
  }
  return { env: { ...env, DB: session }, session };
};

const bookmarkForSession = (session) => {
  try { return session?.getBookmark?.() || ''; } catch { return ''; }
};

const attachSessionHeaders = (response, session, duration) => {
  const headers = new Headers(response.headers);
  const bookmark = bookmarkForSession(session);
  if (bookmark) {
    headers.set(BOOKMARK_HEADER, bookmark);
    headers.set('access-control-expose-headers', [
      headers.get('access-control-expose-headers'),
      BOOKMARK_HEADER
    ].filter(Boolean).join(', '));
  }
  if (!headers.has('x-request-id')) {
    headers.set('x-request-id', crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  }
  const timing = headers.get('server-timing') || '';
  if (!/(^|,)\s*total\s*;/i.test(timing)) {
    headers.set('server-timing', [timing, `total;dur=${duration.toFixed(1)}`].filter(Boolean).join(', '));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export const withD1Session = async (request, env, handler) => {
  const startedAt = performance.now();
  const scoped = sessionForRequest(request, env);
  const response = await handler(request, scoped.env);
  return attachSessionHeaders(response, scoped.session, performance.now() - startedAt);
};
