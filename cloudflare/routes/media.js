import { AwsClient } from 'aws4fetch';
import { cleanText, json, nowIso, readJson, requireUser } from '../lib/runtime.js';
import { verifyPrivateMediaRequest } from '../lib/media-signing.js';

const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);
const MAX_FINAL_BYTES = 1_572_864;
const INTENT_TTL_SECONDS = 180;

const noLeak = (status = 404) => json({ error: '媒体不可访问' }, status, {
  'cache-control': 'no-store',
  'x-image-cache': 'MISS'
});

const signatureMatches = (bytes, type) => {
  if (!bytes?.length) return false;
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') {
    return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('') === '89504e470d0a1a0a';
  }
  return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
};

const rejectIntent = async (env, intent, reason) => {
  await env.UPLOADS.delete(intent.objectKey).catch(() => null);
  await env.DB.prepare(
    "UPDATE media_upload_intents SET status='rejected',updated_at=?1 WHERE id=?2 AND status='pending'"
  ).bind(nowIso(), intent.id).run();
  throw Object.assign(new Error(reason), { status: 415 });
};

const createUploadIntent = async (request, env) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request, 16 * 1024);
  const mimeType = cleanText(body.mimeType, 40).toLowerCase();
  const extension = ALLOWED_TYPES.get(mimeType);
  const expectedSize = Number(body.fileSize);
  const width = Number(body.width);
  const height = Number(body.height);
  const taskId = cleanText(body.taskId, 80) || null;
  const businessType = cleanText(body.businessType, 40);
  const variant = body.variant === 'thumb' ? 'thumb' : 'display';
  const storedBusinessType = variant === 'thumb' ? `${businessType}:thumb` : businessType;
  if (!extension || !['task', 'member-checkin', 'meal-checkin', 'material-image', 'admin-makeup'].includes(businessType)) {
    return json({ error: '不支持的图片类型或上传用途' }, 415);
  }
  if (!Number.isInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_FINAL_BYTES
      || !Number.isInteger(width) || width < 1 || width > (variant === 'thumb' ? 480 : 1280)
      || !Number.isInteger(height) || height < 1 || height > (variant === 'thumb' ? 480 : 1280)) {
    return json({ error: '压缩图片的大小或尺寸不符合要求' }, 400);
  }
  if (taskId) {
    const taskTable = businessType === 'material-image' ? 'material_tasks' : 'tasks';
    const task = await env.DB.prepare(`SELECT id,status FROM ${taskTable} WHERE id=?1`).bind(taskId).first();
    if (!task || task.status !== 'published') return json({ error: '任务不存在或不可提交' }, 404);
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    return json({ error: '测试环境R2直传尚未配置' }, 503);
  }
  const id = crypto.randomUUID();
  const objectKey = `media/${env.ENVIRONMENT || 'test'}/${auth.user.id}/${variant}/${id}.${extension}`;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO media_upload_intents
      (id,user_id,task_id,business_type,object_key,mime_type,expected_size,width,height,status,
       expires_at,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending',?10,?11,?11)`
  ).bind(id, auth.user.id, taskId, storedBusinessType, objectKey, mimeType,
    expectedSize, width, height, expiresAt, createdAt).run();
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto'
  });
  const target = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.R2_BUCKET_NAME)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  );
  target.searchParams.set('X-Amz-Expires', String(INTENT_TTL_SECONDS));
  const signed = await client.sign(target, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    aws: { signQuery: true }
  });
  return json({
    intentId: id,
    uploadUrl: signed.url,
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    expiresAt
  }, 201);
};

