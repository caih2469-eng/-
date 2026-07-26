import {
  audit,
  cleanText,
  ensureMakeupPermissions,
  hashPassword,
  json,
  nowIso,
  passwordMatches,
  putConfig,
  readConfig,
  readJson,
  requireUser,
  shanghaiDate,
  TRACKS,
  uploadImages
} from '../lib/runtime.js';
import { calculateRankings } from './plaza.js';
import { excelResponse, readWorkbookRows } from '../lib/excel.js';

const adminUser = async (request, env) => requireUser(request, env, true);
const safeUserColumns = `id,student_id AS studentId,name,role,campus,track_id AS trackId,
  status,created_at AS createdAt`;
const validTrack = (value) => TRACKS.some((track) => track.id === value);
const primaryAdminId = async (env) => {
  const row = await env.DB.prepare("SELECT value_json AS valueJson FROM app_config WHERE key='primaryAdminId'").first();
  try { return JSON.parse(row?.valueJson || 'null'); } catch { return null; }
};
const requirePrimaryAdmin = async (env, admin) => {
  const id = await primaryAdminId(env);
  return id && id === admin.id;
};
const ensureAdminGovernance = (env) => env.DB.prepare(
  `CREATE TABLE IF NOT EXISTS admin_action_reviews (
    audit_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'visible',
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT NOT NULL DEFAULT ''
  )`
).run();
const completionExpression = `((
  u.track_id='health' AND
  (SELECT COUNT(DISTINCT c.slot_id) FROM checkins c
    WHERE c.user_id=u.id AND c.checkin_date=?2) >= 3
) OR (
  u.track_id='interaction' AND EXISTS (
    SELECT 1 FROM member_checkins mc WHERE mc.user_id=u.id AND mc.occurrence_date=?2
  )
))`;
const normalizeTaskInput = (body) => {
  const scheduleType = ['activityDays', 'weekly'].includes(body.scheduleType) ? body.scheduleType : 'oneTime';
  if (scheduleType === 'oneTime') {
    return {
      startsAt: body.startAt ?? body.startsAt,
      endsAt: body.endAt ?? body.endsAt,
      schedule: null
    };
  }
  const activeStartDate = cleanText(body.activeStartDate, 10);
  const activeEndDate = cleanText(body.activeEndDate, 10);
  const dailyStart = cleanText(body.dailyStart, 5);
  const dailyEnd = cleanText(body.dailyEnd, 5);
  const schedule = {
    scheduleType,
    activeStartDate,
    activeEndDate,
    dailyStart,
    dailyEnd,
    refreshDays: Array.isArray(body.refreshDays) ? body.refreshDays.filter(Number.isInteger) : [],
    weekdays: Array.isArray(body.weekdays) ? body.weekdays.filter(Number.isInteger) : []
  };
  return {
    startsAt: `${activeStartDate}T${dailyStart}:00+08:00`,
    endsAt: `${activeEndDate}T${dailyEnd}:00+08:00`,
    schedule
  };
};

const teamPayload = async (env, team) => {
  const members = await env.DB.prepare(
    `SELECT u.id,u.student_id AS studentId,u.name,u.campus,u.track_id AS trackId,u.status,
            u.created_at AS createdAt
       FROM team_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.team_id=?1 ORDER BY tm.joined_at`
  ).bind(team.id).all();
  const captain = members.results.find((member) => member.id === team.captainId) || null;
  return {
    ...team,
    members: members.results,
    memberCount: members.results.length,
    captain,
    isFull: members.results.length >= Number(team.memberLimit)
  };
};

