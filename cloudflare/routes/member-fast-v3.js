import {
  cleanText,
  hasMakeupPermission,
  json,
  nowIso,
  requireUser,
  shanghaiDate
} from '../lib/runtime.js';
import { taskWindowOpen } from '../services/student-dashboard.js';

const MAX_BYTES = 307_200;
const MAX_EDGE = 960;
const INTENT_TTL_SECONDS = 180;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const signatureMatches = (bytes, type) => {
  if (!bytes?.length) return false;
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
};

const sha256Bytes = async (buffer) => {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const mediaPayload = (media) => ({
  id: media.id,
  mimeType: media.mimeType,
  fileSize: Number(media.fileSize),
  width: Number(media.width),
  height: Number(media.height)
});

const readTaskAndTeam = async (env, taskId, userId) => {
  const [taskPage, teamPage] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id,track_id AS trackId,submission_type AS submissionType,
              starts_at AS startsAt,ends_at AS endsAt,schedule_json AS scheduleJson,status
         FROM tasks WHERE id=?1 LIMIT 1`
    ).bind(taskId),
    env.DB.prepare(
      `SELECT t.id,t.name,t.invite_code AS inviteCode,t.member_limit AS memberLimit,
              t.captain_user_id AS captainId,t.created_at AS createdAt
         FROM teams t JOIN team_members tm ON tm.team_id=t.id
        WHERE tm.user_id=?1 LIMIT 1`
    ).bind(userId)
  ]);
  return {
    task: taskPage.results?.[0] || null,
    team: teamPage.results?.[0] || null
  };
};

const readOrCreateIntent = async (env, values) => {
  const [insertPage, intentPage, mediaPage] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO media_upload_intents
        (id,user_id,task_id,business_type,object_key,mime_type,expected_size,width,height,status,
         expires_at,created_at,updated_at)
       VALUES (?1,?2,?3,'member-checkin',?4,?5,?6,?7,?8,'pending',?9,?10,?10)`
    ).bind(values.id, values.userId, values.taskId, values.objectKey, values.mimeType,
      values.fileSize, values.width, values.height, values.expiresAt, values.now),
    env.DB.prepare(
      `SELECT id,user_id AS userId,task_id AS taskId,business_type AS businessType,
              object_key AS objectKey,mime_type AS mimeType,expected_size AS expectedSize,
              width,height,status
         FROM media_upload_intents WHERE id=?1 LIMIT 1`
    ).bind(values.id),
    env.DB.prepare(
      `SELECT id,owner_user_id AS ownerUserId,task_id AS taskId,business_type AS businessType,
              object_key AS objectKey,mime_type AS mimeType,file_size AS fileSize,width,height
         FROM media_objects WHERE id=?1 LIMIT 1`
    ).bind(values.id)
  ]);
  void insertPage;
  return {
    intent: intentPage.results?.[0] || null,
    existingMedia: mediaPage.results?.[0] || null
  };
};

const intentMatchesUpload = (intent, values) => intent
  && intent.userId === values.userId
  && intent.taskId === values.taskId
  && intent.businessType === 'member-checkin'
  && intent.objectKey === values.objectKey
  && intent.mimeType === values.mimeType
  && Number(intent.expectedSize) === values.fileSize
  && Number(intent.width) === values.width
  && Number(intent.height) === values.height;

const mediaMatchesUpload = (media, values) => media
  && media.ownerUserId === values.userId
  && media.taskId === values.taskId
  && media.businessType === 'member-checkin'
  && media.objectKey === values.objectKey
  && media.mimeType === values.mimeType
  && Number(media.fileSize) === values.fileSize
  && Number(media.width) === values.width
  && Number(media.height) === values.height;

