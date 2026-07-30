import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const backendMarker = '/* APPROVED_MOBILE_EXPERIENCE_BACKEND_V1 */';
const templateMarker = '/* APPROVED_CHECKIN_SETTINGS_TEMPLATE_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const file = path.join(root, 'scripts', 'student-admin-flow.template.js');
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes(templateMarker)) {
    source = source.replace('const maxImages = Math.max(1, Math.min(20, Number(task.imageLimit) || 1));', 'const maxImages = Math.max(1, Math.min(8, Number(task.memberImageLimit || task.imageLimit) || 1));');
    source = replaceOnce(
      source,
      "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);",
      "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);\n    const taskConfig = await readConfig(env);\n    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);",
      '模板个人打卡设置读取'
    );
    source = source.replace('taskWindowOpen(task, occurrenceDate, makeupAllowed)', 'taskWindowOpen(effectiveTask, occurrenceDate, makeupAllowed)');
    source = source.replace('const imageLimit = Math.max(1, Number(task.imageLimit) || 1);', 'const imageLimit = Math.max(1, Number(effectiveTask.memberImageLimit) || 1);');
    source = templateMarker + '\n' + source;
    fs.writeFileSync(file, source, 'utf8');
  }
}

{
  const file = path.join(root, 'cloudflare', 'routes', 'student.js');
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes(backendMarker)) {
    source = replaceOnce(
      source,
      '  mapWithConcurrency,\n  submissionImagesForIds',
      '  mapWithConcurrency,\n  submissionImagesForIds,\n  applyInteractionCheckinSettings',
      '学生路由设置函数导入'
    );
    source = replaceOnce(
      source,
      "    if (!task || task.status !== 'published' || (user.role !== 'admin' && task.trackId !== user.trackId)) {\n      return json({ error: '任务不存在' }, 404);\n    }",
      "    if (!task || task.status !== 'published' || (user.role !== 'admin' && task.trackId !== user.trackId)) {\n      return json({ error: '任务不存在' }, 404);\n    }\n    const taskConfig = await readConfig(env);\n    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);",
      '队伍提交设置读取'
    );
    source = source.replace("const occurrenceDate = task.scheduleJson ? cleanText(body.occurrenceDate, 10) : '';", "const occurrenceDate = effectiveTask.scheduleJson ? cleanText(body.occurrenceDate || shanghaiDate(), 10) : '';");
    source = source.replace('taskWindowOpen(task, occurrenceDate)', 'taskWindowOpen(effectiveTask, occurrenceDate)');
    source = source.replace('submissionOwner(env, user, task)', 'submissionOwner(env, user, effectiveTask)');
    source = source.replace("claimConfirmedMedia(env, body.mediaIds, user, task.id, 'task', Number(task.imageLimit))", "claimConfirmedMedia(env, body.mediaIds, user, task.id, 'task', Number(effectiveTask.imageLimit))");
    source = backendMarker + '\n' + source;
    fs.writeFileSync(file, source, 'utf8');
  }
}

console.log('Prepared approved check-in settings before generating student routes.');
