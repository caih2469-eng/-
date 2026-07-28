import {
  cleanText,
  errorResponse,
  hasMakeupPermission,
  json,
  nowIso,
  readConfig,
  readJson,
  requireUser,
  shanghaiDate,
  shanghaiTime,
  uploadImages,
  claimConfirmedMedia
} from '../lib/runtime.js';
import { createPrivateMediaUrl } from '../lib/media-signing.js';

const teamForUser = async (env, userId) => env.DB.prepare(
  `SELECT t.id, t.name, t.invite_code AS inviteCode, t.member_limit AS memberLimit,
          t.captain_user_id AS captainId, t.created_at AS createdAt
     FROM teams t JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?1 LIMIT 1`
).bind(userId).first();

const membersForTeam = async (env, teamId) => {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.student_id AS studentId, u.name, u.campus, u.track_id AS trackId,
            u.status, u.created_at AS createdAt
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?1 ORDER BY tm.joined_at, u.student_id`
  ).bind(teamId).all();
  return results;
};

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

const submissionOwner = async (env, user, task) => {
  if (task.submissionType === 'team' || task.trackId === 'interaction') {
    const team = await teamForUser(env, user.id);
    if (!team) throw Object.assign(new Error('尚未分配队伍'), { status: 403 });
    return { type: 'team', id: team.id, team };
  }
  return { type: 'user', id: user.id, team: null };
};

const submissionImages = async (env, submissionId, viewer) => {
  const { results } = await env.DB.prepare(
    `SELECT i.id,i.object_key AS objectKey,i.content_type AS contentType,i.bytes,
            i.sort_order AS sortOrder,m.id AS mediaId,
            tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey,
            tm.mime_type AS thumbContentType,tm.file_size AS thumbBytes
       FROM task_submission_images i
       LEFT JOIN media_objects m ON m.id=i.id
       LEFT JOIN media_objects tm ON tm.business_id=m.id
        AND tm.business_type IN ('task:thumb','admin-makeup:thumb')
      WHERE i.submission_id=?1 ORDER BY i.sort_order`
  ).bind(submissionId).all();
  return Promise.all(results.map(async (item) => {
    const displayUrl = item.mediaId
      ? await createPrivateMediaUrl(env, item, viewer.role === 'admin' ? 'admin' : 'owner', viewer.id)
      : `/api/files/${item.id}`;
    const thumbUrl = item.thumbMediaId
      ? await createPrivateMediaUrl(env, {
        id: item.thumbMediaId,
        objectKey: item.thumbObjectKey
      }, viewer.role === 'admin' ? 'admin' : 'owner', viewer.id)
      : displayUrl;
    return { ...item, thumbUrl, displayUrl, imageUrl: thumbUrl, url: thumbUrl };
  }));
};

export const handleStudentRoutes = async (request, env, ctx, url) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;
  const route = url.pathname;

  if (route === '/api/teams' && request.method === 'GET') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可查看队伍' }, 403);
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.name, t.member_limit AS memberLimit, COUNT(tm.user_id) AS memberCount
         FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
        GROUP BY t.id ORDER BY t.created_at LIMIT 100`
    ).all();
    const config = await readConfig(env);
    return json({
      teams: results.map((team) => ({
        ...team,
        memberCount: Number(team.memberCount),
        isFull: Number(team.memberCount) >= Number(team.memberLimit)
      })),
      teamCount: results.length,
      maxTeams: config.maxTeams
    });
  }

  if (route === '/api/teams/me' && request.method === 'GET') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可查看队伍' }, 403);
    const team = await teamForUser(env, user.id);
    if (!team) return json({ team: null });
    const members = await membersForTeam(env, team.id);
    return json({ team: { ...team, members, memberCount: members.length } });
  }

  if (route === '/api/teams/join' && request.method === 'POST') {
    const config = await readConfig(env);
    if (!config.allowSelfJoin) return json({ error: '学生自助加入已关闭，请联系管理员' }, 403);
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可加入队伍' }, 403);
    if (await teamForUser(env, user.id)) return json({ error: '每名学生只能加入一个队伍' }, 409);
    const body = await readJson(request);
    const inviteCode = cleanText(body.inviteCode, 20).toUpperCase();
    const team = await env.DB.prepare(
      `SELECT t.id, t.member_limit AS memberLimit, COUNT(tm.user_id) AS memberCount
         FROM teams t LEFT JOIN team_members tm ON tm.team_id=t.id
        WHERE t.invite_code=?1 GROUP BY t.id`
    ).bind(inviteCode).first();
    if (!team) return json({ error: '邀请码无效' }, 404);
    if (Number(team.memberCount) >= Number(team.memberLimit)) return json({ error: '队伍已满' }, 409);
    try {
      const inserted = await env.DB.prepare(
        `INSERT INTO team_members (team_id,user_id,joined_at)
         SELECT ?1,?2,?3 WHERE
          (SELECT COUNT(*) FROM team_members WHERE team_id=?1)
          < (SELECT member_limit FROM teams WHERE id=?1)`
      ).bind(team.id, user.id, nowIso()).run();
      if (!inserted.meta.changes) return json({ error: '队伍已满' }, 409);
    } catch {
      return json({ error: '每名学生只能加入一个队伍' }, 409);
    }
    return json({ ok: true });
  }

  if (route === '/api/tasks' && request.method === 'GET') {
    const config = await readConfig(env);
    if (user.role === 'student' && (!config.activityEnabled || !config.trackEnabled[user.trackId])) {
      return json({ tasks: [], switches: { activityEnabled: config.activityEnabled, trackEnabled: config.trackEnabled } });
    }
    const { results } = await env.DB.prepare(
      `SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
              allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,
              submission_type AS submissionType,status,schedule_json AS scheduleJson
         FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)
        ORDER BY starts_at DESC LIMIT 100`
    ).bind(user.role, user.trackId || '').all();
    const tasks = [];
    const makeupAllowed = user.role === 'student'
      ? await hasMakeupPermission(env, user.id, shanghaiDate()) : false;
    for (const task of results) {
      if (task.scheduleJson && !isTaskOccurrence(task, shanghaiDate())) continue;
      const owner = user.role === 'admin' ? null : await submissionOwner(env, user, task).catch(() => null);
      const occurrenceDate = task.scheduleJson ? shanghaiDate() : '';
      const submission = owner ? await env.DB.prepare(
        `SELECT id,copy_text AS copy,plaza_copy AS plazaCopy,meal_type AS mealType,
                is_public AS isPublic,status,version,occurrence_date AS occurrenceDate,
                submitted_at AS submittedAt,review_note AS reviewNote
           FROM task_submissions
          WHERE task_id=?1 AND owner_type=?2 AND owner_id=?3 AND occurrence_date=?4 LIMIT 1`
      ).bind(task.id, owner.type, owner.id, occurrenceDate).first() : null;
      if (submission) submission.images = await submissionImages(env, submission.id, user);
      const schedule = task.scheduleJson ? JSON.parse(task.scheduleJson) : {};
      let teamProgress = null;
      let memberCheckin = null;
      let isCaptain = false;
      if (owner?.team) {
        const members = await membersForTeam(env, owner.team.id);
        const checkins = await env.DB.prepare(
          `SELECT user_id AS userId,id FROM member_checkins
            WHERE team_id=?1 AND task_id=?2 AND occurrence_date=?3`
        ).bind(owner.team.id, task.id, occurrenceDate).all();
        teamProgress = {
          total: members.length,
          completed: checkins.results.length,
          members: members.map((member) => ({
            ...member,
            checked: checkins.results.some((item) => item.userId === member.id)
          }))
        };
        memberCheckin = checkins.results.find((item) => item.userId === user.id) || null;
        isCaptain = owner.team.captainId === user.id;
      }
      tasks.push({
        ...task,
        startAt: task.startsAt,
        endAt: task.endsAt,
        allowLate: Boolean(task.allowLate),
        schedule,
        scheduleType: schedule.scheduleType || 'single',
        refreshDays: schedule.refreshDays || [],
        weekdays: schedule.weekdays || [],
        dailyStart: schedule.dailyStart || '',
        dailyEnd: schedule.dailyEnd || '',
        occurrenceDate,
        canSubmit: user.role === 'student' && taskWindowOpen(task, occurrenceDate, makeupAllowed),
        availabilityError: user.role === 'student' && !taskWindowOpen(task, occurrenceDate, makeupAllowed) ? '当前不在任务提交时间范围内' : '',
        makeupAllowed,
        submission,
        teamProgress,
        memberCheckin,
        isCaptain
      });
    }
    return json({ tasks, switches: { activityEnabled: config.activityEnabled, trackEnabled: config.trackEnabled } });
  }

  if (route === '/api/submissions/history' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const offset = (page - 1) * limit;
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM task_submissions WHERE owner_type='user' AND owner_id=?1"
    ).bind(user.id).first();
    const { results } = await env.DB.prepare(
      `SELECT s.id,s.task_id AS taskId,t.name AS taskName,s.occurrence_date AS occurrenceDate,
              s.meal_type AS mealType,s.copy_text AS copy,s.status,s.submitted_at AS submittedAt,
              s.review_note AS reviewNote,s.version
         FROM task_submissions s JOIN tasks t ON t.id=s.task_id
        WHERE s.owner_type='user' AND s.owner_id=?1 ORDER BY s.updated_at DESC LIMIT ?2 OFFSET ?3`
    ).bind(user.id, limit, offset).all();
    for (const item of results) item.images = await submissionImages(env, item.id, user);
    return json({
      page,
      limit,
      total: Number(count.total),
      hasMore: offset + results.length < Number(count.total),
      submissions: results.map((item) => ({
        ...item,
        task: { id: item.taskId, name: item.taskName }
      }))
    });
  }

  if (route === '/api/checkins/history' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const offset = (page - 1) * limit;

    if (user.trackId === 'health') {
      const count = await env.DB.prepare(
        'SELECT COUNT(*) AS total FROM checkins WHERE user_id=?1'
      ).bind(user.id).first();
      const records = await env.DB.prepare(
        `SELECT c.id,c.checkin_date AS date,c.slot_id AS slotId,c.note,c.status,
                c.submitted_at AS submittedAt,c.review_note AS reviewNote
           FROM checkins c WHERE c.user_id=?1
          ORDER BY c.checkin_date DESC,c.submitted_at DESC LIMIT ?2 OFFSET ?3`
      ).bind(user.id, limit, offset).all();
      for (const record of records.results) {
        const files = await env.DB.prepare(
          `SELECT f.id,f.object_key AS objectKey,f.kind,m.id AS mediaId,
                  tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
             FROM checkin_files f
             LEFT JOIN media_objects m ON m.id=f.id
             LEFT JOIN media_objects tm ON tm.business_id=m.id
              AND tm.business_type IN ('meal-checkin:thumb','admin-makeup:thumb')
             WHERE f.checkin_id=?1 ORDER BY f.sort_order`
        ).bind(record.id).all();
        record.images = [];
        for (const file of files.results.filter((item) => item.kind === 'photo')) {
          const displayUrl = file.mediaId
            ? await createPrivateMediaUrl(env, file, 'owner', user.id)
            : `/api/files/${file.id}`;
          const thumbUrl = file.thumbMediaId
            ? await createPrivateMediaUrl(env, {
              id: file.thumbMediaId,
              objectKey: file.thumbObjectKey
            }, 'owner', user.id)
            : displayUrl;
          record.images.push({ thumbUrl, displayUrl, imageUrl: thumbUrl });
        }
      }
      return json({
        trackId: user.trackId,
        page,
        limit,
        total: Number(count.total),
        records: records.results
      });
    }

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM member_checkins WHERE user_id=?1'
    ).bind(user.id).first();
    const records = await env.DB.prepare(
      `SELECT mc.id,mc.occurrence_date AS date,mc.status,mc.submitted_at AS submittedAt,
               t.name AS taskName,m.id AS mediaId,m.object_key AS objectKey,
               tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
         FROM member_checkins mc JOIN tasks t ON t.id=mc.task_id
         LEFT JOIN media_objects m ON m.business_id=mc.id AND m.business_type='member-checkin'
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('member-checkin:thumb','admin-makeup:thumb')
        WHERE mc.user_id=?1 ORDER BY mc.occurrence_date DESC,mc.submitted_at DESC
        LIMIT ?2 OFFSET ?3`
    ).bind(user.id, limit, offset).all();
    for (const record of records.results) {
      const displayUrl = record.objectKey
        ? (record.mediaId
          ? await createPrivateMediaUrl(env, record, 'owner', user.id)
          : `/api/files/${record.id}`)
        : null;
      const thumbUrl = record.thumbMediaId
        ? await createPrivateMediaUrl(env, {
          id: record.thumbMediaId,
          objectKey: record.thumbObjectKey
        }, 'owner', user.id)
        : displayUrl;
      record.images = displayUrl ? [{ thumbUrl, displayUrl, imageUrl: thumbUrl }] : [];
    }
    return json({
      trackId: user.trackId,
      page,
      limit,
      total: Number(count.total),
      records: records.results
    });
  }

  const memberMatch = route.match(/^\/api\/tasks\/([^/]+)\/member-checkin$/);
  if (memberMatch && request.method === 'PUT') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可打卡' }, 403);
    const task = await env.DB.prepare(
      `SELECT id,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
              schedule_json AS scheduleJson,status FROM tasks WHERE id=?1`
    ).bind(decodeURIComponent(memberMatch[1])).first();
    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);
    const body = await readJson(request);
    const occurrenceDate = cleanText(body.occurrenceDate || shanghaiDate(), 10);
    const makeupAllowed = await hasMakeupPermission(env, user.id, occurrenceDate);
    if (!taskWindowOpen(task, occurrenceDate, makeupAllowed)) return json({ error: '当前不在打卡时间范围内' }, 403);
    const team = await teamForUser(env, user.id);
    if (!team) return json({ error: '尚未分配队伍' }, 403);
    if (body.images?.length || body.photos?.length) {
      return json({ error: '旧版Base64图片上传已停用，请重新选择图片' }, 400);
    }
    const uploaded = await claimConfirmedMedia(
      env, body.mediaIds, user, task.id, 'member-checkin', 1
    );
    const old = await env.DB.prepare(
      `SELECT c.id,c.object_key AS objectKey,m.id AS mediaId,
              tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
         FROM member_checkins c
         LEFT JOIN media_objects m ON m.business_id=c.id AND m.business_type='member-checkin'
             LEFT JOIN media_objects tm ON tm.business_id=m.id
              AND tm.business_type IN ('member-checkin:thumb','admin-makeup:thumb')
        WHERE c.task_id=?1 AND c.occurrence_date=?2 AND c.user_id=?3`
    ).bind(task.id, occurrenceDate, user.id).first();
    const id = old?.id || crypto.randomUUID();
    try {
      const statements = [
        ...(old?.mediaId ? [env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(old.mediaId)] : []),
        ...(old?.thumbMediaId ? [env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(old.thumbMediaId)] : []),
        ...(old?.id ? [env.DB.prepare(
          "DELETE FROM image_variants WHERE source_type='member_checkin' AND source_id=?1"
        ).bind(old.id)] : []),
        env.DB.prepare(
          `INSERT INTO member_checkins
          (id,task_id,occurrence_date,user_id,team_id,object_key,content_type,bytes,status,submitted_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'submitted',?9)
         ON CONFLICT(task_id,occurrence_date,user_id) DO UPDATE SET
            team_id=excluded.team_id,object_key=excluded.object_key,
            content_type=excluded.content_type,bytes=excluded.bytes,status='submitted',
            submitted_at=excluded.submitted_at`
        ).bind(id, task.id, occurrenceDate, user.id, team.id, uploaded[0].objectKey,
          uploaded[0].contentType, uploaded[0].bytes, nowIso()),
        env.DB.prepare(
          `UPDATE media_objects SET business_id=?1,updated_at=?2
            WHERE id=?3 AND owner_user_id=?4 AND business_id IS NULL`
        ).bind(id, nowIso(), uploaded[0].id, user.id)
      ];
      statements.push(env.DB.prepare(
        `INSERT OR REPLACE INTO image_variants
          (source_type,source_id,variant,object_key,content_type,bytes,created_at)
         VALUES ('member_checkin',?1,'display',?2,?3,?4,?5)`
      ).bind(id, uploaded[0].objectKey, uploaded[0].contentType, uploaded[0].bytes, nowIso()));
      if (uploaded[0].thumb) {
        statements.push(env.DB.prepare(
          `INSERT OR REPLACE INTO image_variants
            (source_type,source_id,variant,object_key,content_type,bytes,created_at)
           VALUES ('member_checkin',?1,'thumb',?2,?3,?4,?5)`
        ).bind(id, uploaded[0].thumb.objectKey, uploaded[0].thumb.contentType,
          uploaded[0].thumb.bytes, nowIso()));
      }
      await env.DB.batch(statements);
      if (old?.objectKey) {
        ctx.waitUntil(Promise.all([
          env.UPLOADS.delete(old.objectKey),
          ...(old.thumbObjectKey ? [env.UPLOADS.delete(old.thumbObjectKey)] : [])
        ]));
      }
      return json({ ok: true, occurrenceDate });
    } catch (error) {
      throw error;
    }
  }

  const submissionMatch = route.match(/^\/api\/tasks\/([^/]+)\/submission$/);
  if (submissionMatch && request.method === 'PUT') {
    const task = await env.DB.prepare(
      `SELECT id,name,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
              image_limit AS imageLimit,copy_requirement AS copyRequirement,
              submission_type AS submissionType,schedule_json AS scheduleJson,status
         FROM tasks WHERE id=?1`
    ).bind(decodeURIComponent(submissionMatch[1])).first();
    if (!task || task.status !== 'published' || (user.role !== 'admin' && task.trackId !== user.trackId)) {
      return json({ error: '任务不存在' }, 404);
    }
    const body = await readJson(request);
    const occurrenceDate = task.scheduleJson ? cleanText(body.occurrenceDate, 10) : '';
    if (!taskWindowOpen(task, occurrenceDate)) return json({ error: '当前不在任务提交时间范围内' }, 403);
    const owner = await submissionOwner(env, user, task);
    const intent = body.intent === 'draft' ? 'draft' : 'submitted';
    const copy = cleanText(body.copy, 2000);
    const plazaCopy = cleanText(body.plazaCopy, 2000);
    const isPublic = task.trackId === 'interaction' && Boolean(body.isPublic);
    if (intent === 'submitted' && task.copyRequirement && !copy) return json({ error: '请填写活动文案' }, 400);
    if (intent === 'submitted' && isPublic && !plazaCopy) return json({ error: '请填写广场作品文案' }, 400);
    const current = await env.DB.prepare(
      `SELECT id,status,version FROM task_submissions
        WHERE task_id=?1 AND owner_type=?2 AND owner_id=?3 AND occurrence_date=?4`
    ).bind(task.id, owner.type, owner.id, occurrenceDate).first();
    if (current?.status === 'submitted' || current?.status === 'approved') {
      return json({ error: '该任务已最终提交，不能重复提交' }, 409);
    }
    if (current && Number(body.version) !== Number(current.version)) return json({ error: '内容已被队友更新，请刷新后重试' }, 409);
    if (body.images?.length || body.displayImages?.length) {
      return json({ error: '旧版Base64和双图片上传已停用，请重新选择图片' }, 400);
    }
    const uploaded = body.mediaIds?.length
      ? await claimConfirmedMedia(env, body.mediaIds, user, task.id, 'task', Number(task.imageLimit))
      : [];
    if (!uploaded.length && !current) return json({ error: '请至少上传一张图片' }, 400);
    const id = current?.id || crypto.randomUUID();
    const nextVersion = Number(current?.version || 0) + 1;
    const oldImages = current ? await env.DB.prepare(
      `SELECT i.id,i.object_key AS objectKey,m.id AS mediaId,
              tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
         FROM task_submission_images i
         LEFT JOIN media_objects m ON m.id=i.id
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('task:thumb','admin-makeup:thumb')
        WHERE i.submission_id=?1`
    ).bind(id).all() : { results: [] };
    const statements = [];
    let claimStatement = null;
    if (current) {
      claimStatement = env.DB.prepare(
        `UPDATE task_submissions SET copy_text=?1,plaza_copy=?2,meal_type=?3,is_public=?4,
                status=?5,version=version+1,submitted_at=?6,updated_at=?7
          WHERE id=?8 AND version=?9`
      ).bind(copy, plazaCopy, cleanText(body.mealType, 20), isPublic ? 1 : 0, intent,
        intent === 'submitted' ? nowIso() : null, nowIso(), id, current.version);
    } else {
      statements.push(env.DB.prepare(
        `INSERT INTO task_submissions
          (id,task_id,owner_type,owner_id,occurrence_date,copy_text,plaza_copy,meal_type,
           is_public,status,version,submitted_at,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?12,?12)`
      ).bind(id, task.id, owner.type, owner.id, occurrenceDate, copy, plazaCopy,
        cleanText(body.mealType, 20), isPublic ? 1 : 0, intent,
        intent === 'submitted' ? nowIso() : null, nowIso()));
    }
    if (uploaded.length) {
      statements.push(env.DB.prepare('DELETE FROM task_submission_images WHERE submission_id=?1').bind(id));
      for (const oldImage of oldImages.results) {
        if (oldImage.mediaId) {
          statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(oldImage.mediaId));
        }
        if (oldImage.thumbMediaId) {
          statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(oldImage.thumbMediaId));
        }
        statements.push(env.DB.prepare(
          "DELETE FROM image_variants WHERE source_type='task_submission_image' AND source_id=?1"
        ).bind(oldImage.id));
      }
      for (const image of uploaded) {
        statements.push(env.DB.prepare(
          `INSERT INTO task_submission_images
            (id,submission_id,object_key,content_type,bytes,sort_order,created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7)`
        ).bind(image.id, id, image.objectKey, image.contentType, image.bytes, image.sortOrder, nowIso()));
        statements.push(env.DB.prepare(
          `UPDATE media_objects SET business_id=?1,visibility=?2,updated_at=?3
            WHERE id=?4 AND owner_user_id=?5 AND business_id IS NULL`
        ).bind(id, intent === 'submitted' && isPublic ? 'public' : 'private', nowIso(), image.id, user.id));
        statements.push(env.DB.prepare(
          `INSERT OR REPLACE INTO image_variants
            (source_type,source_id,variant,object_key,content_type,bytes,created_at)
           VALUES ('task_submission_image',?1,'display',?2,?3,?4,?5)`
        ).bind(image.id, image.objectKey, image.contentType, image.bytes, nowIso()));
        if (image.thumb) {
          statements.push(env.DB.prepare(
            `INSERT OR REPLACE INTO image_variants
              (source_type,source_id,variant,object_key,content_type,bytes,created_at)
             VALUES ('task_submission_image',?1,'thumb',?2,?3,?4,?5)`
          ).bind(image.id, image.thumb.objectKey, image.thumb.contentType, image.thumb.bytes, nowIso()));
        }
      }
    }
    if (intent === 'submitted' && isPublic && owner.team) {
      statements.push(env.DB.prepare(
        `INSERT INTO plaza_posts
          (id,submission_id,team_id,copy_text,status,excluded_from_ranking,published_at,updated_at)
         VALUES (?1,?2,?3,?4,'visible',0,?5,?5)
         ON CONFLICT(submission_id) DO UPDATE SET copy_text=excluded.copy_text,status='visible',
           updated_at=excluded.updated_at`
      ).bind(crypto.randomUUID(), id, owner.team.id, plazaCopy, nowIso()));
    }
    try {
      if (claimStatement) {
        const claimed = await claimStatement.run();
        if (!claimed.meta.changes) throw Object.assign(new Error('内容已被更新'), { status: 409 });
      }
      await env.DB.batch(statements);
      if (uploaded.length) {
        const origin = new URL(request.url).origin;
        ctx.waitUntil(Promise.all(oldImages.results.flatMap((item) => [
          env.UPLOADS.delete(item.objectKey),
          ...(item.thumbObjectKey ? [env.UPLOADS.delete(item.thumbObjectKey)] : []),
          ...(item.mediaId
            ? [
              caches.default.delete(new Request(`${origin}/api/public-media/${encodeURIComponent(item.mediaId)}`)),
              caches.default.delete(new Request(`${origin}/api/public-images/${encodeURIComponent(item.id)}?variant=thumb`)),
              caches.default.delete(new Request(`${origin}/api/public-images/${encodeURIComponent(item.id)}?variant=display`))
            ]
            : [])
        ])));
      }
      return json({ ok: true, submission: { id, status: intent, version: nextVersion } });
    } catch (error) {
      throw error;
    }
  }

  if (route === '/api/checkins' && request.method === 'GET') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : shanghaiDate();
    const { results } = await env.DB.prepare(
      `SELECT id,checkin_date AS date,slot_id AS slotId,note,status,submitted_at AS submittedAt,
              review_note AS reviewNote,version
         FROM checkins WHERE user_id=?1 AND checkin_date=?2 ORDER BY submitted_at`
    ).bind(user.id, date).all();
    for (const item of results) {
      const files = await env.DB.prepare(
        `SELECT f.id,f.object_key AS objectKey,f.kind,f.sort_order AS sortOrder,m.id AS mediaId
           FROM checkin_files f LEFT JOIN media_objects m ON m.id=f.id
          WHERE f.checkin_id=?1 ORDER BY f.kind,f.sort_order`
      ).bind(item.id).all();
      for (const file of files.results) {
        file.imageUrl = file.mediaId
          ? await createPrivateMediaUrl(env, file, user.role === 'admin' ? 'admin' : 'owner', user.id)
          : `/api/files/${file.id}`;
      }
      item.photos = files.results.filter((file) => file.kind === 'photo').map((file) => file.imageUrl);
      item.summary = files.results.find((file) => file.kind === 'summary')?.imageUrl || null;
    }
    return json({ checkins: results });
  }

  if (route === '/api/checkins' && request.method === 'POST') {
    if (user.role !== 'student') return json({ error: '管理员不能提交打卡' }, 403);
    const config = await readConfig(env);
    if (!config.activityEnabled || !config.trackEnabled[user.trackId]) return json({ error: '活动当前未开放' }, 403);
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const makeupAllowed = await hasMakeupPermission(env, user.id, date);
    if (date !== shanghaiDate() && !makeupAllowed) return json({ error: '只能提交当天材料' }, 403);
    const slot = config.slots.find((item) => item.id === body.slotId);
    if (!slot || (!makeupAllowed && (shanghaiTime() < slot.start || shanghaiTime() > slot.end))) {
      return json({ error: '当前不在该时段' }, 403);
    }
    if (body.photos?.length || body.summary) {
      return json({ error: '旧版Base64图片上传已停用，请重新选择图片' }, 400);
    }
    const photos = await claimConfirmedMedia(
      env, body.photoMediaIds, user, null, 'meal-checkin', 3
    );
    const summary = body.summaryMediaId
      ? (await claimConfirmedMedia(env, [body.summaryMediaId], user, null, 'meal-checkin', 1))[0]
      : null;
    const existing = await env.DB.prepare(
      'SELECT id,version FROM checkins WHERE user_id=?1 AND checkin_date=?2 AND slot_id=?3'
    ).bind(user.id, date, slot.id).first();
    const id = existing?.id || crypto.randomUUID();
    const old = existing ? await env.DB.prepare(
      `SELECT f.id,f.object_key AS objectKey,m.id AS mediaId,
              tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
         FROM checkin_files f
         LEFT JOIN media_objects m ON m.id=f.id
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('meal-checkin:thumb','admin-makeup:thumb')
        WHERE f.checkin_id=?1`
    ).bind(id).all() : { results: [] };
    const statements = [
      env.DB.prepare(
        `INSERT INTO checkins
          (id,user_id,checkin_date,slot_id,note,status,submitted_at,review_note,version)
         VALUES (?1,?2,?3,?4,?5,'pending',?6,'',1)
         ON CONFLICT(user_id,checkin_date,slot_id) DO UPDATE SET
          note=excluded.note,status='pending',submitted_at=excluded.submitted_at,
          review_note='',version=checkins.version+1`
      ).bind(id, user.id, date, slot.id, cleanText(body.note, 300), nowIso()),
      env.DB.prepare('DELETE FROM checkin_files WHERE checkin_id=?1').bind(id)
    ];
    for (const file of old.results) {
      if (file.mediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(file.mediaId));
      if (file.thumbMediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(file.thumbMediaId));
      statements.push(env.DB.prepare(
        "DELETE FROM image_variants WHERE source_type='checkin_file' AND source_id=?1"
      ).bind(file.id));
    }
    for (const file of [...photos, ...(summary ? [{ ...summary, sortOrder: 0, kind: 'summary' }] : [])]) {
      statements.push(env.DB.prepare(
        `INSERT INTO checkin_files
          (id,checkin_id,object_key,content_type,bytes,kind,sort_order,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
      ).bind(file.id, id, file.objectKey, file.contentType, file.bytes, file.kind || 'photo', file.sortOrder, nowIso()));
      statements.push(env.DB.prepare(
        `UPDATE media_objects SET business_id=?1,updated_at=?2
          WHERE id=?3 AND owner_user_id=?4 AND business_id IS NULL`
      ).bind(id, nowIso(), file.id, user.id));
      statements.push(env.DB.prepare(
        `INSERT OR REPLACE INTO image_variants
          (source_type,source_id,variant,object_key,content_type,bytes,created_at)
         VALUES ('checkin_file',?1,'display',?2,?3,?4,?5)`
      ).bind(file.id, file.objectKey, file.contentType, file.bytes, nowIso()));
      if (file.thumb) {
        statements.push(env.DB.prepare(
          `INSERT OR REPLACE INTO image_variants
            (source_type,source_id,variant,object_key,content_type,bytes,created_at)
           VALUES ('checkin_file',?1,'thumb',?2,?3,?4,?5)`
        ).bind(file.id, file.thumb.objectKey, file.thumb.contentType, file.thumb.bytes, nowIso()));
      }
    }
    try {
      await env.DB.batch(statements);
      ctx.waitUntil(Promise.all(old.results.flatMap((item) => [
        env.UPLOADS.delete(item.objectKey),
        ...(item.thumbObjectKey ? [env.UPLOADS.delete(item.thumbObjectKey)] : [])
      ])));
      return json({ ok: true, id });
    } catch (error) {
      throw error;
    }
  }

  return null;
};

export const studentRouteError = errorResponse;