const confirmMedia = async (env, values, etag) => {
  const pages = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO media_objects
        (id,owner_user_id,task_id,business_type,object_key,mime_type,file_size,width,height,etag,
         visibility,business_id,created_at,updated_at)
       VALUES (?1,?2,?3,'member-checkin',?4,?5,?6,?7,?8,?9,'private',NULL,?10,?10)`
    ).bind(values.id, values.userId, values.taskId, values.objectKey, values.mimeType,
      values.fileSize, values.width, values.height, etag || '', values.now),
    env.DB.prepare(
      `UPDATE media_upload_intents
          SET status='confirmed',confirmed_at=?1,updated_at=?1
        WHERE id=?2 AND user_id=?3 AND status='pending'`
    ).bind(values.now, values.id, values.userId)
  ]);
  return Number(pages[1]?.meta?.changes || 0) > 0;
};

export const handleMemberFastV3 = async (request, env) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  if (auth.user.role !== 'student' || auth.user.trackId !== 'interaction') {
    return json({ error: '仅四校区互动赛道学生可以上传个人打卡图片' }, 403);
  }

  const taskId = cleanText(request.headers.get('x-task-id'), 80);
  const idempotencyKey = cleanText(request.headers.get('x-idempotency-key'), 80);
  const mimeType = cleanText(request.headers.get('content-type'), 80).toLowerCase().split(';')[0];
  const width = Number(request.headers.get('x-image-width'));
  const height = Number(request.headers.get('x-image-height'));
  const declaredLength = Number(request.headers.get('content-length') || 0);

  if (!taskId) return json({ error: '缺少任务编号' }, 400);
  if (!UUID_PATTERN.test(idempotencyKey)) return json({ error: '上传幂等编号格式无效' }, 400);
  if (!['image/webp', 'image/jpeg'].includes(mimeType)) {
    return json({ error: '个人打卡成品仅支持 WebP 或 JPEG' }, 415);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || Math.max(width, height) > MAX_EDGE) {
    return json({ error: '图片尺寸无效，最长边不能超过960像素' }, 400);
  }
  if (declaredLength > MAX_BYTES) {
    return json({ error: '图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。' }, 413);
  }

  const { task, team } = await readTaskAndTeam(env, taskId, auth.user.id);
  if (!task || task.status !== 'published' || task.trackId !== 'interaction'
      || (task.submissionType && task.submissionType !== 'team')) {
    return json({ error: '任务不存在、已关闭或不支持队伍成员打卡' }, 404);
  }
  if (!team) return json({ error: '尚未分配队伍，不能上传队伍打卡图片' }, 403);

  const occurrenceDate = shanghaiDate();
  let windowOpen = taskWindowOpen(task, occurrenceDate, false);
  if (!windowOpen) {
    const makeupAllowed = await hasMakeupPermission(env, auth.user.id, occurrenceDate);
    windowOpen = taskWindowOpen(task, occurrenceDate, makeupAllowed);
  }
  if (!windowOpen) return json({ error: '当前不在该任务的打卡时间范围内' }, 403);

  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) return json({ error: '图片内容不能为空' }, 400);
  if (buffer.byteLength > MAX_BYTES) {
    return json({ error: '图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。' }, 413);
  }
  const bytes = new Uint8Array(buffer);
  if (!signatureMatches(bytes, mimeType)) return json({ error: '图片真实格式校验失败' }, 415);

  const digest = await sha256Bytes(buffer);
  const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const objectKey = `media/${env.ENVIRONMENT || 'test'}/${auth.user.id}/member-checkin/${idempotencyKey}-${digest}.${extension}`;
  const now = nowIso();
  const values = {
    id: idempotencyKey,
    userId: auth.user.id,
    taskId: task.id,
    objectKey,
    mimeType,
    fileSize: buffer.byteLength,
    width,
    height,
    expiresAt: new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString(),
    now
  };

  const { intent, existingMedia } = await readOrCreateIntent(env, values);
  if (!intent) return json({ error: '上传会话创建失败，请稍后重试' }, 500);
  if (intent.userId !== auth.user.id) return json({ error: '无权使用该上传编号' }, 403);
  if (!intentMatchesUpload(intent, values)) {
    return json({ error: '相同上传编号对应的图片内容不一致' }, 409);
  }
  if (existingMedia) {
    if (intent.status !== 'confirmed' || !mediaMatchesUpload(existingMedia, values)) {
      return json({ error: '上传记录状态或内容不一致' }, 409);
    }
    return json({ ok: true, repeated: true, media: mediaPayload(existingMedia) });
  }
  if (intent.status === 'confirmed') return json({ error: '已确认的上传缺少媒体记录' }, 409);
  if (intent.status !== 'pending') return json({ error: '该上传会话已失效' }, 409);

  let objectWritten = false;
  try {
    const object = await env.UPLOADS.put(objectKey, buffer, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { sha256: digest, idempotencyKey }
    });
    objectWritten = true;
    if (!object || Number(object.size) !== buffer.byteLength
        || object.httpMetadata?.contentType !== mimeType) {
      throw Object.assign(new Error('R2图片校验失败，请重新上传'), { status: 409 });
    }

    const confirmed = await confirmMedia(env, values, object.httpEtag || '');
    if (!confirmed) {
      const recovered = await env.DB.prepare(
        `SELECT id,mime_type AS mimeType,file_size AS fileSize,width,height
           FROM media_objects WHERE id=?1 AND owner_user_id=?2 LIMIT 1`
      ).bind(values.id, values.userId).first();
      if (recovered) return json({ ok: true, repeated: true, media: mediaPayload(recovered) });
      throw Object.assign(new Error('图片确认发生冲突，请点击重试上传'), { status: 409 });
    }

    return json({
      ok: true,
      repeated: false,
      media: mediaPayload({
        id: values.id,
        mimeType,
        fileSize: values.fileSize,
        width,
        height
      })
    }, 201);
  } catch (error) {
    if (objectWritten) {
      const claimed = await env.DB.prepare(
        'SELECT 1 FROM media_objects WHERE id=?1 AND owner_user_id=?2 LIMIT 1'
      ).bind(values.id, values.userId).first().catch(() => null);
      if (!claimed) await env.UPLOADS.delete(objectKey).catch(() => null);
    }
    throw error;
  }
};
