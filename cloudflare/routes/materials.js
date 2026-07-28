import {
  audit,
  cleanText,
  json,
  nowIso,
  parseJson,
  readJson,
  requireUser,
  shanghaiDate,
  claimConfirmedMedia
} from '../lib/runtime.js';
import { excelResponse } from '../lib/excel.js';

const teamForUser = (env, userId) => env.DB.prepare(
  `SELECT t.id,t.name FROM teams t JOIN team_members tm ON tm.team_id=t.id
    WHERE tm.user_id=?1 LIMIT 1`
).bind(userId).first();

const ownerForTask = async (env, user, task) => {
  if (task.ownerType === 'team') {
    const team = await teamForUser(env, user.id);
    if (!team) throw Object.assign(new Error('尚未分配队伍'), { status: 403 });
    return { type: 'team', id: team.id };
  }
  return { type: 'user', id: user.id };
};

const decodeFile = (input, allowed) => {
  const name = cleanText(input.name, 180).replace(/[\\/:*?"<>|]/g, '_');
  const extension = name.includes('.') ? `.${name.split('.').pop().toLowerCase()}` : '';
  if (!allowed.includes(extension)) throw Object.assign(new Error(`不支持文件类型 ${extension}`), { status: 415 });
  const match = String(input.data || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw Object.assign(new Error('文件内容格式错误'), { status: 400 });
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw Object.assign(new Error('单个文件不能超过 5MB'), { status: 413 });
  return { name, extension, contentType: match[1], bytes };
};

const filePayload = (files) => files.map((file) => ({
  id: file.id,
  name: file.originalName,
  originalName: file.originalName,
  contentType: file.contentType,
  bytes: file.bytes,
  url: `/api/material-files/${file.id}`,
  downloadUrl: `/api/material-files/${file.id}`
}));

export const handleMaterialRoutes = async (request, env, ctx, url) => {
  const route = url.pathname;
  if (route !== '/api/material-tasks'
      && !/^\/api\/material-tasks\/[^/]+\/submission$/.test(route)
      && route !== '/api/admin/material-tasks'
      && !/^\/api\/admin\/material-tasks\/[^/]+$/.test(route)
      && !/^\/api\/admin\/material-tasks\/[^/]+\/missing-export$/.test(route)
      && !/^\/api\/admin\/material-submissions\/[^/]+$/.test(route)) return null;
  const isAdminRoute = route.startsWith('/api/admin/');
  const auth = await requireUser(request, env, isAdminRoute);
  if (auth.error) return auth.error;
  const user = auth.user;

  if (route === '/api/material-tasks' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id,title,description,deadline,allowed_types_json AS allowedTypesJson,
              file_limit AS fileLimit,require_summary AS requireSummary,owner_type AS ownerType,status
         FROM material_tasks WHERE status='published' ORDER BY deadline`
    ).all();
    const tasks = [];
    for (const task of results) {
      const owner = await ownerForTask(env, user, task).catch(() => null);
      const submission = owner ? await env.DB.prepare(
        `SELECT id,summary,status,version,submitted_at AS submittedAt,review_note AS reviewNote,updated_at AS updatedAt
           FROM material_submissions WHERE task_id=?1 AND owner_type=?2 AND owner_id=?3`
      ).bind(task.id, owner.type, owner.id).first() : null;
      if (submission) {
        const files = await env.DB.prepare(
          `SELECT id,original_name AS originalName,content_type AS contentType,bytes
             FROM material_files WHERE submission_id=?1 ORDER BY created_at`
        ).bind(submission.id).all();
        submission.files = filePayload(files.results);
      }
      tasks.push({
        ...task,
        allowedTypes: parseJson(task.allowedTypesJson, []),
        fileTypes: parseJson(task.allowedTypesJson, []).map((item) => item.replace(/^\./, '')),
        requireSummary: Boolean(task.requireSummary),
        submission
      });
    }
    return json({ tasks });
  }

  const submitMatch = route.match(/^\/api\/material-tasks\/([^/]+)\/submission$/);
  if (submitMatch && request.method === 'PUT') {
    const task = await env.DB.prepare(
      `SELECT id,deadline,allowed_types_json AS allowedTypesJson,file_limit AS fileLimit,
              require_summary AS requireSummary,owner_type AS ownerType,status
         FROM material_tasks WHERE id=?1`
    ).bind(decodeURIComponent(submitMatch[1])).first();
    if (!task || task.status !== 'published') return json({ error: '材料任务不存在' }, 404);
    const owner = await ownerForTask(env, user, task);
    const current = await env.DB.prepare(
      `SELECT id,status,version FROM material_submissions
        WHERE task_id=?1 AND owner_type=?2 AND owner_id=?3`
    ).bind(task.id, owner.type, owner.id).first();
    if (Date.now() > Date.parse(task.deadline) && !current) return json({ error: '材料任务已截止' }, 403);
    if (current && current.status !== 'returned') return json({ error: '材料已提交，不能重复覆盖' }, 409);
    const body = await readJson(request);
    if (current && Number(body.version) !== Number(current.version)) {
      return json({ error: '材料已被更新，请刷新后重试' }, 409);
    }
    const summary = cleanText(body.summary, 4000);
    if (task.requireSummary && !summary) return json({ error: '请填写文字总结' }, 400);
    if (body.files?.some((item) => item?.data)) {
      return json({ error: '旧版Base64图片上传已停用，请重新选择图片' }, 400);
    }
    const inputs = Array.isArray(body.files) ? body.files : [];
    if (!inputs.length || inputs.length > Number(task.fileLimit)) return json({ error: `文件数量必须为 1–${task.fileLimit} 个` }, 400);
    const allowed = parseJson(task.allowedTypesJson, []);
    const mediaIds = inputs.map((item) => item?.mediaId).filter(Boolean);
    if (mediaIds.length !== inputs.length) return json({ error: '图片上传确认信息不完整' }, 400);
    const uploaded = await claimConfirmedMedia(
      env, mediaIds, user, task.id, 'material-image', Number(task.fileLimit)
    );
    try {
      if (!allowed.some((item) => ['.jpg', '.jpeg', '.png', '.webp'].includes(String(item).toLowerCase()))) {
        return json({ error: '该材料任务未开放图片格式' }, 415);
      }
      const id = current?.id || crypto.randomUUID();
      const old = current ? await env.DB.prepare(
        `SELECT f.id,f.object_key AS objectKey,m.id AS mediaId
           FROM material_files f LEFT JOIN media_objects m ON m.id=f.id
          WHERE f.submission_id=?1`
      ).bind(id).all() : { results: [] };
      if (current) {
        const claimed = await env.DB.prepare(
          `UPDATE material_submissions SET summary=?1,status='submitted',submitted_at=?2,
            review_note='',updated_at=?2,version=version+1 WHERE id=?3 AND version=?4`
        ).bind(summary, nowIso(), id, current.version).run();
        if (!claimed.meta.changes) {
          throw Object.assign(new Error('材料已被更新，请刷新后重试'), { status: 409 });
        }
      }
      const statements = [
        ...(!current ? [env.DB.prepare(
            `INSERT INTO material_submissions
              (id,task_id,owner_type,owner_id,summary,status,submitted_at,review_note,created_at,updated_at,version)
             VALUES (?1,?2,?3,?4,?5,'submitted',?6,'',?6,?6,1)`
          ).bind(id, task.id, owner.type, owner.id, summary, nowIso())] : []),
        env.DB.prepare('DELETE FROM material_files WHERE submission_id=?1').bind(id)
      ];
      for (const file of old.results) {
        if (file.mediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(file.mediaId));
      }
      for (const file of uploaded) {
        const originalName = cleanText(
          inputs.find((item) => item.mediaId === file.id)?.name || `image-${file.sortOrder + 1}.webp`,
          180
        ).replace(/[\\/:*?"<>|]/g, '_');
        statements.push(env.DB.prepare(
          `INSERT INTO material_files
            (id,submission_id,object_key,original_name,content_type,bytes,created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7)`
        ).bind(file.id, id, file.objectKey, originalName, file.contentType, file.bytes, nowIso()));
        statements.push(env.DB.prepare(
          `UPDATE media_objects SET business_id=?1,updated_at=?2
            WHERE id=?3 AND owner_user_id=?4 AND business_id IS NULL`
        ).bind(id, nowIso(), file.id, user.id));
      }
      await env.DB.batch(statements);
      ctx.waitUntil(Promise.all(old.results.map((file) => env.UPLOADS.delete(file.objectKey))));
      return json({ ok: true, id });
    } catch (error) { throw error; }
  }

  if (route === '/api/admin/material-tasks' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const campus = cleanText(url.searchParams.get('campus'), 50);
    const tasks = await env.DB.prepare(
      `SELECT id,title,description,deadline,allowed_types_json AS allowedTypesJson,
              file_limit AS fileLimit,require_summary AS requireSummary,owner_type AS ownerType,
              status,created_at AS createdAt,updated_at AS updatedAt
         FROM material_tasks ORDER BY created_at DESC`
    ).all();
    const submissions = await env.DB.prepare(
      `SELECT s.id,s.task_id AS taskId,s.owner_type AS ownerType,s.owner_id AS ownerId,
              s.summary,s.status,s.version,s.submitted_at AS submittedAt,s.review_note AS reviewNote
         FROM material_submissions s
        WHERE (?1='' OR (s.owner_type='user' AND EXISTS (
          SELECT 1 FROM users u WHERE u.id=s.owner_id AND u.campus=?1
        )))
        ORDER BY s.updated_at DESC LIMIT ?2 OFFSET ?3`
    ).bind(campus, limit, (page - 1) * limit).all();
    const submissionCount = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM material_submissions s
        WHERE (?1='' OR (s.owner_type='user' AND EXISTS (
          SELECT 1 FROM users u WHERE u.id=s.owner_id AND u.campus=?1
        )))`
    ).bind(campus).first();
    const taskPayloads = tasks.results.map((task) => ({
        ...task,
        allowedTypes: parseJson(task.allowedTypesJson, []),
        fileTypes: parseJson(task.allowedTypesJson, []).map((item) => item.replace(/^\./, '')),
        requireSummary: Boolean(task.requireSummary)
      }));
    for (const submission of submissions.results) {
      const files = await env.DB.prepare(
        `SELECT id,original_name AS originalName,content_type AS contentType,bytes
           FROM material_files WHERE submission_id=?1 ORDER BY created_at`
      ).bind(submission.id).all();
      submission.files = files.results.map((file) => ({
        ...file,
        downloadUrl: `/api/material-files/${file.id}`
      }));
      submission.owner = submission.ownerType === 'user'
        ? await env.DB.prepare(
          'SELECT id,name,student_id AS studentId,campus FROM users WHERE id=?1'
        ).bind(submission.ownerId).first()
        : await env.DB.prepare('SELECT id,name FROM teams WHERE id=?1').bind(submission.ownerId).first();
    }
    const campuses = await env.DB.prepare(
      "SELECT DISTINCT campus FROM users WHERE role='student' AND campus<>'' ORDER BY campus"
    ).all();
    const campusProgress = [];
    for (const task of taskPayloads.filter((item) => item.ownerType === 'user')) {
      const progress = await env.DB.prepare(
        `SELECT u.campus,COUNT(*) AS total,
          SUM(CASE WHEN s.id IS NULL THEN 0 ELSE 1 END) AS completed
         FROM users u LEFT JOIN material_submissions s
          ON s.owner_id=u.id AND s.owner_type='user' AND s.task_id=?1
         WHERE u.role='student' GROUP BY u.campus ORDER BY u.campus`
      ).bind(task.id).all();
      campusProgress.push({
        taskId: task.id,
        campuses: progress.results.map((item) => ({
          campus: item.campus,
          total: Number(item.total),
          completed: Number(item.completed)
        }))
      });
    }
    return json({
      tasks: taskPayloads,
      submissions: submissions.results,
      campuses: campuses.results.map((item) => item.campus),
      campusProgress,
      pagination: {
        page,
        pages: Math.max(1, Math.ceil(Number(submissionCount.total) / limit)),
        total: Number(submissionCount.total)
      }
    });
  }

  if (route === '/api/admin/material-tasks' && request.method === 'POST') {
    const body = await readJson(request);
    const title = cleanText(body.title, 120);
    const ownerType = body.ownerType === 'team' || body.submissionMode === 'team' ? 'team' : 'user';
    const rawAllowedTypes = Array.isArray(body.allowedTypes)
      ? body.allowedTypes
      : String(body.fileTypes || '').split(/[,，\s]+/).filter(Boolean);
    const allowedTypes = [...new Set(rawAllowedTypes.map((item) => {
      const value = cleanText(item, 12).toLowerCase();
      return value.startsWith('.') ? value : `.${value}`;
    }))];
    const fileLimit = Math.min(8, Math.max(1, Number(body.fileLimit || 1)));
    if (!title || !allowedTypes.length || Number.isNaN(Date.parse(body.deadline))) return json({ error: '材料任务信息无效' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO material_tasks
        (id,title,description,deadline,allowed_types_json,file_limit,require_summary,
         owner_type,status,created_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`
    ).bind(id, title, cleanText(body.description, 2000), new Date(body.deadline).toISOString(),
      JSON.stringify(allowedTypes), fileLimit, body.requireSummary || body.summaryRequired ? 1 : 0, ownerType,
      body.status === 'draft' ? 'draft' : 'published', nowIso()).run();
    return json({ ok: true, id }, 201);
  }

  const taskMatch = route.match(/^\/api\/admin\/material-tasks\/([^/]+)$/);
  if (taskMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    const result = await env.DB.prepare(
      `UPDATE material_tasks SET title=?1,description=?2,deadline=?3,allowed_types_json=?4,
        file_limit=?5,require_summary=?6,owner_type=?7,status=?8,updated_at=?9 WHERE id=?10`
    ).bind(cleanText(body.title, 120), cleanText(body.description, 2000),
      new Date(body.deadline).toISOString(), JSON.stringify(body.allowedTypes || []),
      Math.min(8, Math.max(1, Number(body.fileLimit || 1))), body.requireSummary ? 1 : 0,
      body.ownerType === 'team' ? 'team' : 'user', body.status === 'draft' ? 'draft' : 'published',
      nowIso(), decodeURIComponent(taskMatch[1])).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: '任务不存在' }, 404);
  }

  const missingMatch = route.match(/^\/api\/admin\/material-tasks\/([^/]+)\/missing-export$/);
  if (missingMatch && request.method === 'GET') {
    const taskId = decodeURIComponent(missingMatch[1]);
    const task = await env.DB.prepare(
      'SELECT id,title,owner_type AS ownerType FROM material_tasks WHERE id=?1'
    ).bind(taskId).first();
    if (!task) return json({ error: '材料任务不存在' }, 404);
    const data = task.ownerType === 'team'
      ? await env.DB.prepare(
        `SELECT t.name AS ownerName,'' AS studentId,'' AS campus
         FROM teams t LEFT JOIN material_submissions s
          ON s.task_id=?1 AND s.owner_type='team' AND s.owner_id=t.id
         WHERE s.id IS NULL ORDER BY t.name`
      ).bind(taskId).all()
      : await env.DB.prepare(
        `SELECT u.name AS ownerName,u.student_id AS studentId,u.campus
         FROM users u LEFT JOIN material_submissions s
          ON s.task_id=?1 AND s.owner_type='user' AND s.owner_id=u.id
         WHERE u.role='student' AND u.status='active' AND s.id IS NULL
         ORDER BY u.campus,u.student_id`
      ).bind(taskId).all();
    return excelResponse(`未提交名单-${task.title}.xlsx`, [
      { header: '姓名/队伍', key: 'ownerName' },
      { header: '学号', key: 'studentId', text: true },
      { header: '校区', key: 'campus' }
    ], data.results);
  }

  const reviewMatch = route.match(/^\/api\/admin\/material-submissions\/([^/]+)$/);
  if (reviewMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    const id = decodeURIComponent(reviewMatch[1]);
    const status = body.status === 'approved' ? 'approved' : 'returned';
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE material_submissions SET status=?1,review_note=?2,updated_at=?3 WHERE id=?4`
      ).bind(status, cleanText(body.reviewNote, 500), nowIso(), id),
      audit(env, admin, status, 'material_submission', id)
    ]);
    return results[0].meta.changes ? json({ ok: true }) : json({ error: '提交不存在' }, 404);
  }

  return null;
};

export const canAccessMaterialFile = async (env, fileId, user) => {
  const file = await env.DB.prepare(
    `SELECT f.id,f.object_key AS objectKey,f.original_name AS originalName,
            f.content_type AS contentType,s.owner_type AS ownerType,s.owner_id AS ownerId
       FROM material_files f JOIN material_submissions s ON s.id=f.submission_id WHERE f.id=?1`
  ).bind(fileId).first();
  if (!file) return null;
  if (user.role === 'admin' || (file.ownerType === 'user' && file.ownerId === user.id)) return file;
  if (file.ownerType === 'team') {
    const member = await env.DB.prepare('SELECT 1 FROM team_members WHERE team_id=?1 AND user_id=?2')
      .bind(file.ownerId, user.id).first();
    if (member) return file;
  }
  return null;
};