export const handleAdminRoutes = async (request, env, ctx, url) => {
  if (!url.pathname.startsWith('/api/admin/')) return null;
  const auth = await adminUser(request, env);
  if (auth.error) return auth.error;
  const admin = auth.user;
  const route = url.pathname;

  if (route === '/api/admin/password' && request.method === 'PATCH') {
    const body = await readJson(request);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!currentPassword || newPassword.length < 8) {
      return json({ error: '请输入当前密码，新密码至少需要8位' }, 400);
    }
    const account = await env.DB.prepare(
      'SELECT password_hash AS passwordHash FROM users WHERE id=?1 AND role=\'admin\''
    ).bind(admin.id).first();
    if (!account || !await passwordMatches(currentPassword, account.passwordHash)) {
      return json({ error: '当前密码不正确' }, 403);
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash=?1 WHERE id=?2')
        .bind(await hashPassword(newPassword), admin.id),
      audit(env, admin, 'change_password', 'admin', admin.id)
    ]);
    return json({ ok: true });
  }

  if (route === '/api/admin/governance' && request.method === 'GET') {
    await ensureAdminGovernance(env);
    const isPrimary = await requirePrimaryAdmin(env, admin);
    if (!isPrimary) return json({ isPrimary: false });
    const admins = await env.DB.prepare(
      `SELECT id,student_id AS studentId,name,campus,status,created_at AS createdAt
         FROM users WHERE role='admin' ORDER BY created_at`
    ).all();
    const logs = await env.DB.prepare(
      `SELECT a.id,a.actor_id AS actorId,u.name AS actorName,u.student_id AS actorStudentId,
              a.action,a.entity_type AS entityType,a.entity_id AS entityId,
              a.metadata_json AS metadataJson,a.created_at AS createdAt,
              COALESCE(r.status,'visible') AS reviewStatus,r.review_note AS reviewNote
         FROM audit_logs a JOIN users u ON u.id=a.actor_id
         LEFT JOIN admin_action_reviews r ON r.audit_id=a.id
        WHERE u.role='admin' AND a.actor_id<>?1
        ORDER BY a.created_at DESC LIMIT 200`
    ).bind(admin.id).all();
    return json({
      isPrimary: true,
      admins: admins.results,
      logs: logs.results.map((item) => {
        try { item.metadata = JSON.parse(item.metadataJson || '{}'); } catch { item.metadata = {}; }
        delete item.metadataJson;
        return item;
      })
    });
  }

  if (route === '/api/admin/admins' && request.method === 'POST') {
    if (!await requirePrimaryAdmin(env, admin)) return json({ error: '仅最高管理员可以创建管理员账号' }, 403);
    const body = await readJson(request);
    const studentId = cleanText(body.studentId, 40);
    const name = cleanText(body.name, 50);
    const campus = cleanText(body.campus || '金山学院', 50);
    const password = String(body.password || '');
    if (!studentId || !name || password.length < 8) return json({ error: '账号、姓名和至少8位密码均为必填' }, 400);
    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO users(id,student_id,name,password_hash,role,campus,track_id,status,created_at)
           VALUES(?1,?2,?3,?4,'admin',?5,'health','active',?6)`
        ).bind(id, studentId, name, await hashPassword(password), campus, nowIso()),
        audit(env, admin, 'create_admin', 'admin', id, { studentId, name })
      ]);
    } catch {
      return json({ error: '管理员账号已存在' }, 409);
    }
    return json({ ok: true, admin: { id, studentId, name, campus, status: 'active' } }, 201);
  }

  const rejectAuditMatch = route.match(/^\/api\/admin\/governance\/([^/]+)\/reject$/);
  if (rejectAuditMatch && request.method === 'POST') {
    if (!await requirePrimaryAdmin(env, admin)) return json({ error: '仅最高管理员可以驳回管理员操作' }, 403);
    await ensureAdminGovernance(env);
    const auditId = decodeURIComponent(rejectAuditMatch[1]);
    const body = await readJson(request);
    const record = await env.DB.prepare(
      `SELECT a.id,a.actor_id AS actorId,a.action,a.entity_type AS entityType,a.entity_id AS entityId
         FROM audit_logs a JOIN users u ON u.id=a.actor_id
        WHERE a.id=?1 AND u.role='admin' AND a.actor_id<>?2`
    ).bind(auditId, admin.id).first();
    if (!record) return json({ error: '操作记录不存在或不能驳回' }, 404);
    const statements = [];
    const objectKeys = [];
    if (record.action === 'makeup' && record.entityType === 'checkin') {
      const files = await env.DB.prepare('SELECT object_key AS objectKey FROM checkin_files WHERE checkin_id=?1')
        .bind(record.entityId).all();
      objectKeys.push(...files.results.map((item) => item.objectKey));
      statements.push(env.DB.prepare('DELETE FROM checkins WHERE id=?1').bind(record.entityId));
    } else if (record.action === 'makeup' && record.entityType === 'member_checkin') {
      const item = await env.DB.prepare('SELECT object_key AS objectKey FROM member_checkins WHERE id=?1')
        .bind(record.entityId).first();
      if (item?.objectKey) objectKeys.push(item.objectKey);
      statements.push(env.DB.prepare('DELETE FROM member_checkins WHERE id=?1').bind(record.entityId));
    } else if (['approved', 'returned'].includes(record.action) && record.entityType === 'submission') {
      statements.push(env.DB.prepare(
        "UPDATE task_submissions SET status='submitted',review_note='',reviewed_at=NULL,updated_at=?1 WHERE id=?2"
      ).bind(nowIso(), record.entityId));
    } else if (['approved', 'returned'].includes(record.action) && record.entityType === 'material_submission') {
      statements.push(env.DB.prepare(
        "UPDATE material_submissions SET status='submitted',review_note='',updated_at=?1 WHERE id=?2"
      ).bind(nowIso(), record.entityId));
    } else {
      return json({ error: '该操作只能查看，不能自动驳回' }, 409);
    }
    statements.push(env.DB.prepare(
      `INSERT INTO admin_action_reviews(audit_id,status,reviewed_by,reviewed_at,review_note)
       VALUES(?1,'rejected',?2,?3,?4)
       ON CONFLICT(audit_id) DO UPDATE SET status='rejected',reviewed_by=excluded.reviewed_by,
       reviewed_at=excluded.reviewed_at,review_note=excluded.review_note`
    ).bind(auditId, admin.id, nowIso(), cleanText(body.note || '最高管理员驳回', 300)));
    statements.push(audit(env, admin, 'reject_admin_action', 'audit', auditId, { actorId: record.actorId }));
    await env.DB.batch(statements);
    if (objectKeys.length) ctx.waitUntil(Promise.all(objectKeys.map((key) => env.UPLOADS.delete(key))));
    return json({ ok: true });
  }

  if ((route === '/api/admin/overview' || route === '/api/admin/dashboard') && request.method === 'GET') {
    await ensureMakeupPermissions(env);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '')
      ? url.searchParams.get('date') : shanghaiDate();
    const metrics = await env.DB.prepare(
      `SELECT
       (SELECT COUNT(*) FROM users WHERE role='student') AS users,
       (SELECT COUNT(*) FROM teams) AS teams,
       ((SELECT COUNT(*) FROM checkins WHERE checkin_date=?1)
        +(SELECT COUNT(*) FROM task_submissions WHERE occurrence_date=?1 AND status!='draft')
        +(SELECT COUNT(*) FROM member_checkins WHERE occurrence_date=?1)) AS todaySubmissions,
       (SELECT COUNT(*) FROM plaza_posts WHERE status='visible') AS publicPosts,
       (SELECT COUNT(*) FROM plaza_likes) AS likes,
       (SELECT COUNT(*) FROM plaza_views) AS views`
    ).bind(date).first();
    if (route === '/api/admin/overview') return json({
      userCount: Number(metrics.users),
      teamCount: Number(metrics.teams),
      todaySubmissions: Number(metrics.todaySubmissions),
      publicPostCount: Number(metrics.publicPosts),
      likeCount: Number(metrics.likes),
      viewCount: Number(metrics.views)
    });
    const users = await env.DB.prepare(
      `SELECT ${safeUserColumns},
        CASE WHEN track_id='health' THEN (
          SELECT COUNT(*) FROM (
            SELECT c.checkin_date FROM checkins c WHERE c.user_id=users.id
            GROUP BY c.checkin_date HAVING COUNT(DISTINCT c.slot_id)>=3
          )
        ) ELSE (
          SELECT COUNT(DISTINCT mc.occurrence_date) FROM member_checkins mc WHERE mc.user_id=users.id
        ) END AS totalCompletedDays,
        EXISTS(SELECT 1 FROM makeup_permissions mp
          WHERE mp.user_id=users.id AND mp.checkin_date=?1 AND mp.enabled=1) AS makeupAllowed
       FROM users WHERE role='student' ORDER BY student_id`
    ).bind(date).all();
    const checkins = await env.DB.prepare(
      `SELECT c.id,c.user_id AS userId,c.checkin_date AS date,c.slot_id AS slotId,c.note,c.status,
              c.submitted_at AS submittedAt,c.review_note AS reviewNote,
              (SELECT GROUP_CONCAT('/api/files/' || f.id, '|') FROM checkin_files f
                WHERE f.checkin_id=c.id AND f.kind='photo') AS photoUrls
         FROM checkins c WHERE c.checkin_date=?1 ORDER BY c.submitted_at`
    ).bind(date).all();
    const memberCheckins = await env.DB.prepare(
      `SELECT mc.id,mc.user_id AS userId,mc.task_id AS taskId,mc.occurrence_date AS date,
              mc.status,mc.submitted_at AS submittedAt,t.name AS taskName
         FROM member_checkins mc JOIN tasks t ON t.id=mc.task_id
        WHERE mc.occurrence_date=?1 ORDER BY mc.submitted_at`
    ).bind(date).all();
    const config = await readConfig(env);
    return json({
      date,
      config,
      students: users.results.map((student) => {
        const slots = config.slots.map((slot) =>
          (() => {
            const checkin = checkins.results.find((item) => item.userId === student.id && item.slotId === slot.id);
            return checkin ? { ...checkin, photos: checkin.photoUrls ? checkin.photoUrls.split('|') : [] } : null;
          })());
        const interactionCheckins = memberCheckins.results
          .filter((item) => item.userId === student.id)
          .map((item) => ({ ...item, photos: [`/api/files/${item.id}`], note: item.taskName }));
        return {
          ...student,
          totalCompletedDays: Number(student.totalCompletedDays),
          makeupAllowed: Boolean(student.makeupAllowed),
          slots,
          interactionCheckins,
          completed: student.trackId === 'health'
            ? slots.filter(Boolean).length === config.slots.length
            : interactionCheckins.length > 0
        };
      })
    });
  }

  if (route === '/api/admin/users' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 48)));
    const query = cleanText(url.searchParams.get('q'), 60);
    const completion = ['completed', 'missing'].includes(url.searchParams.get('completion'))
      ? url.searchParams.get('completion') : 'all';
    const track = ['health', 'interaction'].includes(url.searchParams.get('track'))
      ? url.searchParams.get('track') : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '')
      ? url.searchParams.get('date') : new Date().toISOString().slice(0, 10);
    const search = `%${query}%`;
    const completionSql = completion === 'completed'
      ? `AND ${completionExpression}`
      : completion === 'missing'
        ? `AND NOT ${completionExpression}`
        : '';
    const trackSql = track ? `AND u.track_id='${track}'` : '';
    const where = `u.role='student' AND (?1='' OR u.name LIKE ?3 OR u.student_id LIKE ?3) ${trackSql} ${completionSql}`;
    const { results } = await env.DB.prepare(
      `SELECT u.id,u.student_id AS studentId,u.name,u.role,u.campus,u.track_id AS trackId,
        u.status,u.created_at AS createdAt,
        ${completionExpression} AS completed,
        CASE WHEN u.track_id='health'
          THEN (SELECT MAX(c.submitted_at) FROM checkins c WHERE c.user_id=u.id AND c.checkin_date=?2)
          ELSE (SELECT MAX(mc.submitted_at) FROM member_checkins mc WHERE mc.user_id=u.id AND mc.occurrence_date=?2)
        END AS submittedAt,
        CASE WHEN u.track_id='health' THEN (
          SELECT COUNT(*) FROM (
            SELECT c.checkin_date FROM checkins c WHERE c.user_id=u.id
            GROUP BY c.checkin_date HAVING COUNT(DISTINCT c.slot_id)>=3
          )
        ) ELSE (
          SELECT COUNT(DISTINCT mc.occurrence_date) FROM member_checkins mc WHERE mc.user_id=u.id
        ) END AS totalCompletedDays,
        t.name AS teamName
       FROM users u
       LEFT JOIN team_members tm ON tm.user_id=u.id
       LEFT JOIN teams t ON t.id=tm.team_id
       WHERE ${where}
       ORDER BY u.name,u.student_id LIMIT ?4 OFFSET ?5`
    ).bind(query, date, search, limit, (page - 1) * limit).all();
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`)
      .bind(query, date, search).first();
    return json({ users: results, tracks: TRACKS, page, limit, total: Number(count.total) });
  }

  if (route === '/api/admin/users' && request.method === 'POST') {
    const body = await readJson(request);
    const studentId = cleanText(body.studentId, 40);
    const name = cleanText(body.name, 50);
    const campus = cleanText(body.campus, 50);
    const trackId = cleanText(body.trackId, 20);
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    const password = String(body.password || '');
    if (!studentId || !name || !campus || !validTrack(trackId) || password.length < 8) {
      return json({ error: '姓名、学号、校区、赛道和至少 8 位初始密码均为必填' }, 400);
    }
    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO users
            (id,student_id,name,password_hash,role,campus,track_id,status,created_at)
           VALUES (?1,?2,?3,?4,'student',?5,?6,?7,?8)`
        ).bind(id, studentId, name, await hashPassword(password), campus, trackId, status, nowIso()),
        audit(env, admin, 'create', 'user', id, { studentId })
      ]);
    } catch {
      return json({ error: '学号已存在' }, 409);
    }
    return json({ ok: true, user: { id, studentId, name, campus, trackId, status } }, 201);
  }

  if (route === '/api/admin/users/import' && request.method === 'POST') {
    const body = await readJson(request);
    const rows = await readWorkbookRows(body.file, {
      name: ['\u59d3\u540d', 'name'],
      studentId: ['\u5b66\u53f7', 'studentid', 'student_id'],
      campus: ['\u6821\u533a', 'campus'],
      trackId: ['\u6240\u5c5e\u8d5b\u9053', '\u8d5b\u9053', 'track', 'trackid'],
      status: ['\u8d26\u53f7\u72b6\u6001', '\u72b6\u6001', 'status'],
      password: ['\u521d\u59cb\u5bc6\u7801', '\u5bc6\u7801', 'password']
    }, ['name', 'studentId', 'campus', 'trackId', 'password']);
    const existing = await env.DB.prepare("SELECT student_id AS studentId FROM users").all();
    const used = new Set(existing.results.map((item) => item.studentId));
    const errors = [];
    const prepared = [];
    for (const row of rows) {
      const studentId = cleanText(row.studentId, 40);
      const name = cleanText(row.name, 50);
      const campus = cleanText(row.campus, 50);
      const trackId = ['interaction', '\u56db\u6821\u533a\u4e92\u52a8\u8d5b\u9053', '\u56db\u6821\u533a'].includes(row.trackId) ? 'interaction'
        : ['health', '\u81ea\u5f8b\u5065\u5eb7\u8d5b\u9053', '\u81ea\u5f8b\u5065\u5eb7'].includes(row.trackId) ? 'health' : '';
      const password = String(row.password || '');
      if (!studentId || !name || !campus || !trackId || password.length < 6 || used.has(studentId)) {
        errors.push(`第 ${row.rowNumber} 行信息无效或学号重复`);
        continue;
      }
      used.add(studentId);
      prepared.push({
        id: crypto.randomUUID(), studentId, name, campus, trackId,
        status: ['disabled', '\u7981\u7528'].includes(row.status) ? 'disabled' : 'active',
        passwordHash: await hashPassword(password)
      });
    }
    if (errors.length) return json({ error: errors.slice(0, 20).join('\n') }, 400);
    if (!prepared.length) return json({ error: 'Excel 中没有有效用户' }, 400);
    const createdAt = nowIso();
    await env.DB.batch([
      ...prepared.map((user) => env.DB.prepare(
        `INSERT INTO users
          (id,student_id,name,password_hash,role,campus,track_id,status,created_at)
         VALUES (?1,?2,?3,?4,'student',?5,?6,?7,?8)`
      ).bind(user.id, user.studentId, user.name, user.passwordHash, user.campus,
        user.trackId, user.status, createdAt)),
      audit(env, admin, 'import', 'users', null, { count: prepared.length })
    ]);
    return json({ ok: true, imported: prepared.length }, 201);
  }

  const makeupPermissionMatch = route.match(/^\/api\/admin\/users\/([^/]+)\/makeup-permission$/);
  if (makeupPermissionMatch && ['GET', 'PUT'].includes(request.method)) {
    await ensureMakeupPermissions(env);
    const userId = decodeURIComponent(makeupPermissionMatch[1]);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '')
      ? url.searchParams.get('date') : shanghaiDate();
    const target = await env.DB.prepare(
      "SELECT id FROM users WHERE id=?1 AND role='student'"
    ).bind(userId).first();
    if (!target) return json({ error: '用户不存在' }, 404);
    if (request.method === 'GET') {
      const permission = await env.DB.prepare(
        'SELECT enabled FROM makeup_permissions WHERE user_id=?1 AND checkin_date=?2'
      ).bind(userId, date).first();
      return json({ userId, date, enabled: Boolean(permission?.enabled) });
    }
    const body = await readJson(request);
    const enabled = Boolean(body.enabled);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO makeup_permissions (user_id,checkin_date,enabled,created_by,updated_at)
         VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(user_id,checkin_date) DO UPDATE SET
          enabled=excluded.enabled,created_by=excluded.created_by,updated_at=excluded.updated_at`
      ).bind(userId, date, enabled ? 1 : 0, admin.id, nowIso()),
      audit(env, admin, enabled ? 'enable_makeup' : 'disable_makeup', 'user', userId, { date })
    ]);
    return json({ ok: true, userId, date, enabled });
  }

  const adminMakeupMatch = route.match(/^\/api\/admin\/users\/([^/]+)\/makeup$/);
  if (adminMakeupMatch && request.method === 'POST') {
    const userId = decodeURIComponent(adminMakeupMatch[1]);
    const target = await env.DB.prepare(
      "SELECT id,track_id AS trackId FROM users WHERE id=?1 AND role='student'"
    ).bind(userId).first();
    if (!target) return json({ error: '用户不存在' }, 404);
    const body = await readJson(request);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : shanghaiDate();
    if (target.trackId === 'health') {
      const config = await readConfig(env);
      const slot = config.slots.find((item) => item.id === body.slotId);
      if (!slot) return json({ error: '请选择早餐、午餐或晚餐' }, 400);
      const uploaded = await uploadImages(env, body.photos || body.images, `admin-makeup/checkins/${userId}/${date}/${slot.id}`, 3);
      const existing = await env.DB.prepare(
        'SELECT id FROM checkins WHERE user_id=?1 AND checkin_date=?2 AND slot_id=?3'
      ).bind(userId, date, slot.id).first();
      const id = existing?.id || crypto.randomUUID();
      const oldFiles = existing ? await env.DB.prepare(
        'SELECT object_key AS objectKey FROM checkin_files WHERE checkin_id=?1'
      ).bind(id).all() : { results: [] };
      const statements = [
        env.DB.prepare(
          `INSERT INTO checkins
            (id,user_id,checkin_date,slot_id,note,status,submitted_at,review_note,version,reviewed_by,reviewed_at)
           VALUES (?1,?2,?3,?4,?5,'approved',?6,'管理员补卡',1,?7,?6)
           ON CONFLICT(user_id,checkin_date,slot_id) DO UPDATE SET
            note=excluded.note,status='approved',submitted_at=excluded.submitted_at,
            review_note='管理员补卡',reviewed_by=excluded.reviewed_by,
            reviewed_at=excluded.reviewed_at,version=checkins.version+1`
        ).bind(id, userId, date, slot.id, cleanText(body.note, 300), nowIso(), admin.id),
        env.DB.prepare('DELETE FROM checkin_files WHERE checkin_id=?1').bind(id)
      ];
      uploaded.forEach((file) => statements.push(env.DB.prepare(
        `INSERT INTO checkin_files
          (id,checkin_id,object_key,content_type,bytes,kind,sort_order,created_at)
         VALUES (?1,?2,?3,?4,?5,'photo',?6,?7)`
      ).bind(file.id, id, file.key, file.contentType, file.bytes, file.sortOrder, nowIso())));
      statements.push(audit(env, admin, 'makeup', 'checkin', id, { userId, date, slotId: slot.id }));
      await env.DB.batch(statements);
      ctx.waitUntil(Promise.all(oldFiles.results.map((file) => env.UPLOADS.delete(file.objectKey))));
      return json({ ok: true, id, trackId: target.trackId });
    }
    const taskId = cleanText(body.taskId, 80);
    const [task, team] = await Promise.all([
      env.DB.prepare("SELECT id FROM tasks WHERE id=?1 AND track_id='interaction'").bind(taskId).first(),
      env.DB.prepare(
        'SELECT t.id FROM teams t JOIN team_members tm ON tm.team_id=t.id WHERE tm.user_id=?1'
      ).bind(userId).first()
    ]);
    if (!task) return json({ error: '请选择廿载同心赛道任务' }, 400);
    if (!team) return json({ error: '该用户尚未分配队伍' }, 409);
    const uploaded = await uploadImages(env, body.photos || body.images, `admin-makeup/member-checkins/${taskId}/${userId}`, 1);
    const existing = await env.DB.prepare(
      'SELECT id,object_key AS objectKey FROM member_checkins WHERE task_id=?1 AND occurrence_date=?2 AND user_id=?3'
    ).bind(taskId, date, userId).first();
    const id = existing?.id || crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO member_checkins
          (id,task_id,occurrence_date,user_id,team_id,object_key,content_type,bytes,status,submitted_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'approved',?9)
         ON CONFLICT(task_id,occurrence_date,user_id) DO UPDATE SET
          team_id=excluded.team_id,object_key=excluded.object_key,
          content_type=excluded.content_type,bytes=excluded.bytes,status='approved',
          submitted_at=excluded.submitted_at`
      ).bind(id, taskId, date, userId, team.id, uploaded[0].key,
        uploaded[0].contentType, uploaded[0].bytes, nowIso()),
      audit(env, admin, 'makeup', 'member_checkin', id, { userId, date, taskId })
    ]);
    if (existing?.objectKey) ctx.waitUntil(env.UPLOADS.delete(existing.objectKey));
    return json({ ok: true, id, trackId: target.trackId });
  }

  const userMatch = route.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && request.method === 'PUT') {
    const id = decodeURIComponent(userMatch[1]);
    const current = await env.DB.prepare(`SELECT ${safeUserColumns} FROM users WHERE id=?1 AND role='student'`).bind(id).first();
    if (!current) return json({ error: '用户不存在' }, 404);
    const body = await readJson(request);
    const studentId = cleanText(body.studentId ?? current.studentId, 40);
    const name = cleanText(body.name ?? current.name, 50);
    const campus = cleanText(body.campus ?? current.campus, 50);
    const trackId = cleanText(body.trackId ?? current.trackId, 20);
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    if (!studentId || !name || !campus || !validTrack(trackId)) return json({ error: '用户资料不完整' }, 400);
    const statements = [
      env.DB.prepare(
        'UPDATE users SET student_id=?1,name=?2,campus=?3,track_id=?4,status=?5 WHERE id=?6'
      ).bind(studentId, name, campus, trackId, status, id),
      audit(env, admin, 'update', 'user', id)
    ];
    if (body.password) {
      if (String(body.password).length < 8) return json({ error: '密码至少 8 位' }, 400);
      statements.unshift(env.DB.prepare('UPDATE users SET password_hash=?1 WHERE id=?2')
        .bind(await hashPassword(body.password), id));
    }
    try {
      await env.DB.batch(statements);
    } catch {
      return json({ error: '学号已存在' }, 409);
    }
    return json({ ok: true });
  }

  const statusMatch = route.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (statusMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!['active', 'disabled'].includes(body.status)) return json({ error: '状态无效' }, 400);
    const id = decodeURIComponent(statusMatch[1]);
    const result = await env.DB.batch([
      env.DB.prepare("UPDATE users SET status=?1 WHERE id=?2 AND role='student'").bind(body.status, id),
      audit(env, admin, 'status', 'user', id, { status: body.status })
    ]);
    return result[0].meta.changes ? json({ ok: true }) : json({ error: '用户不存在' }, 404);
  }

  if (route === '/api/admin/team-capacity' && request.method === 'PATCH') {
    const body = await readJson(request);
    const maxTeams = Number(body.maxTeams);
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM teams').first();
    if (!Number.isInteger(maxTeams) || maxTeams < Number(count.total) || maxTeams > 500) {
      return json({ error: '名额必须是当前队伍数到 500 之间的整数' }, 400);
    }
    await env.DB.batch([putConfig(env, 'maxTeams', maxTeams), audit(env, admin, 'capacity', 'teams', null, { maxTeams })]);
    return json({ ok: true, maxTeams });
  }

  if (route === '/api/admin/teams' && request.method === 'GET') {
    const config = await readConfig(env);
    const { results } = await env.DB.prepare(
      `SELECT id,name,invite_code AS inviteCode,member_limit AS memberLimit,
              captain_user_id AS captainId,created_at AS createdAt
         FROM teams ORDER BY created_at`
    ).all();
    const teams = [];
    for (const team of results) teams.push(await teamPayload(env, team));
    return json({ maxTeams: config.maxTeams, teamCount: teams.length, teams });
  }

  if (route === '/api/admin/teams' && request.method === 'POST') {
    const body = await readJson(request);
    const name = cleanText(body.name, 80);
    const memberLimit = Number(body.memberLimit || 4);
    const config = await readConfig(env);
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM teams').first();
    if (Number(count.total) >= config.maxTeams) return json({ error: '队伍名额已满' }, 409);
    if (!name || !Number.isInteger(memberLimit) || memberLimit < 1 || memberLimit > 20) {
      return json({ error: '队伍名称或人数限制无效' }, 400);
    }
    const id = crypto.randomUUID();
    const inviteCode = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    try {
      const created = await env.DB.prepare(
        `INSERT INTO teams (id,name,invite_code,member_limit,captain_user_id,created_at)
         SELECT ?1,?2,?3,?4,NULL,?5
         WHERE (SELECT COUNT(*) FROM teams)
           < CAST((SELECT value_json FROM app_config WHERE key='maxTeams') AS INTEGER)`
      ).bind(id, name, inviteCode, memberLimit, nowIso()).run();
      if (!created.meta.changes) return json({ error: '队伍名额已满' }, 409);
      await env.DB.batch([audit(env, admin, 'create', 'team', id)]);
    } catch {
      return json({ error: '队伍名称或邀请码冲突' }, 409);
    }
    return json({ ok: true, team: { id, name, inviteCode, memberLimit } }, 201);
  }

  if (route === '/api/admin/teams/import' && request.method === 'POST') {
    const body = await readJson(request);
    const rows = await readWorkbookRows(body.file, {
      teamName: ['\u961f\u4f0d\u540d\u79f0', '\u961f\u540d', 'team', 'teamname'],
      memberLimit: ['\u4eba\u6570\u9650\u5236', '\u4eba\u6570\u4e0a\u9650', 'memberlimit'],
      studentId: ['\u5b66\u53f7', '\u6210\u5458\u5b66\u53f7', 'studentid'],
      captainStudentId: ['\u961f\u957f\u5b66\u53f7', 'captain', 'captainstudentid'],
      member1: ['\u6210\u54581', '\u6210\u54581\u5b66\u53f7', 'member1'],
      member2: ['\u6210\u54582', '\u6210\u54582\u5b66\u53f7', 'member2'],
      member3: ['\u6210\u54583', '\u6210\u54583\u5b66\u53f7', 'member3'],
      member4: ['\u6210\u54584', '\u6210\u54584\u5b66\u53f7', 'member4']
    }, ['teamName']);
    const [users, existingTeams, existingMembers, config] = await Promise.all([
      env.DB.prepare("SELECT id,student_id AS studentId,track_id AS trackId FROM users WHERE role='student'").all(),
      env.DB.prepare('SELECT name FROM teams').all(),
      env.DB.prepare('SELECT user_id AS userId FROM team_members').all(),
      readConfig(env)
    ]);
    const userByStudentId = new Map(users.results.map((user) => [user.studentId, user]));
    const usedNames = new Set(existingTeams.results.map((team) => team.name.toLowerCase()));
    const assigned = new Set(existingMembers.results.map((member) => member.userId));
    const groups = new Map();
    for (const row of rows) {
      const name = cleanText(row.teamName, 80);
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, { name, memberLimit: 4, studentIds: [], captainStudentId: '' });
      const group = groups.get(name);
      const limit = Number(row.memberLimit || 4);
      if (Number.isInteger(limit) && limit >= 1 && limit <= 20) group.memberLimit = limit;
      group.studentIds.push(...[row.studentId, row.member1, row.member2, row.member3, row.member4].filter(Boolean));
      if (row.captainStudentId) group.captainStudentId = row.captainStudentId;
    }
    const errors = [];
    if (existingTeams.results.length + groups.size > Number(config.maxTeams)) errors.push('导入后队伍数量超过当前名额');
    const prepared = [];
    for (const group of groups.values()) {
      group.studentIds = [...new Set(group.studentIds)];
      if (usedNames.has(group.name.toLowerCase())) errors.push(`队伍“${group.name}”已存在`);
      if (!group.studentIds.length || group.studentIds.length > group.memberLimit) errors.push(`队伍“${group.name}”人数无效`);
      const members = [];
      for (const studentId of group.studentIds) {
        const user = userByStudentId.get(studentId);
        if (!user || user.trackId !== 'interaction' || assigned.has(user?.id)) {
          errors.push(`学号 ${studentId} 不存在、不属于四校区赛道或已在其他队伍`);
        } else {
          assigned.add(user.id);
          members.push(user);
        }
      }
      const captain = group.captainStudentId
        ? members.find((member) => member.studentId === group.captainStudentId) : null;
      if (group.captainStudentId && !captain) errors.push(`队伍“${group.name}”的队长必须属于本队`);
      prepared.push({ ...group, id: crypto.randomUUID(), members, captainId: captain?.id || null });
      usedNames.add(group.name.toLowerCase());
    }
    if (errors.length) return json({ error: errors.slice(0, 30).join('\n') }, 400);
    const createdAt = nowIso();
    const statements = [];
    for (const team of prepared) {
      statements.push(env.DB.prepare(
        `INSERT INTO teams (id,name,invite_code,member_limit,captain_user_id,created_at)
         VALUES (?1,?2,?3,?4,?5,?6)`
      ).bind(team.id, team.name, crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(),
        team.memberLimit, team.captainId, createdAt));
      for (const member of team.members) {
        statements.push(env.DB.prepare(
          'INSERT INTO team_members (team_id,user_id,joined_at) VALUES (?1,?2,?3)'
        ).bind(team.id, member.id, createdAt));
      }
    }
    statements.push(audit(env, admin, 'import', 'teams', null, { count: prepared.length }));
    await env.DB.batch(statements);
    return json({
      ok: true,
      importedTeams: prepared.length,
      importedMembers: prepared.reduce((sum, team) => sum + team.members.length, 0)
    }, 201);
  }

  const teamMatch = route.match(/^\/api\/admin\/teams\/([^/]+)$/);
  if (teamMatch && request.method === 'PUT') {
    const id = decodeURIComponent(teamMatch[1]);
    const body = await readJson(request);
    const name = cleanText(body.name, 80);
    const memberLimit = Number(body.memberLimit);
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id=?1').bind(id).first();
    if (!name || !Number.isInteger(memberLimit) || memberLimit < Number(count.total) || memberLimit > 20) {
      return json({ error: '名称或人数限制无效' }, 400);
    }
    try {
      const result = await env.DB.prepare('UPDATE teams SET name=?1,member_limit=?2 WHERE id=?3')
        .bind(name, memberLimit, id).run();
      return result.meta.changes ? json({ ok: true }) : json({ error: '队伍不存在' }, 404);
    } catch {
      return json({ error: '队伍名称已存在' }, 409);
    }
  }

  if (teamMatch && request.method === 'DELETE') {
    const id = decodeURIComponent(teamMatch[1]);
    const team = await env.DB.prepare('SELECT id,name FROM teams WHERE id=?1').bind(id).first();
    if (!team) return json({ error: '队伍不存在或已被解散' }, 404);
    const [members, checkins, submissions, posts] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id=?1').bind(id).first(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM member_checkins WHERE team_id=?1').bind(id).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM task_submissions WHERE owner_type='team' AND owner_id=?1").bind(id).first(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM plaza_posts WHERE team_id=?1').bind(id).first()
    ]);
    const historyCount = Number(checkins.total) + Number(submissions.total) + Number(posts.total);
    if (historyCount) {
      return json({
        error: `队伍存在 ${historyCount} 条打卡、任务或广场历史记录。为保护活动材料，不能直接解散，请先处理或归档相关记录。`
      }, 409);
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE teams SET captain_user_id=NULL WHERE id=?1').bind(id),
      env.DB.prepare('DELETE FROM team_members WHERE team_id=?1').bind(id),
      env.DB.prepare('DELETE FROM teams WHERE id=?1').bind(id),
      audit(env, admin, 'dissolve', 'team', id, { name: team.name, removedMembers: Number(members.total) })
    ]);
    return json({ ok: true, removedMembers: Number(members.total) });
  }

  const addMemberMatch = route.match(/^\/api\/admin\/teams\/([^/]+)\/members$/);
  if (addMemberMatch && request.method === 'POST') {
    const teamId = decodeURIComponent(addMemberMatch[1]);
    const body = await readJson(request);
    const studentId = cleanText(body.studentId, 40);
    const team = await env.DB.prepare('SELECT member_limit AS memberLimit FROM teams WHERE id=?1').bind(teamId).first();
    const user = await env.DB.prepare(
      "SELECT id FROM users WHERE student_id=?1 AND role='student' AND track_id='interaction' AND status='active'"
    ).bind(studentId).first();
    if (!team || !user) return json({ error: '队伍或互动赛道学生不存在' }, 404);
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id=?1').bind(teamId).first();
    if (Number(count.total) >= Number(team.memberLimit)) return json({ error: '队伍已满' }, 409);
    try {
      const inserted = await env.DB.prepare(
        `INSERT INTO team_members (team_id,user_id,joined_at)
         SELECT ?1,?2,?3 WHERE
          (SELECT COUNT(*) FROM team_members WHERE team_id=?1)
          < (SELECT member_limit FROM teams WHERE id=?1)`
      ).bind(teamId, user.id, nowIso()).run();
      if (!inserted.meta.changes) return json({ error: '队伍已满' }, 409);
      return json({ ok: true });
    } catch {
      return json({ error: '该学生已在其他队伍' }, 409);
    }
  }

  const memberMatch = route.match(/^\/api\/admin\/teams\/([^/]+)\/members\/([^/]+)$/);
  if (memberMatch && request.method === 'DELETE') {
    const teamId = decodeURIComponent(memberMatch[1]);
    const userId = decodeURIComponent(memberMatch[2]);
    const membership = await env.DB.prepare(
      'SELECT 1 FROM team_members WHERE team_id=?1 AND user_id=?2'
    ).bind(teamId, userId).first();
    if (!membership) return json({ error: '该成员不在此队伍中，可能已被其他管理员移除' }, 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM team_members WHERE team_id=?1 AND user_id=?2').bind(teamId, userId),
      env.DB.prepare('UPDATE teams SET captain_user_id=NULL WHERE id=?1 AND captain_user_id=?2').bind(teamId, userId),
      audit(env, admin, 'remove_member', 'team', teamId, { userId })
    ]);
    return json({ ok: true });
  }

  const captainMatch = route.match(/^\/api\/admin\/teams\/([^/]+)\/captain$/);
  if (captainMatch && request.method === 'PATCH') {
    const teamId = decodeURIComponent(captainMatch[1]);
    const body = await readJson(request);
    let userId = cleanText(body.userId, 80);
    const studentId = cleanText(body.studentId, 40);
    if (!userId && studentId) {
      const captainUser = await env.DB.prepare('SELECT id FROM users WHERE student_id=?1')
        .bind(studentId).first();
      userId = captainUser?.id || '';
    }
    const member = userId ? await env.DB.prepare(
      'SELECT 1 FROM team_members WHERE team_id=?1 AND user_id=?2'
    ).bind(teamId, userId).first() : true;
    if (!member) return json({ error: '队长必须是本队成员' }, 400);
    await env.DB.prepare('UPDATE teams SET captain_user_id=?1 WHERE id=?2').bind(userId || null, teamId).run();
    return json({ ok: true });
  }

  if (route === '/api/admin/tasks' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
              allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,
              submission_type AS submissionType,status,schedule_json AS scheduleJson,
              created_at AS createdAt,updated_at AS updatedAt
         FROM tasks ORDER BY created_at DESC`
    ).all();
    const submissions = await env.DB.prepare(
      `SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,
              occurrence_date AS occurrenceDate,copy_text AS copy,plaza_copy AS plazaCopy,
              meal_type AS mealType,is_public AS isPublic,status,version,
              submitted_at AS submittedAt,review_note AS reviewNote,updated_at AS updatedAt
         FROM task_submissions ORDER BY updated_at DESC LIMIT 1000`
    ).all();
    for (const submission of submissions.results) {
      const images = await env.DB.prepare(
        'SELECT id FROM task_submission_images WHERE submission_id=?1 ORDER BY sort_order'
      ).bind(submission.id).all();
      submission.images = images.results.map((image) => `/api/files/${image.id}`);
    }
    return json({
      tasks: results.map((item) => ({
        ...item,
        startAt: item.startsAt,
        endAt: item.endsAt,
        allowLate: Boolean(item.allowLate),
        schedule: item.scheduleJson ? JSON.parse(item.scheduleJson) : null,
        ...(item.scheduleJson ? JSON.parse(item.scheduleJson) : { scheduleType: 'oneTime' })
      })),
      submissions: submissions.results
    });
  }

  if (route === '/api/admin/tasks' && request.method === 'POST') {
    const body = await readJson(request);
    const id = crypto.randomUUID();
    const name = cleanText(body.name, 100);
    const trackId = cleanText(body.trackId, 20);
    const status = ['draft', 'published', 'closed', 'archived'].includes(body.status) ? body.status : 'draft';
    const normalized = normalizeTaskInput(body);
    const rawStartsAt = normalized.startsAt;
    const rawEndsAt = normalized.endsAt;
    if (Number.isNaN(Date.parse(rawStartsAt)) || Number.isNaN(Date.parse(rawEndsAt))) {
      return json({ error: '任务开始或截止时间无效' }, 400);
    }
    const startsAt = new Date(rawStartsAt).toISOString();
    const endsAt = new Date(rawEndsAt).toISOString();
    const imageLimit = Math.min(8, Math.max(1, Number(body.imageLimit || 3)));
    if (!name || !validTrack(trackId) || startsAt >= endsAt) return json({ error: '任务信息无效' }, 400);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tasks
          (id,name,description,track_id,starts_at,ends_at,allow_late,image_limit,
           copy_requirement,submission_type,status,schedule_json,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)`
      ).bind(id, name, cleanText(body.description, 2000), trackId, startsAt, endsAt,
        body.allowLate ? 1 : 0, imageLimit, cleanText(body.copyRequirement, 500),
        trackId === 'interaction' ? 'team' : 'user', status,
        normalized.schedule ? JSON.stringify(normalized.schedule) : null, nowIso()),
      audit(env, admin, 'create', 'task', id)
    ]);
    return json({ ok: true, id }, 201);
  }

  const taskMatch = route.match(/^\/api\/admin\/tasks\/([^/]+)$/);
  if (taskMatch && request.method === 'PUT') {
    const id = decodeURIComponent(taskMatch[1]);
    const body = await readJson(request);
    const normalized = normalizeTaskInput(body);
    const rawStartsAt = normalized.startsAt;
    const rawEndsAt = normalized.endsAt;
    if (!cleanText(body.name, 100) || !validTrack(body.trackId)
        || Number.isNaN(Date.parse(rawStartsAt)) || Number.isNaN(Date.parse(rawEndsAt))
        || Date.parse(rawStartsAt) >= Date.parse(rawEndsAt)) {
      return json({ error: '任务信息无效' }, 400);
    }
    const result = await env.DB.prepare(
      `UPDATE tasks SET name=?1,description=?2,track_id=?3,starts_at=?4,ends_at=?5,
        allow_late=?6,image_limit=?7,copy_requirement=?8,submission_type=?9,status=?10,
        schedule_json=?11,updated_at=?12 WHERE id=?13`
    ).bind(cleanText(body.name, 100), cleanText(body.description, 2000), cleanText(body.trackId, 20),
      new Date(rawStartsAt).toISOString(), new Date(rawEndsAt).toISOString(),
      body.allowLate ? 1 : 0, Math.min(8, Math.max(1, Number(body.imageLimit || 3))),
      cleanText(body.copyRequirement, 500), body.trackId === 'interaction' ? 'team' : 'user',
      ['draft', 'published', 'closed', 'archived'].includes(body.status) ? body.status : 'draft',
      normalized.schedule ? JSON.stringify(normalized.schedule) : null, nowIso(), id).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: '任务不存在' }, 404);
  }

  if (route === '/api/admin/activity-switches' && request.method === 'PATCH') {
    const body = await readJson(request);
    const statements = [];
    if (typeof body.activityEnabled === 'boolean') statements.push(putConfig(env, 'activityEnabled', body.activityEnabled));
    if (body.trackEnabled && typeof body.trackEnabled === 'object') {
      statements.push(putConfig(env, 'trackEnabled', {
        interaction: Boolean(body.trackEnabled.interaction),
        health: Boolean(body.trackEnabled.health)
      }));
    }
    if (!statements.length) return json({ error: '没有可更新的开关' }, 400);
    statements.push(audit(env, admin, 'switches', 'config'));
    await env.DB.batch(statements);
    return json({ ok: true, config: await readConfig(env) });
  }

  if (route === '/api/admin/config' && request.method === 'PUT') {
    const body = await readJson(request);
    const allowed = ['activityName', 'startDate', 'endDate', 'slots', 'allowSelfJoin'];
    const statements = allowed.filter((key) => body[key] !== undefined).map((key) => putConfig(env, key, body[key]));
    if (!statements.length) return json({ error: '没有可更新的配置' }, 400);
    await env.DB.batch([...statements, audit(env, admin, 'update', 'config')]);
    return json({ ok: true, config: await readConfig(env) });
  }

  const reviewMatch = route.match(/^\/api\/admin\/submissions\/([^/]+)$/);
  if (reviewMatch && ['PATCH', 'DELETE'].includes(request.method)) {
    const id = decodeURIComponent(reviewMatch[1]);
    const submission = await env.DB.prepare('SELECT id FROM task_submissions WHERE id=?1').bind(id).first();
    if (!submission) return json({ error: '提交不存在' }, 404);
    if (request.method === 'DELETE') {
      const files = await env.DB.prepare('SELECT object_key AS objectKey FROM task_submission_images WHERE submission_id=?1').bind(id).all();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM plaza_posts WHERE submission_id=?1').bind(id),
        env.DB.prepare('DELETE FROM task_submissions WHERE id=?1').bind(id),
        audit(env, admin, 'delete', 'submission', id)
      ]);
      ctx.waitUntil(Promise.all(files.results.map((file) => env.UPLOADS.delete(file.objectKey))));
      return json({ ok: true });
    }
    const body = await readJson(request);
    const status = body.status === 'approved' ? 'approved' : 'returned';
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE task_submissions SET status=?1,review_note=?2,reviewed_at=?3,updated_at=?3 WHERE id=?4'
      ).bind(status, cleanText(body.reviewNote, 500), nowIso(), id),
      audit(env, admin, status, 'submission', id)
    ]);
    return json({ ok: true });
  }

  const checkinMatch = route.match(/^\/api\/admin\/checkins\/([^/]+)$/);
  if (checkinMatch && request.method === 'PUT') {
    const body = await readJson(request);
    const status = body.status === 'approved' ? 'approved' : 'rejected';
    const result = await env.DB.prepare(
      `UPDATE checkins SET status=?1,review_note=?2,reviewed_by=?3,reviewed_at=?4
        WHERE id=?5`
    ).bind(status, cleanText(body.reviewNote, 300), admin.id, nowIso(), decodeURIComponent(checkinMatch[1])).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: '打卡不存在' }, 404);
  }

  if (route === '/api/admin/plaza' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.id,p.submission_id AS submissionId,p.team_id AS teamId,t.name AS teamName,
              task.name AS taskName,
              p.copy_text AS copy,p.status,p.excluded_from_ranking AS excludedFromRanking,
              p.published_at AS publishedAt,
              (SELECT COUNT(*) FROM plaza_likes WHERE post_id=p.id) AS likeCount,
              (SELECT COUNT(*) FROM plaza_views WHERE post_id=p.id) AS viewCount
         FROM plaza_posts p JOIN teams t ON t.id=p.team_id
         JOIN task_submissions s ON s.id=p.submission_id
         JOIN tasks task ON task.id=s.task_id
        ORDER BY p.published_at DESC LIMIT 500`
    ).all();
    for (const post of results) {
      const members = await env.DB.prepare(
        `SELECT u.id,u.name,u.student_id AS studentId FROM team_members tm
          JOIN users u ON u.id=tm.user_id WHERE tm.team_id=?1 ORDER BY tm.joined_at`
      ).bind(post.teamId).all();
      post.members = members.results;
    }
    return json({ posts: results.map((item) => ({ ...item, excludedFromRanking: Boolean(item.excludedFromRanking) })) });
  }

  const plazaMatch = route.match(/^\/api\/admin\/plaza\/([^/]+)$/);
  if (plazaMatch && ['PATCH', 'DELETE'].includes(request.method)) {
    const id = decodeURIComponent(plazaMatch[1]);
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM plaza_posts WHERE id=?1').bind(id).run();
      return json({ ok: true });
    }
    const body = await readJson(request);
    const current = await env.DB.prepare('SELECT status,excluded_from_ranking AS excluded FROM plaza_posts WHERE id=?1').bind(id).first();
    if (!current) return json({ error: '帖子不存在' }, 404);
    await env.DB.prepare(
      'UPDATE plaza_posts SET status=?1,excluded_from_ranking=?2,updated_at=?3 WHERE id=?4'
    ).bind(body.status === 'hidden' ? 'hidden' : body.status === 'visible' ? 'visible' : current.status,
      body.excludedFromRanking === undefined ? current.excluded : body.excludedFromRanking ? 1 : 0,
      nowIso(), id).run();
    return json({ ok: true });
  }

  const exportMatch = route.match(/^\/api\/admin\/exports\/(users|teams|checkins|missing|rankings|materials)$/);
  if (exportMatch && request.method === 'GET') {
    const type = exportMatch[1];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '')
      ? url.searchParams.get('date') : shanghaiDate();
    if (type === 'users') {
      const data = await env.DB.prepare(
        `SELECT student_id AS studentId,name,campus,
          CASE track_id WHEN 'interaction' THEN '四校区互动赛道' ELSE '自律健康赛道' END AS track,
          CASE status WHEN 'active' THEN '正常' ELSE '禁用' END AS status,created_at AS createdAt
         FROM users WHERE role='student' ORDER BY campus,student_id`
      ).all();
      return excelResponse('用户名单.xlsx', [
        { header: '学号', key: 'studentId', text: true }, { header: '姓名', key: 'name' },
        { header: '校区', key: 'campus' }, { header: '所属赛道', key: 'track' },
        { header: '账号状态', key: 'status' }, { header: '创建时间', key: 'createdAt' }
      ], data.results);
    }
    if (type === 'teams') {
      const data = await env.DB.prepare(
        `SELECT t.name AS teamName,t.member_limit AS memberLimit,
          u.student_id AS studentId,u.name AS memberName,
          CASE WHEN t.captain_user_id=u.id THEN '是' ELSE '否' END AS captain
         FROM teams t LEFT JOIN team_members tm ON tm.team_id=t.id
         LEFT JOIN users u ON u.id=tm.user_id ORDER BY t.name,tm.joined_at`
      ).all();
      return excelResponse('队伍名单.xlsx', [
        { header: '队伍名称', key: 'teamName' }, { header: '人数限制', key: 'memberLimit' },
        { header: '成员学号', key: 'studentId', text: true }, { header: '成员姓名', key: 'memberName' },
        { header: '是否队长', key: 'captain' }
      ], data.results);
    }
    if (type === 'checkins') {
      const data = await env.DB.prepare(
        `SELECT c.checkin_date AS date,c.slot_id AS slotId,u.student_id AS studentId,
          u.name,u.campus,c.status,c.submitted_at AS submittedAt,c.review_note AS reviewNote
         FROM checkins c JOIN users u ON u.id=c.user_id
         WHERE c.checkin_date=?1 ORDER BY u.campus,u.student_id,c.slot_id`
      ).bind(date).all();
      return excelResponse(`打卡记录-${date}.xlsx`, [
        { header: '日期', key: 'date' }, { header: '时段', key: 'slotId' },
        { header: '学号', key: 'studentId', text: true }, { header: '姓名', key: 'name' },
        { header: '校区', key: 'campus' }, { header: '状态', key: 'status' },
        { header: '提交时间', key: 'submittedAt' }, { header: '审核意见', key: 'reviewNote' }
      ], data.results);
    }
    if (type === 'missing') {
      const config = await readConfig(env);
      const slots = Array.isArray(config.slots) ? config.slots : [];
      const users = await env.DB.prepare(
        `SELECT id,student_id AS studentId,name,campus FROM users
         WHERE role='student' AND status='active' AND track_id='health' ORDER BY campus,student_id`
      ).all();
      const done = await env.DB.prepare(
        'SELECT user_id AS userId,slot_id AS slotId FROM checkins WHERE checkin_date=?1'
      ).bind(date).all();
      const keys = new Set(done.results.map((item) => `${item.userId}:${item.slotId}`));
      const rows = users.results.flatMap((user) => slots
        .filter((slot) => !keys.has(`${user.id}:${slot.id}`))
        .map((slot) => ({ ...user, date, slot: slot.label || slot.id })));
      return excelResponse(`缺卡名单-${date}.xlsx`, [
        { header: '日期', key: 'date' }, { header: '学号', key: 'studentId', text: true },
        { header: '姓名', key: 'name' }, { header: '校区', key: 'campus' },
        { header: '缺卡时段', key: 'slot' }
      ], rows);
    }
    if (type === 'rankings') {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '')
        ? url.searchParams.get('month') : shanghaiDate().slice(0, 7);
      const ranking = await calculateRankings(env, 'month', month);
      return excelResponse(`排行榜-${month}.xlsx`, [
        { header: '排名', key: 'rank' }, { header: '队伍', key: 'teamName' },
        { header: '公开次数', key: 'publicCount' }, { header: '点赞数', key: 'likes' },
        { header: '浏览数', key: 'views' }, { header: '综合热度', key: 'score' }
      ], ranking.teams || []);
    }
    const data = await env.DB.prepare(
      `SELECT mt.title,ms.owner_type AS ownerType,ms.owner_id AS ownerId,
        ms.status,ms.submitted_at AS submittedAt,ms.summary
       FROM material_submissions ms JOIN material_tasks mt ON mt.id=ms.task_id
       ORDER BY mt.title,ms.submitted_at`
    ).all();
    return excelResponse('材料清单.xlsx', [
      { header: '任务', key: 'title' }, { header: '提交类型', key: 'ownerType' },
      { header: '提交者ID', key: 'ownerId', text: true }, { header: '状态', key: 'status' },
      { header: '提交时间', key: 'submittedAt' }, { header: '总结', key: 'summary' }
    ], data.results);
  }

  if (route === '/api/admin/rankings/freeze' && request.method === 'POST') {
    const body = await readJson(request);
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : null;
    if (!month) return json({ error: '月份格式错误' }, 400);
    const ranking = await calculateRankings(env, 'month', month);
    if (ranking.frozen) return json({ error: '该月排名已冻结' }, 409);
    try {
      await env.DB.prepare(
        'INSERT INTO ranking_freezes (period,snapshot_json,frozen_by,frozen_at) VALUES (?1,?2,?3,?4)'
      ).bind(month, JSON.stringify(ranking), admin.id, nowIso()).run();
    } catch {
      return json({ error: '该月排名已冻结' }, 409);
    }
    return json({ ok: true, ranking: { ...ranking, frozen: true } });
  }

  if (route === '/api/admin/rankings/export' && request.method === 'GET') {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '')
      ? url.searchParams.get('month') : shanghaiDate().slice(0, 7);
    const ranking = await calculateRankings(env, 'month', month);
    return excelResponse(`月度排行榜-${month}.xlsx`, [
      { header: '排名', key: 'rank' }, { header: '队伍', key: 'teamName' },
      { header: '公开次数', key: 'publicCount' }, { header: '点赞数', key: 'likes' },
      { header: '浏览数', key: 'views' }, { header: '综合热度', key: 'score' }
    ], ranking.teams || []);
  }

  return null;
};
