const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { migratePhase3, migratePhase4 } = require('../lib/model');

const projectRoot = path.join(__dirname, '..');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function wait(baseUrl) {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(baseUrl)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server timeout');
}
async function request(baseUrl, route, options = {}) {
  const response = await fetch(baseUrl + route, { ...options, headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) } });
  return { status: response.status, body: await response.json() };
}
async function login(baseUrl, id) {
  const response = await request(baseUrl, '/api/login', { method: 'POST', body: JSON.stringify({ studentId: id, password: 'pass' }) });
  assert.equal(response.status, 200);
  return response.body.token;
}

test('阶段 3 和 4 迁移可重复执行', () => {
  const data = { config: {} };
  assert.equal(migratePhase3(data), true);
  assert.equal(data.config.activityEnabled, true);
  assert.deepEqual(data.config.trackEnabled, { interaction: true, health: true });
  assert.equal(migratePhase4(data), true);
  assert.deepEqual(data.taskSubmissions, []);
  assert.equal(migratePhase3(data), false);
  assert.equal(migratePhase4(data), false);
});

test('任务、开关、队伍/个人提交、重复与并发保护', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase34-'));
  const dataDir = path.join(root, 'data');
  const uploadDir = path.join(root, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date();
  const users = [
    ['admin', 'admin', null, 'admin'], ['u1', 'i1', 'interaction', 'student'],
    ['u2', 'i2', 'interaction', 'student'], ['u3', 'h1', 'health', 'student']
  ].map(([id, studentId, trackId, role]) => ({ id, studentId, name: id, password: 'pass', role, campus: '旗山', trackId, status: 'active', createdAt: now.toISOString() }));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users, teams: [{ id: 'team1', name: '同心队', memberLimit: 4, inviteCode: 'ABCDEFGH', memberIds: ['u1', 'u2'], createdAt: now.toISOString() }],
    tasks: [], taskSubmissions: [], checkins: []
  }));
  const port = 3321;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: uploadDir }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  await wait(baseUrl);
  const admin = await login(baseUrl, 'admin');
  const i1 = await login(baseUrl, 'i1');
  const i2 = await login(baseUrl, 'i2');
  const h1 = await login(baseUrl, 'h1');
  const startAt = new Date(now.getTime() - 3600000).toISOString();
  const endAt = new Date(now.getTime() + 3600000).toISOString();
  const create = (trackId, name) => request(baseUrl, '/api/admin/tasks', { method: 'POST', token: admin, body: JSON.stringify({ name, description: '说明', trackId, startAt, endAt, allowLate: false, imageLimit: 2, copyRequirement: '填写说明', status: 'published' }) });
  const interaction = await create('interaction', '队伍任务');
  const health = await create('health', '三餐任务');
  assert.equal(interaction.status, 201);
  assert.equal(health.status, 201);

  const route = `/api/tasks/${interaction.body.task.id}/submission`;
  const draft = await request(baseUrl, route, { method: 'PUT', token: i1, body: JSON.stringify({ intent: 'draft', version: 0, images: [png], copy: '队伍材料', isPublic: true }) });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.submission.ownerType, 'team');
  const stale = await request(baseUrl, route, { method: 'PUT', token: i2, body: JSON.stringify({ intent: 'draft', version: 0, copy: '覆盖' }) });
  assert.equal(stale.status, 409);
  const submitted = await request(baseUrl, route, { method: 'PUT', token: i2, body: JSON.stringify({ intent: 'submit', version: 1, copy: '最终材料' }) });
  assert.equal(submitted.status, 200);
  const duplicate = await request(baseUrl, route, { method: 'PUT', token: i1, body: JSON.stringify({ intent: 'submit', version: 2, copy: '重复' }) });
  assert.equal(duplicate.status, 409);

  const healthRoute = `/api/tasks/${health.body.task.id}/submission`;
  const healthSubmit = await request(baseUrl, healthRoute, { method: 'PUT', token: h1, body: JSON.stringify({ intent: 'submit', version: 0, images: [png], copy: '早餐', mealType: 'breakfast' }) });
  assert.equal(healthSubmit.status, 201);
  const history = await request(baseUrl, '/api/submissions/history', { token: h1 });
  assert.equal(history.body.submissions[0].mealType, 'breakfast');
  const off = await request(baseUrl, '/api/admin/activity-switches', { method: 'PATCH', token: admin, body: JSON.stringify({ activityEnabled: false }) });
  assert.equal(off.status, 200);
  const blocked = await request(baseUrl, healthRoute, { method: 'PUT', token: h1, body: JSON.stringify({ intent: 'draft', version: 1 }) });
  assert.equal(blocked.status, 409);
  assert.ok(fs.readdirSync(uploadDir).length >= 2);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(stored.taskSubmissions.every((item) => item.images.every((url) => url.startsWith('/uploads/'))));
});
