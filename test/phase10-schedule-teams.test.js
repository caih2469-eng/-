const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { migratePhase10 } = require('../lib/model');

const projectRoot = path.join(__dirname, '..');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function wait(url) {
  for (let index = 0; index < 50; index += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server timeout');
}
async function call(base, route, options = {}) {
  const response = await fetch(base + route, { ...options, headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) } });
  return { status: response.status, body: await response.json() };
}
async function login(base, studentId) {
  const response = await call(base, '/api/login', { method: 'POST', body: JSON.stringify({ studentId, password: 'pass' }) });
  assert.equal(response.status, 200);
  return response.body.token;
}

test('任务日程与统一编队迁移默认关闭学生自助加入', () => {
  const data = { config: {}, tasks: [{}], taskSubmissions: [{ copy: '旧文案' }] };
  assert.equal(migratePhase10(data), true);
  assert.equal(data.config.allowSelfJoin, false);
  assert.equal(data.tasks[0].scheduleType, 'oneTime');
  assert.equal(data.taskSubmissions[0].occurrenceDate, null);
  assert.equal(data.taskSubmissions[0].plazaCopy, '旧文案');
  assert.equal(migratePhase10(data), false);
});

test('周一三五当天任务、广场文案、Excel 编队及管理员成员调整', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase10-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date();
  const iso = now.toISOString();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  const otherWeekday = weekday === 7 ? 1 : weekday + 1;
  const student = (index, trackId = 'interaction') => ({ id: `u${index}`, studentId: `2026000${index}`, name: `学生${index}`, password: 'pass', role: 'student', campus: '旗山', trackId, status: 'active', createdAt: iso });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '日程测试', maxTeams: 50, allowSelfJoin: false, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users: [{ id: 'admin', studentId: 'admin', name: '管理员', password: 'pass', role: 'admin', campus: '', trackId: null, status: 'active', createdAt: iso }, student(1), student(2), student(3), student(4), student(5), student(6, 'health')],
    teams: [], tasks: [], taskSubmissions: [], checkins: [], plazaPosts: [], plazaLikes: [], plazaViews: [], rankingFreezes: [], materialTasks: [], materialSubmissions: []
  }));
  const port = 3330;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: path.join(temp, 'uploads'), CHECKIN_MATERIAL_FILE_DIR: path.join(temp, 'files') }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  await wait(base);
  const admin = await login(base, 'admin');
  const u1 = await login(base, '20260001');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('队伍');
  sheet.addRow(['队伍名称', '成员1学号', '成员2学号', '成员3学号', '成员4学号']);
  sheet.addRow(['第一队', '20260001', '20260002', '20260003', '20260004']);
  const file = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')}`;
  const imported = await call(base, '/api/admin/teams/import', { method: 'POST', token: admin, body: JSON.stringify({ file }) });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.importedMembers, 4);
  const team = (await call(base, '/api/admin/teams', { token: admin })).body.teams[0];
  assert.equal(team.memberCount, 4);
  assert.equal((await call(base, '/api/teams/join', { method: 'POST', token: u1, body: JSON.stringify({ inviteCode: team.inviteCode }) })).status, 403);

  await call(base, `/api/admin/teams/${team.id}/members/u4`, { method: 'DELETE', token: admin });
  assert.equal((await call(base, `/api/admin/teams/${team.id}/members`, { method: 'POST', token: admin, body: JSON.stringify({ studentId: '20260005' }) })).status, 200);

  const createTask = (refreshDays, name) => call(base, '/api/admin/tasks', { method: 'POST', token: admin, body: JSON.stringify({
    name, description: '当天提交', trackId: 'interaction', scheduleType: 'activityDays',
    activeStartDate: today, activeEndDate: today, refreshDays, dailyStart: '00:00', dailyEnd: '23:59',
    imageLimit: 3, copyRequirement: '', status: 'published'
  }) });
  const activeTask = await createTask([1], '今日四校区任务');
  await createTask([2], '非今日任务');
  assert.equal(activeTask.status, 201);
  const tasks = await call(base, '/api/tasks', { token: u1 });
  assert.equal(tasks.body.tasks.length, 1);
  assert.equal(tasks.body.tasks[0].occurrenceDate, today);
  assert.equal(tasks.body.tasks[0].allowLate, false);

  const taskRoute = `/api/tasks/${activeTask.body.task.id}/submission`;
  const tooMany = await call(base, taskRoute, { method: 'PUT', token: u1, body: JSON.stringify({ intent: 'submit', version: 0, occurrenceDate: today, images: [png, png, png, png], copy: '', isPublic: false }) });
  assert.equal(tooMany.status, 400);
  const noPlazaCopy = await call(base, taskRoute, { method: 'PUT', token: u1, body: JSON.stringify({ intent: 'submit', version: 0, occurrenceDate: today, images: [png], copy: '', isPublic: true }) });
  assert.equal(noPlazaCopy.status, 400);
  const submitted = await call(base, taskRoute, { method: 'PUT', token: u1, body: JSON.stringify({ intent: 'submit', version: 0, occurrenceDate: today, images: [png], copy: '', plazaCopy: '青春同行作品说明', isPublic: true }) });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.submission.occurrenceDate, today);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(stored.plazaPosts[0].copy, '青春同行作品说明');
});