const confirmUpload = async (request, env, intentId) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request, 8 * 1024);
  const intent = await env.DB.prepare(
    `SELECT id,user_id AS userId,task_id AS taskId,business_type AS businessType,
            object_key AS objectKey,mime_type AS mimeType,expected_size AS expectedSize,
            width,height,status,expires_at AS expiresAt
       FROM media_upload_intents WHERE id=?1`
  ).bind(intentId).first();
  if (!intent || intent.userId !== auth.user.id) return noLeak(404);
  if (intent.status === 'confirmed') {
    const existing = await env.DB.prepare(
      'SELECT id,mime_type AS mimeType,file_size AS fileSize,width,height FROM media_objects WHERE id=?1'
    ).bind(intent.id).first();
    return existing ? json({ media: existing, imageUrl: null, repeated: true }) : json({ error: '确认状态异常' }, 409);
  }
  if (intent.status !== 'pending') return json({ error: '该上传已失效' }, 409);
  if (Date.parse(intent.expiresAt) < Date.now()) {
    await env.DB.prepare(
      "UPDATE media_upload_intents SET status='expired',updated_at=?1 WHERE id=?2 AND status='pending'"
    ).bind(nowIso(), intent.id).run();
    return json({ error: '上传地址已过期，请重新选择图片' }, 410);
  }
  if (intent.taskId) {
    const baseBusinessType = intent.businessType.replace(/:thumb$/, '');
    const taskTable = baseBusinessType === 'material-image' ? 'material_tasks' : 'tasks';
    const task = await env.DB.prepare(`SELECT status FROM ${taskTable} WHERE id=?1`).bind(intent.taskId).first();
    if (!task || task.status !== 'published') {
      await rejectIntent(env, intent, '任务已关闭，图片不能继续确认');
    }
  }
  const object = await env.UPLOADS.head(intent.objectKey);
  if (!object) return json({ error: 'R2尚未收到图片，请重新上传' }, 409);
  const actualType = object.httpMetadata?.contentType || '';
  if (object.size < 1 || object.size > MAX_FINAL_BYTES || object.size !== Number(intent.expectedSize)
      || actualType !== intent.mimeType || !ALLOWED_TYPES.has(actualType)) {
    return rejectIntent(env, intent, '上传图片的大小或类型与申请信息不一致');
  }
  const head = await env.UPLOADS.get(intent.objectKey, { range: { offset: 0, length: 16 } });
  const bytes = new Uint8Array(await new Response(head.body).arrayBuffer());
  if (!signatureMatches(bytes, actualType)) return rejectIntent(env, intent, '图片真实格式校验失败');
  const now = nowIso();
  const mediaId = intent.id;
  const isThumb = intent.businessType.endsWith(':thumb');
  const parentMediaId = isThumb ? cleanText(body.parentMediaId, 80) : null;
  if (isThumb) {
    const parent = parentMediaId ? await env.DB.prepare(
      `SELECT id FROM media_objects
        WHERE id=?1 AND owner_user_id=?2 AND COALESCE(task_id,'')=COALESCE(?3,'')
          AND business_type=?4 AND business_id IS NULL LIMIT 1`
    ).bind(parentMediaId, intent.userId, intent.taskId || null,
      intent.businessType.replace(/:thumb$/, '')).first() : null;
    if (!parent || Math.max(Number(intent.width), Number(intent.height)) > 480) {
      await env.UPLOADS.delete(intent.objectKey).catch(() => null);
      return json({ error: '缩略图与原图片不匹配' }, 403, { 'cache-control': 'no-store' });
    }
  }
  const statements = [
    env.DB.prepare(
      `INSERT INTO media_objects
        (id,owner_user_id,task_id,business_type,object_key,mime_type,file_size,width,height,etag,
          visibility,business_id,created_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'private',?11,?12,?12)`
    ).bind(mediaId, intent.userId, intent.taskId, intent.businessType, intent.objectKey,
      actualType, object.size, intent.width, intent.height, object.httpEtag || '', parentMediaId, now),
    env.DB.prepare(
      "UPDATE media_upload_intents SET status='confirmed',confirmed_at=?1,updated_at=?1 WHERE id=?2 AND status='pending'"
    ).bind(now, intent.id)
  ];
  const results = await env.DB.batch(statements);
  if (!results[1]?.meta?.changes) return json({ error: '上传已被其他请求确认' }, 409);
  return json({
    media: { id: mediaId, mimeType: actualType, fileSize: object.size, width: intent.width, height: intent.height }
  });
};

const mediaHeaders = (object, contentType, cacheControl) => ({
  'content-type': object.httpMetadata?.contentType || contentType || 'application/octet-stream',
  'content-length': String(object.size),
  etag: object.httpEtag,
  'content-disposition': 'inline',
  'cache-control': cacheControl,
  'content-security-policy': "default-src 'none'",
  'x-content-type-options': 'nosniff'
});

const privateMedia = async (request, env, url, mediaId) => {
  const signed = await verifyPrivateMediaRequest(env, mediaId, url.searchParams);
  if (!signed) return noLeak(403);
  const auth = await requireUser(request, env);
  if (auth.error) return noLeak(403);
  if (auth.user.id !== signed.scope
      || (signed.aud === 'admin' && auth.user.role !== 'admin')
      || (signed.aud === 'owner' && auth.user.role === 'admin')) return noLeak(403);
  const object = await env.UPLOADS.get(signed.objectKey);
  if (!object) return noLeak(404);
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers: { etag: object.httpEtag, 'cache-control': 'private, max-age=900' } });
  }
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: mediaHeaders(object, object.httpMetadata?.contentType, 'private, max-age=900')
  });
};

