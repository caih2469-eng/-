import {
  claimConfirmedMedia,
  cleanText,
  hasMakeupPermission,
  json,
  nowIso,
  readJson,
  requireUser,
  shanghaiDate,
  shanghaiTime
} from '../lib/runtime.js';
import { createPrivateMediaUrl } from '../lib/media-signing.js';
import { mapWithConcurrency } from '../services/student-dashboard.js';

let schemaReady;
const ensureMemberMediaSchema = (env) => {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS member_checkin_media (
        checkin_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY (checkin_id, media_id)
      )`),
      env.DB.prepare(
        'CREATE INDEX IF NOT EXISTS idx_member_checkin_media_checkin_sort ON member_checkin_media(checkin_id,sort_order)'
      )
    ]).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

const teamForUser = async (env, userId) => env.DB.prepare(
  `SELECT t.id,t.name FROM teams t
     JOIN team_members tm ON tm.team_id=t.id
    WHERE tm.user_id=?1 LIMIT 1`
).bind(userId).first();

const isTaskOccurrence = (task, occurrenceDate = '') => {
  const schedule = task.scheduleJson ? JSON.parse(task.scheduleJson) : null;
  if (!schedule) return Date.now() >= Date.parse(task.startsAt) && Date.now() <= Date.parse(task.endsAt);
  const today = shanghaiDate();
  if (occurrenceDate && occurrenceDate !== today) return false;
  if (today < schedule.activeStartDate || today > schedule.activeEndDate) return false;
  if (schedule.scheduleType === 'activityDays') {
    const [startYear, startMonth, startDay] = schedule.activeStartDate.split('-').map(Number);
    const [year, month, day] = today.split('-').map(Number);
    const activityDay = Math.floor((Date.UTC(year, month - 1, day)
      - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000) + 1;
    if (!schedule.refreshDays.includes(activityDay)) return false;
  }
  if (schedule.scheduleType === 'weekly') {
    const weekday = new Date(`${today}T12:00:00+08:00`).getUTCDay() || 7;
    if (!schedule.weekdays.includes(weekday)) return false;
  }
  return true;
};

const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {
  if (!isTaskOccurrence(task, occurrenceDate)) return false;
  if (makeupAllowed) return true;
  const schedule = task.scheduleJson ? JSON.parse(task.scheduleJson) : null;
  if (!schedule) return true;
  if (schedule.dailyStart && shanghaiTime() < schedule.dailyStart) return false;
  if (schedule.dailyEnd && shanghaiTime() > schedule.dailyEnd) return false;
  return true;
};

const handleHistory = async (env, user, url) => {
  await ensureMemberMediaSchema(env);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
  const offset = (page - 1) * limit;
  const [count, records] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM member_checkins WHERE user_id=?1')
      .bind(user.id).first(),
    env.DB.prepare(
      `SELECT mc.id,mc.occurrence_date AS date,mc.status,mc.submitted_at AS submittedAt,
              mc.object_key AS legacyObjectKey,t.name AS taskName
         FROM member_checkins mc JOIN tasks t ON t.id=mc.task_id
        WHERE mc.user_id=?1
        ORDER BY mc.occurrence_date DESC,mc.submitted_at DESC
        LIMIT ?2 OFFSET ?3`
    ).bind(user.id, limit, offset).all()
  ]);

  const ids = records.results.map((record) => record.id);
  const grouped = new Map();
  if (ids.length) {
    const placeholders = ids.map((_, index) => `?${index + 1}`).join(',');
    const mapped = await env.DB.prepare(
      `SELECT mm.checkin_id AS checkinId,mm.sort_order AS sortOrder,
              m.id,m.object_key AS objectKey,m.content_type AS contentType
         FROM member_checkin_media mm JOIN media_objects m ON m.id=mm.media_id
        WHERE mm.checkin_id IN (${placeholders})
        ORDER BY mm.checkin_id,mm.sort_order`
    ).bind(...ids).all();
    for (const media of mapped.results) {
      if (!grouped.has(media.checkinId)) grouped.set(media.checkinId, []);
      grouped.get(media.checkinId).push(media);
    }

    const fallback = await env.DB.prepare(
      `SELECT business_id AS checkinId,id,object_key AS objectKey,content_type AS contentType,
              created_at AS createdAt
         FROM media_objects
        WHERE business_id IN (${placeholders})
          AND business_type IN ('member-checkin','member-checkin-extra')
        ORDER BY business_id,created_at,id`
    ).bind(...ids).all();
    for (const media of fallback.results) {
      if (grouped.has(media.checkinId)) continue;
      if (!grouped.has(media.checkinId)) grouped.set(media.checkinId, []);
      grouped.get(media.checkinId).push(media);
    }
  }

  const signedRecords = await mapWithConcurrency(records.results, 6, async (record) => {
    const mediaRows = grouped.get(record.id) || [];
    const images = await mapWithConcurrency(mediaRows, 4, async (media) => {
      const displayUrl = await createPrivateMediaUrl(env, media, 'owner', user.id);
      return { thumbUrl: displayUrl, displayUrl, imageUrl: displayUrl };
    });
    if (!images.length && record.legacyObjectKey) {
      const legacyUrl = `/api/files/${encodeURIComponent(record.id)}`;
      images.push({ thumbUrl: legacyUrl, displayUrl: legacyUrl, imageUrl: legacyUrl });
    }
    delete record.legacyObjectKey;
    return { ...record, images };
  });

  const total = Number(count?.total || 0);
  return json({
    trackId: user.trackId,
    page,
    limit,
    total,
    hasMore: offset + signedRecords.length < total,
    records: signedRecords
  });
};

const handleSubmit = async (request, env, ctx, user, taskId) => {
  await ensureMemberMediaSchema(env);
  if (user.role !== 'student' || user.trackId !== 'interaction') {
    return json({ error: '仅互动赛道可打卡' }, 403);
  }
  const task = await env.DB.prepare(
    `SELECT id,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
            image_limit AS imageLimit,schedule_json AS scheduleJson,status
       FROM tasks WHERE id=?1`
  ).bind(taskId).first();
  if (!task || task.status !== 'published' || task.trackId !== 'interaction') {
    return json({ error: '任务不存在' }, 404);
  }

  const body = await readJson(request);
  if (body.images?.length || body.photos?.length) {
    return json({ error: '旧版Base64图片上传已停用，请重新选择图片' }, 400);
  }
  const occurrenceDate = cleanText(body.occurrenceDate || shanghaiDate(), 10);
  const makeupAllowed = await hasMakeupPermission(env, user.id, occurrenceDate);
  if (!taskWindowOpen(task, occurrenceDate, makeupAllowed)) {
    return json({ error: '当前不在打卡时间范围内' }, 403);
  }
  const team = await teamForUser(env, user.id);
  if (!team) return json({ error: '尚未分配队伍' }, 403);

  const imageLimit = Math.max(1, Math.min(8, Number(task.imageLimit || 1)));
  const uploaded = await claimConfirmedMedia(
    env,
    body.mediaIds,
    user,
    task.id,
    'member-checkin',
    imageLimit,
    { loadThumb: false }
  );
  if (!uploaded.length) return json({ error: '请至少上传一张图片' }, 400);

  const old = await env.DB.prepare(
    `SELECT id,object_key AS objectKey FROM member_checkins
      WHERE task_id=?1 AND occurrence_date=?2 AND user_id=?3`
  ).bind(task.id, occurrenceDate, user.id).first();
  const oldMedia = old?.id ? await env.DB.prepare(
    `SELECT id,object_key AS objectKey FROM media_objects
      WHERE business_id=?1 AND business_type IN ('member-checkin','member-checkin-extra')`
  ).bind(old.id).all() : { results: [] };
  const id = old?.id || crypto.randomUUID();
  const createdAt = nowIso();
  const first = uploaded[0];
  const statements = [
    env.DB.prepare('DELETE FROM member_checkin_media WHERE checkin_id=?1').bind(id),
    ...oldMedia.results.map((media) => env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(media.id)),
    env.DB.prepare(
      `INSERT INTO member_checkins
        (id,task_id,occurrence_date,user_id,team_id,object_key,content_type,bytes,status,submitted_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'submitted',?9)
       ON CONFLICT(task_id,occurrence_date,user_id) DO UPDATE SET
         team_id=excluded.team_id,object_key=excluded.object_key,
         content_type=excluded.content_type,bytes=excluded.bytes,status='submitted',
         submitted_at=excluded.submitted_at`
    ).bind(id, task.id, occurrenceDate, user.id, team.id, first.objectKey,
      first.contentType, first.bytes, createdAt)
  ];

  uploaded.forEach((media, index) => {
    statements.push(env.DB.prepare(
      `UPDATE media_objects
          SET business_id=?1,business_type=?2,updated_at=?3
        WHERE id=?4 AND owner_user_id=?5 AND business_id IS NULL`
    ).bind(id, index === 0 ? 'member-checkin' : 'member-checkin-extra', createdAt, media.id, user.id));
    statements.push(env.DB.prepare(
      `INSERT INTO member_checkin_media (checkin_id,media_id,sort_order,created_at)
       VALUES (?1,?2,?3,?4)`
    ).bind(id, media.id, index, createdAt));
  });

  await env.DB.batch(statements);

  const nextKeys = new Set(uploaded.map((media) => media.objectKey));
  const oldKeys = new Set([
    ...oldMedia.results.map((media) => media.objectKey),
    ...(old?.objectKey ? [old.objectKey] : [])
  ].filter((key) => key && !nextKeys.has(key)));
  if (oldKeys.size) {
    ctx.waitUntil(Promise.all([...oldKeys].map((key) => env.UPLOADS.delete(key))));
  }

  return json({ ok: true, occurrenceDate, imageCount: uploaded.length });
};

export const handleMemberCheckinMultiRoutes = async (request, env, ctx, url) => {
  const memberMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/member-checkin$/);
  const historyMatch = url.pathname === '/api/checkins/history' && request.method === 'GET';
  if (!memberMatch && !historyMatch) return null;

  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;

  if (historyMatch) {
    if (user.role !== 'student' || user.trackId !== 'interaction') return null;
    return handleHistory(env, user, url);
  }
  if (request.method !== 'PUT') return null;
  return handleSubmit(request, env, ctx, user, decodeURIComponent(memberMatch[1]));
};
