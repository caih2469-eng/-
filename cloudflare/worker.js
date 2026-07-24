const encoder = new TextEncoder();

const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders
  }
});

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const sign = async (payload, secret) => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const createToken = async (user, secret) => {
  const payload = btoa(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60
  })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${payload}.${await sign(payload, secret)}`;
};

const authenticate = async (request, env) => {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature || signature !== await sign(payload, env.SESSION_SECRET)) return null;
  try {
    const decoded = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
    if (!decoded.sub || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
};

const requireUser = async (request, env) => {
  const session = await authenticate(request, env);
  if (!session) return { error: json({ error: '未登录或会话已过期' }, 401) };
  return { session };
};

const handleLogin = async (request, env) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }
  const studentId = String(body.studentId || '').trim().slice(0, 32);
  const password = String(body.password || '').slice(0, 128);
  if (!studentId || !password) return json({ error: '请输入学号和密码' }, 400);

  const user = await env.DB.prepare(
    `SELECT id, student_id AS studentId, name, password_sha256 AS passwordHash,
            role, campus, track_id AS trackId, status, created_at AS createdAt
       FROM users WHERE student_id = ?1 LIMIT 1`
  ).bind(studentId).first();
  if (!user || user.status !== 'active' || user.passwordHash !== await sha256(password)) {
    return json({ error: '学号或密码错误' }, 401);
  }
  delete user.passwordHash;
  return json({ token: await createToken(user, env.SESSION_SECRET), user });
};

const handleUpload = async (request, env, id) => {
  if (!env.UPLOADS) return json({ error: 'R2 尚未启用' }, 503);
  if (request.headers.get('x-load-key') !== env.LOAD_TEST_SECRET) {
    return json({ error: '禁止访问' }, 403);
  }
  const length = Number(request.headers.get('content-length') || 0);
  const contentType = request.headers.get('content-type') || '';
  if (!Number.isFinite(length) || length <= 0 || length > 5 * 1024 * 1024) {
    return json({ error: '文件必须小于或等于 5MB' }, 413);
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    return json({ error: '仅支持 JPG、PNG、WebP' }, 415);
  }
  const objectKey = `load-test/${id}.bin`;
  await env.UPLOADS.put(objectKey, request.body, {
    httpMetadata: { contentType },
    customMetadata: { loadTest: 'true' }
  });
  await env.DB.prepare(
    `INSERT INTO load_uploads (id, object_key, content_type, bytes, uploaded_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       object_key = excluded.object_key,
       content_type = excluded.content_type,
       bytes = excluded.bytes,
       uploaded_at = excluded.uploaded_at`
  ).bind(id, objectKey, contentType, length).run();
  return json({ id, objectKey, bytes: length }, 201);
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, storage: Boolean(env.UPLOADS) });
    if (url.pathname === '/api/login' && request.method === 'POST') return handleLogin(request, env);

    const uploadMatch = url.pathname.match(/^\/__load\/uploads\/([A-Za-z0-9_-]{1,80})$/);
    if (uploadMatch && request.method === 'PUT') return handleUpload(request, env, uploadMatch[1]);

    const readMatch = url.pathname.match(/^\/__load\/objects\/([A-Za-z0-9_-]{1,80})$/);
    if (readMatch && request.method === 'GET') {
      if (!env.UPLOADS || request.headers.get('x-load-key') !== env.LOAD_TEST_SECRET) {
        return json({ error: '禁止访问' }, 403);
      }
      const object = await env.UPLOADS.get(`load-test/${readMatch[1]}.bin`);
      if (!object) return json({ error: '文件不存在' }, 404);
      return new Response(object.body, {
        headers: {
          'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
          etag: object.httpEtag,
          'cache-control': 'private, max-age=60'
        }
      });
    }

    if (url.pathname === '/api/me' && request.method === 'GET') {
      const auth = await requireUser(request, env);
      if (auth.error) return auth.error;
      const user = await env.DB.prepare(
        `SELECT id, student_id AS studentId, name, role, campus,
                track_id AS trackId, status, created_at AS createdAt
           FROM users WHERE id = ?1 LIMIT 1`
      ).bind(auth.session.sub).first();
      return user ? json({ user }) : json({ error: '用户不存在' }, 404);
    }
    if (url.pathname === '/api/tasks' && request.method === 'GET') {
      const auth = await requireUser(request, env);
      if (auth.error) return auth.error;
      const { results } = await env.DB.prepare(
        `SELECT id, name, description, track_id AS trackId, status,
                starts_at AS startsAt, ends_at AS endsAt, image_limit AS imageLimit
           FROM tasks WHERE status = 'published' ORDER BY starts_at DESC LIMIT 50`
      ).all();
      return json({ tasks: results });
    }
    if (url.pathname === '/api/rankings' && request.method === 'GET') {
      const period = (url.searchParams.get('period') || 'load-test').slice(0, 32);
      const cache = caches.default;
      const cacheKey = new Request(`${url.origin}/api/rankings?period=${encodeURIComponent(period)}`);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      const { results } = await env.DB.prepare(
        `SELECT rank, team_id AS teamId, team_name AS teamName, likes, views, score,
                generated_at AS generatedAt
           FROM ranking_cache WHERE period = ?1 ORDER BY rank LIMIT 100`
      ).bind(period).all();
      const response = json({ rankings: results }, 200, {
        'cache-control': 'public, max-age=60',
        'cdn-cache-control': 'public, max-age=60'
      });
      if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }
    return json({ error: '接口不存在' }, 404);
  }
};
