import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_MOBILE_EXPERIENCE_BACKEND_V1 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};

const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

const replaceSection = (source, startText, endText, transform, label) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  if (start < 0 || end < 0) throw new Error(`未找到${label}范围，已停止以避免误改`);
  const before = source.slice(0, start);
  const section = source.slice(start, end);
  const after = source.slice(end);
  const nextSection = transform(section);
  if (nextSection === section) throw new Error(`${label}没有产生修改，已停止`);
  return before + nextSection + after;
};

{
  const { file, source } = read('cloudflare/lib/runtime.js');
  if (!source.includes(marker)) {
    let next = source;
    next = replaceOnce(
      next,
      "  const values = Object.fromEntries(results.map((item) => [item.key, parseJson(item.valueJson)]));\n  return {",
      "  const values = Object.fromEntries(results.map((item) => [item.key, parseJson(item.valueJson)]));\n  const checkinSettings = values.checkinSettings || {};\n  return {",
      '打卡设置读取变量'
    );
    next = replaceOnce(
      next,
      "    allowSelfJoin: Boolean(values.allowSelfJoin),\n    environment: env.ENVIRONMENT || 'unknown'",
      [
        "    allowSelfJoin: Boolean(values.allowSelfJoin),",
        "    checkinSettings: {",
        "      enabled: checkinSettings.enabled !== false,",
        "      activeStartDate: checkinSettings.activeStartDate || values.startDate || '',",
        "      activeEndDate: checkinSettings.activeEndDate || values.endDate || '',",
        "      dailyStart: checkinSettings.dailyStart || '00:00',",
        "      dailyEnd: checkinSettings.dailyEnd || '23:59',",
        "      weekdays: Array.isArray(checkinSettings.weekdays) && checkinSettings.weekdays.length",
        "        ? checkinSettings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)",
        "        : [1, 2, 3, 4, 5, 6, 7],",
        "      personalImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.personalImageLimit || 3))),",
        "      teamImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.teamImageLimit || 3)))",
        "    },",
        "    environment: env.ENVIRONMENT || 'unknown'"
      ].join('\n'),
      '打卡设置返回值'
    );
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(marker)) {
    let next = source;
    const helper = [
      marker,
      "export const applyInteractionCheckinSettings = (task, config) => {",
      "  if (!task || task.trackId !== 'interaction') return task;",
      "  const settings = config?.checkinSettings || {};",
      "  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};",
      "  const activeStartDate = settings.activeStartDate || existing.activeStartDate || shanghaiDate();",
      "  const activeEndDate = settings.activeEndDate || existing.activeEndDate || activeStartDate;",
      "  const dailyStart = settings.dailyStart || existing.dailyStart || '00:00';",
      "  const dailyEnd = settings.dailyEnd || existing.dailyEnd || '23:59';",
      "  const weekdays = Array.isArray(settings.weekdays) && settings.weekdays.length",
      "    ? settings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)",
      "    : (Array.isArray(existing.weekdays) && existing.weekdays.length ? existing.weekdays : [1, 2, 3, 4, 5, 6, 7]);",
      "  const schedule = {",
      "    scheduleType: 'weekly',",
      "    activeStartDate,",
      "    activeEndDate,",
      "    dailyStart,",
      "    dailyEnd,",
      "    weekdays,",
      "    refreshDays: []",
      "  };",
      "  return {",
      "    ...task,",
      "    checkinEnabled: settings.enabled !== false,",
      "    imageLimit: Math.min(8, Math.max(1, Number(settings.teamImageLimit || task.imageLimit || 3))),",
      "    memberImageLimit: Math.min(8, Math.max(1, Number(settings.personalImageLimit || task.imageLimit || 3))),",
      "    scheduleJson: JSON.stringify(schedule),",
      "    startsAt: `${activeStartDate}T${dailyStart}:00+08:00`,",
      "    endsAt: `${activeEndDate}T${dailyEnd}:00+08:00`",
      "  };",
      "};",
      ''
    ].join('\n');
    next = replaceOnce(next, 'export const buildStudentTasks = async (env, user, options = {}) => {', helper + 'export const buildStudentTasks = async (env, user, options = {}) => {', '互动赛道打卡设置帮助函数');
    next = replaceOnce(
      next,
      "  const visibleTasks = results.filter(\n    (task) => !task.scheduleJson || isTaskOccurrence(task, today)\n  );",
      "  const effectiveResults = results.map((task) => applyInteractionCheckinSettings(task, config));\n  const visibleTasks = effectiveResults.filter(\n    (task) => task.checkinEnabled !== false && (!task.scheduleJson || isTaskOccurrence(task, today))\n  );",
      '学生任务设置应用'
    );
    next = replaceOnce(
      next,
      "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;",
      "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (task?.checkinEnabled === false) return false;\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;",
      '关闭打卡时段校验'
    );
    const statsHelper = [
      "const buildCheckinStats = async (env, user, teamSummary) => {",
      "  const personal = user.trackId === 'health'",
      "    ? await env.DB.prepare(\"SELECT COUNT(DISTINCT checkin_date) AS total FROM checkins WHERE user_id=?1 AND status!='rejected'\").bind(user.id).first()",
      "    : await env.DB.prepare(\"SELECT COUNT(DISTINCT occurrence_date) AS total FROM member_checkins WHERE user_id=?1 AND status!='rejected'\").bind(user.id).first();",
      "  let teamDays = 0;",
      "  if (teamSummary?.team?.id) {",
      "    const team = await env.DB.prepare(",
      "      \"SELECT COUNT(DISTINCT COALESCE(NULLIF(occurrence_date,''),substr(submitted_at,1,10))) AS total FROM task_submissions WHERE owner_type='team' AND owner_id=?1 AND status IN ('submitted','approved')\"",
      "    ).bind(teamSummary.team.id).first();",
      "    teamDays = Number(team?.total || 0);",
      "  }",
      "  return { personalDays: Number(personal?.total || 0), teamDays };",
      "};",
      ''
    ].join('\n');
    next = replaceOnce(next, 'export const buildStudentDashboard = async (env, user, options = {}) => {', statsHelper + 'export const buildStudentDashboard = async (env, user, options = {}) => {', '累计打卡统计函数');
    next = replaceOnce(
      next,
      [
        "  const [teamSummary, taskResult, materialTasks] = await Promise.all([",
        "    buildTeamSummary(env, user, config),",
        "    buildStudentTasks(env, user, { config, date }),",
        "    buildStudentMaterialTasks(env, user)",
        "  ]);"
      ].join('\n'),
      [
        "  const [teamSummary, taskResult] = await Promise.all([",
        "    buildTeamSummary(env, user, config),",
        "    buildStudentTasks(env, user, { config, date })",
        "  ]);",
        "  const checkinStats = await buildCheckinStats(env, user, teamSummary);"
      ].join('\n'),
      '学生首页并行数据'
    );
    next = replaceOnce(
      next,
      "    tasks: taskResult.tasks,\n    materialTasks,\n    switches: taskResult.switches",
      "    tasks: taskResult.tasks,\n    materialTasks: [],\n    checkinStats,\n    switches: taskResult.switches",
      '学生首页累计数据返回'
    );
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/student.js');
  if (!source.includes(marker)) {
    let next = source;
    next = replaceOnce(next, '  mapWithConcurrency,\n  submissionImagesForIds', '  mapWithConcurrency,\n  submissionImagesForIds,\n  applyInteractionCheckinSettings', '学生路由设置函数导入');
    next = replaceSection(next, '  const memberMatch = route.match', '  const submissionMatch = route.match', (section) => {
      let changed = section;
      changed = replaceOnce(
        changed,
        "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);",
        "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);\n    const taskConfig = await readConfig(env);\n    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);",
        '个人打卡设置读取'
      );
      changed = changed.replaceAll('taskWindowOpen(task, occurrenceDate', 'taskWindowOpen(effectiveTask, occurrenceDate');
      changed = changed.replace('const imageLimit = Math.max(1, Number(task.imageLimit) || 1);', 'const imageLimit = Math.max(1, Number(effectiveTask.memberImageLimit) || 1);');
      return changed;
    }, '互动赛道个人打卡路由');
    next = replaceSection(next, '  const submissionMatch = route.match', "  const taskSubmissionMatch = route.match", (section) => {
      let changed = section;
      changed = replaceOnce(
        changed,
        "    if (!task || task.status !== 'published' || (user.role !== 'admin' && task.trackId !== user.trackId)) {\n      return json({ error: '任务不存在' }, 404);\n    }",
        "    if (!task || task.status !== 'published' || (user.role !== 'admin' && task.trackId !== user.trackId)) {\n      return json({ error: '任务不存在' }, 404);\n    }\n    const taskConfig = await readConfig(env);\n    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);",
        '队伍提交设置读取'
      );
      changed = changed.replace('const occurrenceDate = task.scheduleJson ? cleanText(body.occurrenceDate, 10) : \'\';', "const occurrenceDate = effectiveTask.scheduleJson ? cleanText(body.occurrenceDate || shanghaiDate(), 10) : ''; ");
      changed = changed.replace('taskWindowOpen(task, occurrenceDate)', 'taskWindowOpen(effectiveTask, occurrenceDate)');
      changed = changed.replace('submissionOwner(env, user, task)', 'submissionOwner(env, user, effectiveTask)');
      changed = changed.replace("claimConfirmedMedia(env, body.mediaIds, user, task.id, 'task', Number(task.imageLimit))", "claimConfirmedMedia(env, body.mediaIds, user, task.id, 'task', Number(effectiveTask.imageLimit))");
      return changed;
    }, '队伍汇总提交路由');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    let next = source;
    next = replaceOnce(next, "import { taskWindowOpen, teamForUser } from '../services/student-dashboard.js';", "import { applyInteractionCheckinSettings, taskWindowOpen, teamForUser } from '../services/student-dashboard.js';", '媒体路由设置函数导入');
    next = next.replace('const THUMB_MAX_EDGE = 360;', 'const THUMB_MAX_EDGE = 640;');
    next = replaceOnce(
      next,
      "  if (!task || task.status !== 'published' || task.trackId !== 'interaction'\n      || (task.submissionType && task.submissionType !== 'team')) {\n    return json({ error: '任务不存在、已关闭或不支持队伍成员打卡' }, 404);\n  }",
      "  if (!task || task.status !== 'published' || task.trackId !== 'interaction'\n      || (task.submissionType && task.submissionType !== 'team')) {\n    return json({ error: '任务不存在、已关闭或不支持队伍成员打卡' }, 404);\n  }\n  const taskConfig = await readConfig(env);\n  const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);",
      '快速上传设置读取'
    );
    next = next.replaceAll('taskWindowOpen(task, occurrenceDate', 'taskWindowOpen(effectiveTask, occurrenceDate');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/admin.js');
  if (!source.includes(marker)) {
    let next = source;
    const settingsRoute = [
      marker,
      "  if (route === '/api/admin/checkin-settings' && request.method === 'GET') {",
      "    const current = await readConfig(env);",
      "    return json({ settings: current.checkinSettings });",
      "  }",
      '',
      "  if (route === '/api/admin/checkin-settings' && request.method === 'PUT') {",
      "    const body = await readJson(request);",
      "    const activeStartDate = cleanText(body.activeStartDate, 10);",
      "    const activeEndDate = cleanText(body.activeEndDate, 10);",
      "    const dailyStart = cleanText(body.dailyStart, 5);",
      "    const dailyEnd = cleanText(body.dailyEnd, 5);",
      "    const weekdays = Array.isArray(body.weekdays) ? [...new Set(body.weekdays.map(Number).filter((day) => day >= 1 && day <= 7))].sort((a, b) => a - b) : [];",
      "    const personalImageLimit = Math.min(8, Math.max(1, Number(body.personalImageLimit || 1)));",
      "    const teamImageLimit = Math.min(8, Math.max(1, Number(body.teamImageLimit || 1)));",
      "    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(activeStartDate) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(activeEndDate) || activeStartDate > activeEndDate) {",
      "      return json({ error: '活动开始和结束日期无效' }, 400);",
      "    }",
      "    if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(dailyStart) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(dailyEnd) || dailyStart >= dailyEnd) {",
      "      return json({ error: '每日打卡时间无效' }, 400);",
      "    }",
      "    if (!weekdays.length) return json({ error: '至少选择一个允许打卡的星期' }, 400);",
      "    const settings = { enabled: body.enabled !== false, activeStartDate, activeEndDate, dailyStart, dailyEnd, weekdays, personalImageLimit, teamImageLimit };",
      "    await env.DB.batch([putConfig(env, 'checkinSettings', settings), audit(env, admin, 'update', 'checkin_settings', 'interaction', settings)]);",
      "    return json({ ok: true, settings });",
      "  }",
      ''
    ].join('\n');
    next = replaceOnce(next, "  if (route === '/api/admin/config' && request.method === 'PUT') {", settingsRoute + "  if (route === '/api/admin/config' && request.method === 'PUT') {", '管理员打卡设置接口');
    next = replaceOnce(
      next,
      "    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM plaza_posts').first();\n    return json({",
      [
        "    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM plaza_posts').first();",
        "    const imagesBySubmission = new Map();",
        "    if (results.length) {",
        "      const placeholders = results.map((_, index) => `?${index + 1}`).join(',');",
        "      const rows = await env.DB.prepare(",
        "        `SELECT i.submission_id AS submissionId,i.id,COALESCE(m.object_key,i.object_key) AS objectKey,m.id AS mediaId,",
        "                tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey",
        "           FROM task_submission_images i",
        "           LEFT JOIN media_objects m ON m.id=i.id",
        "           LEFT JOIN media_objects tm ON tm.business_id=m.id AND tm.business_type IN ('task:thumb','admin-makeup:thumb')",
        "          WHERE i.submission_id IN (${placeholders}) ORDER BY i.submission_id,i.sort_order`",
        "      ).bind(...results.map((item) => item.submissionId)).all();",
        "      const signed = await Promise.all(rows.results.map(async (image) => {",
        "        const displayUrl = image.mediaId ? await createPrivateMediaUrl(env, image, 'admin', admin.id) : `/api/files/${image.id}`;",
        "        const thumbUrl = image.thumbMediaId ? await createPrivateMediaUrl(env, { id: image.thumbMediaId, objectKey: image.thumbObjectKey }, 'admin', admin.id) : displayUrl;",
        "        return { submissionId: image.submissionId, thumbUrl, displayUrl, imageUrl: thumbUrl };",
        "      }));",
        "      for (const image of signed) {",
        "        if (!imagesBySubmission.has(image.submissionId)) imagesBySubmission.set(image.submissionId, []);",
        "        imagesBySubmission.get(image.submissionId).push(image);",
        "      }",
        "    }",
        "    return json({"
      ].join('\n'),
      '管理员广场照片查询'
    );
    next = replaceOnce(
      next,
      "        members: [],\n        excludedFromRanking: Boolean(item.excludedFromRanking)",
      "        members: [],\n        images: imagesBySubmission.get(item.submissionId) || [],\n        excludedFromRanking: Boolean(item.excludedFromRanking)",
      '管理员广场照片返回'
    );
    write(file, next);
  }
}

console.log('Applied approved cumulative check-ins, admin settings and 640px media backend.');
