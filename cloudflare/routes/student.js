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
  uploadImages
} from '../lib/runtime.js';

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

const submissionImages = async (env, submissionId) => {
  const { results } = await env.DB.prepare(
    `SELECT id, content_type AS contentType, bytes, sort_order AS sortOrder
       FROM task_submission_images WHERE submission_id = ?1 ORDER BY sort_order`
  ).bind(submissionId).all();
  return results.map((item) => ({ ...item, url: `/api/media/${item.id}` }));
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
      if (submission) submission.images = await submissionImages(env, submission.id);
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
    const { results } = await env.DB.prepare(
      `SELECT s.id,s.task_id AS taskId,t.name AS taskName,s.occurrence_date AS occurrenceDate,
              s.meal_type AS mealType,s.copy_text AS copy,s.status,s.submitted_at AS submittedAt,
              s.review_note AS reviewNote,s.version
         FROM task_submissions s JOIN tasks t ON t.id=s.task_id
        WHERE s.owner_type='user' AND s.owner_id=?1 ORDER BY s.updated_at DESC LIMIT 200`
    ).bind(user.id).all();
    for (const item of results) item.images = await submissionImages(env, item.id);
    return json({
      submissions: results.map((item) => ({
        ...item,
        task: { id: item.taskId, name: item.taskName }
      }))
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
    const uploaded = await uploadImages(env, body.images || body.photos, `member-checkins/${task.id}/${user.id}`, 1);
    const old = await env.DB.prepare(
      'SELECT object_key AS objectKey FROM member_checkins WHERE task_id=?1 AND occurrence_date=?2 AND user_id=?3'
    ).bind(task.id, occurrenceDate, user.id).first();
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO member_checkins
          (id,task_id,occurrence_date,user_id,team_id,object_key,content_type,bytes,status,submitted_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'submitted',?9)
         ON CONFLICT(task_id,occurrence_date,user_id) DO UPDATE SET
           team_id=excluded.team_id,object_key=excluded.object_key,
           content_type=excluded.content_type,bytes=excluded.bytes,status='submitted',
           submitted_at=excluded.submitted_at`
      ).bind(id, task.id, occurrenceDate, user.id, team.id, uploaded[0].key,
        uploaded[0].contentType, uploaded[0].bytes, nowIso()).run();
      if (old?.objectKey) ctx.waitUntil(env.UPLOADS.delete(old.objectKey));
      return json({ ok: true, occurrenceDate });
    } catch (error) {
      await env.UPLOADS.delete(uploaded[0].key);
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
    const uploaded = body.images?.length
      ? await uploadImages(env, body.images, `task-submissions/${task.id}/${owner.id}`, Number(task.imageLimit))
      : [];
    const displayUploaded = uploaded.length && Array.isArray(body.displayImages)
      && body.displayImages.length === uploaded.length
      ? await uploadImages(env, body.displayImages,
        `task-submissions/${task.id}/${owner.id}/display`, Number(task.imageLimit))
      : [];
    if (!uploaded.length && !current) return json({ error: '请至少上传一张图片' }, 400);
    const id = current?.id || crypto.randomUUID();
    const nextVersion = Number(current?.version || 0) + 1;
    const oldImages = current ? await env.DB.prepare(
      'SELECT object_key AS objectKey FROM task_submission_images WHERE submission_id=?1'
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
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS image_variants (
        source_type TEXT NOT NULL, source_id TEXT NOT NULL, variant TEXT NOT NULL,
        object_key TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY (source_type,source_id,variant))`).run();
      statements.push(env.DB.prepare('DELETE FROM task_submission_images WHERE submission_id=?1').bind(id));
      for (const image of uploaded) {
        statements.push(env.DB.prepare(
          `INSERT INTO task_submission_images
            (id,submission_id,object_key,content_type,bytes,sort_order,created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7)`
        ).bind(image.id, id, image.key, image.contentType, image.bytes, image.sortOrder, nowIso()));
        const display = displayUploaded[image.sortOrder];
        if (display) {
          statements.push(env.DB.prepare(
            `INSERT OR REPLACE INTO image_variants
              (source_type,source_id,variant,object_key,content_type,bytes,created_at)
             VALUES ('task_submission_image',?1,'display',?2,?3,?4,?5)`
          ).bind(image.id, display.key, display.contentType, display.bytes, nowIso()));
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
      if (uploaded.length) ctx.waitUntil(Promise.all(oldImages.results.map((item) => env.UPLOADS.delete(item.objectKey))));
      return json({ ok: true, submission: { id, status: intent, version: nextVersion } });
    } catch (error) {
      await Promise.all([...uploaded, ...displayUploaded].map((item) => env.UPLOADS.delete(item.key)));
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
        'SELECT id,kind,sort_order AS sortOrder FROM checkin_files WHERE checkin_id=?1 ORDER BY kind,sort_order'
      ).bind(item.id).all();
      item.photos = files.results.filter((file) => file.kind === 'photo').map((file) => `/api/media/${file.id}`);
      item.summary = files.results.find((file) => file.kind === 'summary')
        ? `/api/media/${files.results.find((file) => file.kind === 'summary').id}` : null;
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
    const photos = await uploadImages(env, body.photos, `checkins/${user.id}/${date}/${slot.id}`, 3);
    const summary = body.summary ? (await uploadImages(env, [body.summary], `checkins/${user.id}/${date}/${slot.id}/summary`, 1))[0] : null;
    const existing = await env.DB.prepare(
      'SELECT id,version FROM checkins WHERE user_id=?1 AND checkin_date=?2 AND slot_id=?3'
    ).bind(user.id, date, slot.id).first();
    const id = existing?.id || crypto.randomUUID();
    const old = existing ? await env.DB.prepare(
      'SELECT object_key AS objectKey FROM checkin_files WHERE checkin_id=?1'
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
    for (const file of [...photos, ...(summary ? [{ ...summary, sortOrder: 0, kind: 'summary' }] : [])]) {
      statements.push(env.DB.prepare(
        `INSERT INTO checkin_files
          (id,checkin_id,object_key,content_type,bytes,kind,sort_order,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
      ).bind(file.id, id, file.key, file.contentType, file.bytes, file.kind || 'photo', file.sortOrder, nowIso()));
    }
    try {
      await env.DB.batch(statements);
      ctx.waitUntil(Promise.all(old.results.map((item) => env.UPLOADS.delete(item.objectKey))));
      return json({ ok: true, id });
    } catch (error) {
      await Promise.all([...photos, ...(summary ? [summary] : [])].map((item) => env.UPLOADS.delete(item.key)));
      throw error;
    }
  }

  return null;
};

export const studentRouteError = errorResponse;
