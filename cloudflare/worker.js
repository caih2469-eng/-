import {
  cleanText,
  createToken,
  errorResponse,
  json,
  passwordMatches,
  readConfig,
  readJson,
  requireUser,
  sha256,
  shanghaiDate,
  shanghaiTime,
  TRACKS
} from './lib/runtime.js';
import { handleStudentRoutes } from './routes/student.js';
import { handlePlazaRoutes } from './routes/plaza.js';
import { handleAdminRoutes } from './routes/admin.js';
import { canAccessMaterialFile, handleMaterialRoutes } from './routes/materials.js';

const login = async (request, env) => {
  const body = await readJson(request, 16 * 1024);
  const studentId = cleanText(body.studentId, 40);
  const password = String(body.password || '').slice(0, 128);
  if (!studentId || !password) return json({ error: '请输入学号和密码' }, 400);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const identity = await sha256(`${ip}:${studentId}`);
  const attempt = await env.DB.prepare(
    'SELECT attempt_count AS attemptCount,window_started_at AS windowStartedAt,blocked_until AS blockedUntil FROM login_attempts WHERE identity_hash=?1'
  ).bind(identity).first();
  const now = Date.now();
  if (attempt?.blockedUntil && Date.parse(attempt.blockedUntil) > now) {
    return json({ error: '登录尝试过多，请稍后再试' }, 429);
  }
  const user = await env.DB.prepare(
    `SELECT id,student_id AS studentId,name,password_hash AS passwordHash,role,campus,
            track_id AS trackId,status,created_at AS createdAt
       FROM users WHERE student_id=?1 LIMIT 1`
  ).bind(studentId).first();
  if (!user || user.status !== 'active' || !(await passwordMatches(password, user.passwordHash))) {
    const inWindow = attempt && now - Date.parse(attempt.windowStartedAt) < 15 * 60 * 1000;
    const count = inWindow ? Number(attempt.attemptCount) + 1 : 1;
    const blockedUntil = count >= 10 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO login_attempts (identity_hash,attempt_count,window_started_at,blocked_until)
       VALUES (?1,?2,?3,?4) ON CONFLICT(identity_hash) DO UPDATE SET
        attempt_count=excluded.attempt_count,window_started_at=excluded.window_started_at,
        blocked_until=excluded.blocked_until`
    ).bind(identity, count, inWindow ? attempt.windowStartedAt : new Date().toISOString(), blockedUntil).run();
    return json({ error: '学号或密码不正确' }, 401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE identity_hash=?1').bind(identity).run();
  delete user.passwordHash;
  const token = await createToken(user, env.SESSION_SECRET);
  return json({
    token,
    user,
    config: await readConfig(env),
    tracks: TRACKS
  }, 200, {
    'set-cookie': `session_token=${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`
  });
};

const fileResponse = async (request, env, id) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;

  const checkin = await env.DB.prepare(
    `SELECT f.object_key AS objectKey,f.content_type AS contentType,c.user_id AS ownerId
       FROM checkin_files f JOIN checkins c ON c.id=f.checkin_id WHERE f.id=?1`
  ).bind(id).first();
  let file = checkin && (user.role === 'admin' || checkin.ownerId === user.id) ? checkin : null;

  if (!file) {
    const taskImage = await env.DB.prepare(
      `SELECT i.object_key AS objectKey,i.content_type AS contentType,s.owner_type AS ownerType,
              s.owner_id AS ownerId,s.is_public AS isPublic,p.status AS postStatus
         FROM task_submission_images i
         JOIN task_submissions s ON s.id=i.submission_id
         LEFT JOIN plaza_posts p ON p.submission_id=s.id
        WHERE i.id=?1`
    ).bind(id).first();
    if (taskImage) {
      const teamMember = taskImage.ownerType === 'team' ? await env.DB.prepare(
        'SELECT 1 FROM team_members WHERE team_id=?1 AND user_id=?2'
      ).bind(taskImage.ownerId, user.id).first() : null;
      if (user.role === 'admin' || taskImage.ownerId === user.id || teamMember
          || (taskImage.isPublic && taskImage.postStatus === 'visible')) file = taskImage;
    }
  }

  if (!file) {
    const memberImage = await env.DB.prepare(
      `SELECT object_key AS objectKey,content_type AS contentType,user_id AS ownerId,team_id AS teamId
         FROM member_checkins WHERE id=?1`
    ).bind(id).first();
    if (memberImage) {
      const member = await env.DB.prepare(
        'SELECT 1 FROM team_members WHERE team_id=?1 AND user_id=?2'
      ).bind(memberImage.teamId, user.id).first();
      if (user.role === 'admin' || memberImage.ownerId === user.id || member) file = memberImage;
    }
  }

  if (!file) return json({ error: '文件不存在或无权访问' }, 403);
  const object = await env.UPLOADS.get(file.objectKey);
  if (!object) return json({ error: '文件不存在' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || file.contentType || 'application/octet-stream',
      'content-length': String(object.size),
      etag: object.httpEtag,
      'cache-control': 'private, max-age=86400, immutable',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff'
    }
  });
};

const publicImageResponse = async (request, env, ctx, id) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/api/public-images/${encodeURIComponent(id)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const file = await env.DB.prepare(
    `SELECT COALESCE(v.object_key,i.object_key) AS objectKey,
            COALESCE(v.content_type,i.content_type) AS contentType
       FROM task_submission_images i
       JOIN task_submissions s ON s.id=i.submission_id
       JOIN plaza_posts p ON p.submission_id=s.id
       LEFT JOIN image_variants v ON v.source_type='task_submission_image'
        AND v.source_id=i.id AND v.variant='display'
      WHERE i.id=?1 AND s.is_public=1 AND p.status='visible'`
  ).bind(id).first();
  if (!file) return json({ error: '图片不存在' }, 404);
  const object = await env.UPLOADS.get(file.objectKey);
  if (!object) return json({ error: '图片文件不存在' }, 404);
  const response = new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || file.contentType || 'image/jpeg',
      'content-length': String(object.size),
      etag: object.httpEtag,
      'cache-control': 'public, max-age=604800, stale-while-revalidate=86400',
      'cdn-cache-control': 'public, max-age=2592000, stale-while-revalidate=86400',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff'
    }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};

const mediaResponse = async (request, env, ctx, id) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/media/${encodeURIComponent(id)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const file = await env.DB.prepare(
    `SELECT object_key AS objectKey,content_type AS contentType FROM checkin_files WHERE id=?1
     UNION ALL
     SELECT object_key AS objectKey,content_type AS contentType FROM task_submission_images WHERE id=?1
     UNION ALL
     SELECT object_key AS objectKey,content_type AS contentType FROM member_checkins WHERE id=?1
     LIMIT 1`
  ).bind(id).first();
  if (!file) return json({ error: '图片不存在' }, 404);
  const object = await env.UPLOADS.get(file.objectKey);
  if (!object) return json({ error: '图片文件不存在' }, 404);
  const response = new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || file.contentType || 'image/webp',
      'content-length': String(object.size),
      etag: object.httpEtag,
      'cache-control': 'public, max-age=31536000, immutable',
      'cdn-cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff'
    }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};

const materialFileResponse = async (request, env, id) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const file = await canAccessMaterialFile(env, id, auth.user);
  if (!file) return json({ error: '文件不存在或无权访问' }, 403);
  const object = await env.UPLOADS.get(file.objectKey);
  if (!object) return json({ error: '文件不存在' }, 404);
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || file.contentType,
      'content-length': String(object.size),
      'content-disposition': disposition,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return json({
          ok: true,
          environment: env.ENVIRONMENT || 'unknown',
          project: env.PROJECT_NAME || 'unknown',
          database: Boolean(env.DB),
          storage: Boolean(env.UPLOADS),
          loadTestsEnabled: false,
          api: 'business-v1'
        });
      }
      if (url.pathname === '/api/login' && request.method === 'POST') return await login(request, env);
      if (url.pathname === '/api/session' && request.method === 'POST') {
        const auth = await requireUser(request, env);
        if (auth.error) return auth.error;
        const token = await createToken(auth.user, env.SESSION_SECRET);
        return json({ ok: true }, 200, {
          'set-cookie': `session_token=${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`
        });
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, {
          'set-cookie': 'session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
        });
      }
      if (url.pathname === '/api/me' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        if (auth.error) return auth.error;
        return json({
          user: auth.user,
          config: await readConfig(env),
          tracks: TRACKS,
          date: shanghaiDate(),
          time: shanghaiTime()
        });
      }
        const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
        if (fileMatch && request.method === 'GET') return await fileResponse(request, env, decodeURIComponent(fileMatch[1]));
        const publicImageMatch = url.pathname.match(/^\/api\/public-images\/([^/]+)$/);
        if (publicImageMatch && (request.method === 'GET' || request.method === 'HEAD')) {
          return await publicImageResponse(request, env, ctx, decodeURIComponent(publicImageMatch[1]));
        }
        const mediaMatch = url.pathname.match(/^\/media\/([^/]+)$/);
        if (mediaMatch && (request.method === 'GET' || request.method === 'HEAD')) {
          return await mediaResponse(request, env, ctx, decodeURIComponent(mediaMatch[1]));
        }
      const materialFileMatch = url.pathname.match(/^\/api\/material-files\/([^/]+)$/);
      if (materialFileMatch && request.method === 'GET') {
        return await materialFileResponse(request, env, decodeURIComponent(materialFileMatch[1]));
      }

      const admin = await handleAdminRoutes(request, env, ctx, url);
      if (admin) return admin;
      const materials = await handleMaterialRoutes(request, env, ctx, url);
      if (materials) return materials;
      const plaza = await handlePlazaRoutes(request, env, ctx, url);
      if (plaza) return plaza;
      const student = await handleStudentRoutes(request, env, ctx, url);
      if (student) return student;
      return json({ error: '接口不存在' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
};