const publicMedia = async (request, env, ctx, mediaId) => {
  const file = await env.DB.prepare(
    `SELECT m.object_key AS objectKey,m.mime_type AS mimeType
       FROM media_objects m
       JOIN task_submission_images i ON i.id=m.id
       JOIN task_submissions s ON s.id=i.submission_id
       JOIN plaza_posts p ON p.submission_id=s.id
      WHERE m.id=?1 AND m.visibility='public' AND s.is_public=1 AND p.status='visible'`
  ).bind(mediaId).first();
  if (!file) return noLeak(404);
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/api/public-media/${encodeURIComponent(mediaId)}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(request.method === 'HEAD' ? null : cached.body, {
      status: cached.status,
      headers: new Headers(cached.headers)
    });
    response.headers.set('x-media-cache', 'HIT');
    return response;
  }
  const object = await env.UPLOADS.get(file.objectKey);
  if (!object) return noLeak(404);
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers: { etag: object.httpEtag, 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  const response = new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      ...mediaHeaders(object, file.mimeType, 'public, max-age=31536000, immutable'),
      'cdn-cache-control': 'public, max-age=31536000',
      'x-media-cache': 'MISS'
    }
  });
  if (request.method === 'GET') ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};

const legacyMedia = async (request, env, ctx, mediaId) => {
  const visible = await env.DB.prepare(
    `SELECT 1 FROM media_objects m
       JOIN task_submission_images i ON i.id=m.id
       JOIN task_submissions s ON s.id=i.submission_id
       JOIN plaza_posts p ON p.submission_id=s.id
      WHERE m.id=?1 AND m.visibility='public' AND s.is_public=1 AND p.status='visible'`
  ).bind(mediaId).first();
  return visible ? publicMedia(request, env, ctx, mediaId) : noLeak(404);
};

const cleanupOrphanMedia = async (request, env) => {
  const auth = await requireUser(request, env, true);
  if (auth.error) return auth.error;
  const body = await readJson(request, 8 * 1024);
  const hours = Math.min(168, Math.max(1, Number(body.olderThanHours || 24)));
  const limit = Math.min(100, Math.max(1, Number(body.limit || 50)));
  const before = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const prefix = `media/${env.ENVIRONMENT || 'test'}/`;
  const { results } = await env.DB.prepare(
    `SELECT i.id,i.object_key AS objectKey,i.status,m.id AS mediaId
       FROM media_upload_intents i
       LEFT JOIN media_objects m ON m.id=i.id AND m.business_id IS NULL
      WHERE i.object_key LIKE ?1
        AND i.updated_at<?2
        AND (i.status IN ('pending','expired','rejected')
          OR (i.status='confirmed' AND m.id IS NOT NULL))
      ORDER BY i.updated_at LIMIT ?3`
  ).bind(`${prefix}%`, before, limit).all();
  if (body.dryRun !== false) {
    return json({ dryRun: true, count: results.length, ids: results.map((item) => item.id) });
  }
  for (const item of results) await env.UPLOADS.delete(item.objectKey);
  const statements = [];
  for (const item of results) {
    if (item.mediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(item.mediaId));
    statements.push(env.DB.prepare(
      "UPDATE media_upload_intents SET status='deleted',updated_at=?1 WHERE id=?2"
    ).bind(nowIso(), item.id));
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ dryRun: false, deleted: results.length });
};

export const handleMediaRoutes = async (request, env, ctx, url) => {
  if (url.pathname === '/api/admin/media/cleanup' && request.method === 'POST') {
    return cleanupOrphanMedia(request, env);
  }
  if (url.pathname === '/api/media/upload-intents' && request.method === 'POST') {
    return createUploadIntent(request, env);
  }
  const confirm = url.pathname.match(/^\/api\/media\/upload-intents\/([^/]+)\/confirm$/);
  if (confirm && request.method === 'POST') return confirmUpload(request, env, decodeURIComponent(confirm[1]));
  const publicMatch = url.pathname.match(/^\/api\/public-media\/([^/]+)$/);
  if (publicMatch && ['GET', 'HEAD'].includes(request.method)) {
    return publicMedia(request, env, ctx, decodeURIComponent(publicMatch[1]));
  }
  const privateMatch = url.pathname.match(/^\/api\/private-media\/([^/]+)$/);
  if (privateMatch && ['GET', 'HEAD'].includes(request.method)) {
    return privateMedia(request, env, url, decodeURIComponent(privateMatch[1]));
  }
  const legacy = url.pathname.match(/^\/api\/media\/([^/]+)$/);
  if (legacy && ['GET', 'HEAD'].includes(request.method)) {
    return legacyMedia(request, env, ctx, decodeURIComponent(legacy[1]));
  }
  return null;
};
