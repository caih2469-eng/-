import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* HEALTH_CLIENT_CHECKIN_V1 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  if (!source.includes(search)) throw new Error(`未找到${label}，已停止以避免误改`);
  return source.replace(search, replacement);
};
const replaceSection = (source, startText, endText, replacement, label) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  if (start < 0 || end < 0) throw new Error(`未找到${label}范围，已停止以避免误改`);
  return source.slice(0, start) + replacement.trimEnd() + '\n' + source.slice(end);
};

{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(marker)) {
    let next = replaceOnce(
      source,
      'export const buildStudentDashboard = async (env, user, options = {}) => {',
      `${marker}\nexport const buildHealthCheckins = async (env, user, date = shanghaiDate()) => {\n  if (user.role !== 'student' || user.trackId !== 'health') return [];\n  const { results } = await env.DB.prepare(\n    \`SELECT id,checkin_date AS date,slot_id AS slotId,note,status,submitted_at AS submittedAt,\n            review_note AS reviewNote,version\n       FROM checkins WHERE user_id=?1 AND checkin_date=?2 ORDER BY submitted_at\`\n  ).bind(user.id, date).all();\n  return results;\n};\n\nexport const buildStudentDashboard = async (env, user, options = {}) => {`,
      '健康自律首页打卡记录读取器'
    );
    next = replaceOnce(
      next,
      `  const [teamSummary, taskResult, materialTasks] = await Promise.all([\n    buildTeamSummary(env, user, config),\n    buildStudentTasks(env, user, { config, date }),\n    buildStudentMaterialTasks(env, user)\n  ]);`,
      `  const [teamSummary, taskResult, materialTasks, healthCheckins] = await Promise.all([\n    buildTeamSummary(env, user, config),\n    buildStudentTasks(env, user, { config, date }),\n    buildStudentMaterialTasks(env, user),\n    buildHealthCheckins(env, user, date)\n  ]);`,
      '学生首页健康打卡并行读取'
    );
    next = replaceOnce(
      next,
      `    tasks: taskResult.tasks,\n    materialTasks,\n    switches: taskResult.switches`,
      `    tasks: taskResult.tasks,\n    materialTasks,\n    healthCheckins,\n    switches: taskResult.switches`,
      '学生首页健康打卡返回值'
    );
    write(file, next);
  }
}

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    let next = source;
    next = replaceOnce(
      next,
      `const patchStudentTask = (taskId, updater) => {\n  if (!studentViewState.data?.tasks) return;\n  studentViewState.data.tasks = studentViewState.data.tasks.map(\n    (task) => (task.id === taskId ? updater({ ...task }) : task)\n  );\n  studentViewState.renderedAt = Date.now();\n};\n\nconst patchStudentMaterialTask`,
      `const patchStudentTask = (taskId, updater) => {\n  if (!studentViewState.data?.tasks) return;\n  studentViewState.data.tasks = studentViewState.data.tasks.map(\n    (task) => (task.id === taskId ? updater({ ...task }) : task)\n  );\n  studentViewState.renderedAt = Date.now();\n};\n\nconst patchStudentHealthCheckin = (checkin) => {\n  if (!studentViewState.data || user?.trackId !== 'health') return;\n  const current = Array.isArray(studentViewState.data.healthCheckins)\n    ? studentViewState.data.healthCheckins : [];\n  studentViewState.data.healthCheckins = [\n    ...current.filter((item) => item.slotId !== checkin.slotId || item.date !== checkin.date),\n    checkin\n  ];\n  studentViewState.renderedAt = Date.now();\n};\n\nconst patchStudentMaterialTask`,
      '健康自律首页缓存更新器'
    );
    next = replaceOnce(
      next,
      `  const taskResult = { tasks: dashboard.tasks };\n  const materialResult = { tasks: dashboard.materialTasks };\n  const completedTasks = taskResult.tasks.filter((task) =>\n    ['submitted', 'approved'].includes(task.submission?.status) || task.memberCheckin\n  ).length;\n  const taskProgress = taskResult.tasks.length\n    ? Math.round((completedTasks / taskResult.tasks.length) * 100)\n    : 0;`,
      `  const taskResult = { tasks: dashboard.tasks };\n  const materialResult = { tasks: dashboard.materialTasks };\n  const healthSettings = config.healthCheckinSettings || {};\n  const healthSlots = Array.isArray(healthSettings.slots) && healthSettings.slots.length\n    ? healthSettings.slots : (Array.isArray(config.slots) ? config.slots : []);\n  const healthCheckins = Array.isArray(dashboard.healthCheckins) ? dashboard.healthCheckins : [];\n  const healthCompleted = healthSlots.filter((slot) =>\n    healthCheckins.some((checkin) => checkin.slotId === slot.id)\n  ).length;\n  const completedTasks = isInteraction\n    ? taskResult.tasks.filter((task) =>\n      ['submitted', 'approved'].includes(task.submission?.status) || task.memberCheckin\n    ).length\n    : healthCompleted;\n  const progressTotal = isInteraction ? taskResult.tasks.length : healthSlots.length;\n  const taskProgress = progressTotal\n    ? Math.round((completedTasks / progressTotal) * 100)\n    : 0;`,
      '学生首页健康自律进度'
    );
    next = replaceOnce(
      next,
      '<button data-jump="activityTasks"><span>✦</span><strong>今日任务</strong><small>${taskResult.tasks.length} 项待查看</small></button>',
      '<button data-jump="activityTasks"><span>✦</span><strong>今日打卡</strong><small>${isInteraction ? `${taskResult.tasks.length} 项待查看` : `${healthCompleted}/${healthSlots.length} 餐已提交`}</small></button>',
      '学生首页今日打卡快捷入口'
    );
    const homeTemplate = read('templates/health-client-checkin-home.txt').source;
    next = replaceSection(
      next,
      "  const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };",
      "  const materialStatus = { submitted: '已提交', returned: '退回修改' };",
      homeTemplate,
      '学生首页今日打卡区域'
    );
    next = replaceOnce(
      next,
      `  document.querySelectorAll('[data-task]').forEach((button) => {\n    button.onclick = () => taskSubmissionForm(taskResult.tasks.find((task) => task.id === button.dataset.task));\n  });`,
      `  document.querySelectorAll('[data-health-slot]').forEach((button) => {\n    button.onclick = () => checkinForm(button.dataset.healthSlot);\n  });\n  document.querySelectorAll('[data-task]').forEach((button) => {\n    button.onclick = () => taskSubmissionForm(taskResult.tasks.find((task) => task.id === button.dataset.task));\n  });`,
      '健康自律打卡按钮事件'
    );
    next = replaceOnce(
      next,
      `function checkinForm(slotId) {\n  beginNavigation();\n  const slot = config.slots.find((item) => item.id === slotId);`,
      `function checkinForm(slotId) {\n  beginNavigation();\n  const healthSettings = config.healthCheckinSettings || {};\n  const slots = Array.isArray(healthSettings.slots) && healthSettings.slots.length\n    ? healthSettings.slots : (Array.isArray(config.slots) ? config.slots : []);\n  const photoLimit = Math.min(8, Math.max(1, Number(healthSettings.personalImageLimit || 3)));\n  const slot = slots.find((item) => item.id === slotId);\n  if (!slot) {\n    alert('当前餐次设置不存在，请联系管理员。');\n    return home();\n  }`,
      '健康自律打卡表单配置读取'
    );
    next = replaceOnce(
      next,
      '<label>餐食水印截图（可多选）</label><input required name="photos" type="file" accept="image/*" multiple>',
      '<label>餐食水印截图（可多选，最多 ${photoLimit} 张）</label><input required name="photos" type="file" accept="image/*" multiple>',
      '健康自律照片数量提示'
    );
    next = replaceOnce(
      next,
      "      const photos = await readFiles(form.photos.files, { businessType: 'meal-checkin', limit: 3 });",
      "      const photos = await readFiles(form.photos.files, { businessType: 'meal-checkin', limit: photoLimit });",
      '健康自律前端照片数量限制'
    );
    next = replaceOnce(
      next,
      `      await api('/api/checkins', {\n        method: 'POST',\n        body: JSON.stringify({\n          date,\n          slotId,\n          photoMediaIds: photos.map((item) => item.mediaId),\n          summaryMediaId: summary?.mediaId || null,\n          note: form.note.value\n        })\n      });\n      returnToCachedStudentHome('个人打卡成功');`,
      `      const result = await api('/api/checkins', {\n        method: 'POST',\n        body: JSON.stringify({\n          date,\n          slotId,\n          photoMediaIds: photos.map((item) => item.mediaId),\n          summaryMediaId: summary?.mediaId || null,\n          note: form.note.value\n        })\n      });\n      patchStudentHealthCheckin({\n        id: result.id,\n        date,\n        slotId,\n        note: form.note.value,\n        status: 'pending',\n        submittedAt: new Date().toISOString(),\n        reviewNote: ''\n      });\n      returnToCachedStudentHome('个人打卡成功');`,
      '健康自律打卡后首页缓存刷新'
    );
    next += `\n${marker}\n`;
    write(file, next);
  }
}

console.log('Applied health-track client check-in cards and settings-aware form.');
