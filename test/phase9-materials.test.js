const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { migratePhase9 } = require('../lib/model');

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

test('阶段 9 迁移初始化材料任务和提交', () => {
  const data = {};
  assert.equal(migratePhase9(data), true);
  assert.deepEqual(data.materialTasks, []);
  assert.deepEqual(data.materialSubmissions, []);
  assert.equal(migratePhase9(data), false);
});

test('个人最终截图、退回修改、未交名单和文件权限', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase9-'));
  const dataDir = path.join(temp, 'data');
  const fileDir = path.join(temp, 'protected');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date();
  const iso = now.toISOString();
  const student = (id, trackId, studentId) => ({ id, studentId, name: id, password: 'pass', role: 'student', campus: '旗山', trackId, status: 'active', createdAt: iso });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '材料测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users: [
      { id: 'admin', studentId: 'admin', name: '管理员', password: 'pass', role: 'admin', campus: '', trackId: null, status: 'active', createdAt: iso },
      student('u1', 'interaction', '202600000000000001'), student('u2', 'interaction', '202600000000000002'), student('h1', 'health', '202600000000000003')
    ],
    teams: [{ id: 't1', name: '材料队', memberLimit: 4, inviteCode: 'ABCDEFGH', memberIds: ['u1', 'u2'], createdAt: iso }],
    tasks: [], taskSubmissions: [], checkins: [], plazaPosts: [], plazaLikes: [], plazaViews: [], rankingFreezes: [], materialTasks: [], materialSubmissions: []
  }));
  const port = 3329;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: path.join(temp, 'uploads'), CHECKIN_MATERIAL_FILE_DIR: fileDir }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  await wait(base);
  const admin = await login(base, 'admin');
  const u1 = await login(base, '202600000000000001');
  const u2 = await login(base, '202600000000000002');
  const health = await login(base, '202600000000000003');
  const future = new Date(now.getTime() + 3600000).toISOString();

  const createTask = (submissionMode, title) => call(base, '/api/admin/material-tasks', { method: 'POST', token: admin, body: JSON.stringify({ title, description: '请提交截图', deadline: future, fileTypes: 'png,jpg', fileLimit: 2, summaryRequired: true, submissionMode }) });
  const individual = await createTask('individual', '个人总结');
  const team = await createTask('team', '最终截图');
  assert.equal(individual.status, 201);
  assert.equal(team.status, 201);

  const individualSubmit = await call(base, `/api/material-tasks/${individual.body.task.id}/submission`, { method: 'PUT', token: health, body: JSON.stringify({ version: 0, files: [{ name: '个人总结.png', data: png }], summary: '个人文字总结' }) });
  assert.equal(individualSubmit.status, 201);
  const individualFile = individualSubmit.body.submission.files[0];
  assert.equal(fs.readdirSync(fileDir).length, 1);
  assert.equal((await fetch(base + individualFile.downloadUrl)).status, 401);
  assert.equal((await fetch(base + individualFile.downloadUrl, { headers: { Authorization: `Bearer ${u1}` } })).status, 403);
  assert.equal((await fetch(base + individualFile.downloadUrl, { headers: { Authorization: `Bearer ${health}` } })).status, 200);
  assert.equal((await fetch(base + individualFile.downloadUrl, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);

  assert.equal(team.body.task.submissionMode, 'individual');
  const teamSubmit = await call(base, `/api/material-tasks/${team.body.task.id}/submission`, { method: 'PUT', token: u1, body: JSON.stringify({ version: 0, files: [{ name: '最终截图.png', data: png }], summary: '个人总结' }) });
  assert.equal(teamSubmit.status, 201);
  const teamUrl = teamSubmit.body.submission.files[0].downloadUrl;
  assert.equal((await fetch(base + teamUrl, { headers: { Authorization: `Bearer ${u2}` } })).status, 403);
  assert.equal((await call(base, `/api/material-tasks/${team.body.task.id}/submission`, { method: 'PUT', token: health, body: JSON.stringify({ version: 0, files: [{ name: '个人截图.png', data: png }], summary: '个人提交' }) })).status, 201);

  const returned = await call(base, `/api/admin/material-submissions/${teamSubmit.body.submission.id}`, { method: 'PATCH', token: admin, body: JSON.stringify({ reviewNote: '请补充封面' }) });
  assert.equal(returned.status, 200);
  assert.equal(returned.body.submission.status, 'returned');
  const resubmit = await call(base, `/api/material-tasks/${team.body.task.id}/submission`, { method: 'PUT', token: u1, body: JSON.stringify({ version: returned.body.submission.version, files: [{ name: '最终截图新版.png', data: png }], summary: '已补充封面' }) });
  assert.equal(resubmit.status, 200);
  assert.equal(resubmit.body.submission.status, 'submitted');

  const missing = await call(base, `/api/admin/material-tasks/${individual.body.task.id}/missing-export`, { token: admin });
  assert.equal(missing.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(missing.body.file, 'base64'));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getColumn(3).numFmt, '@');
  assert.ok([...Array(sheet.rowCount - 1)].map((_, index) => sheet.getCell(index + 2, 3).value).includes('202600000000000001'));
  assert.equal((await call(base, `/api/admin/material-tasks/${individual.body.task.id}/missing-export`, { token: u1 })).status, 403);
});
