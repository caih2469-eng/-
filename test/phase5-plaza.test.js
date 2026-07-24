const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { migratePhase5 } = require('../lib/model');

const rootDir = path.join(__dirname, '..');
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
  const result = await call(base, '/api/login', { method: 'POST', body: JSON.stringify({ studentId, password: 'pass' }) });
  assert.equal(result.status, 200);
  return result.body.token;
}

test('阶段 5 迁移初始化活动广场', () => {
  const data = {};
  assert.equal(migratePhase5(data), true);
  assert.deepEqual(data.plazaPosts, []);
  assert.equal(migratePhase5(data), false);
});

test('公开队伍提交自动发帖、排行分页点赞浏览和管理员管理', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase5-'));
  const dataDir = path.join(temp, 'data');
  const uploadDir = path.join(temp, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date();
  const user = (id, role, trackId) => ({ id, studentId: id, name: id, password: 'pass', role, campus: '旗山', trackId, status: 'active', createdAt: now.toISOString() });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '广场测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users: [user('admin', 'admin', null), user('u1', 'student', 'interaction'), user('u2', 'student', 'interaction'), user('h1', 'student', 'health')],
    teams: [{ id: 't1', name: '四校同行队', memberLimit: 4, inviteCode: '12345678', memberIds: ['u1', 'u2'], createdAt: now.toISOString() }],
    tasks: [
      { id: 'task-i', name: '校园合影', description: '', trackId: 'interaction', startAt: new Date(now - 3600000).toISOString(), endAt: new Date(now.getTime() + 3600000).toISOString(), allowLate: false, imageLimit: 3, copyRequirement: '', status: 'published', createdAt: now.toISOString(), updatedAt: now.toISOString() },
      { id: 'task-h', name: '早餐', description: '', trackId: 'health', startAt: new Date(now - 3600000).toISOString(), endAt: new Date(now.getTime() + 3600000).toISOString(), allowLate: false, imageLimit: 3, copyRequirement: '', status: 'published', createdAt: now.toISOString(), updatedAt: now.toISOString() }
    ],
    taskSubmissions: [], plazaPosts: [], checkins: []
  }));
  const port = 3324;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: rootDir, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: uploadDir }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  await wait(base);
  const admin = await login(base, 'admin');
  const member = await login(base, 'u1');
  const otherMember = await login(base, 'u2');
  const health = await login(base, 'h1');

  const publicSubmit = await call(base, '/api/tasks/task-i/submission', { method: 'PUT', token: member, body: JSON.stringify({ intent: 'submit', version: 0, images: [png], copy: '四校青春同行', plazaCopy: '四校青春同行', isPublic: true }) });
  assert.equal(publicSubmit.status, 201);
  const privateHealth = await call(base, '/api/tasks/task-h/submission', { method: 'PUT', token: health, body: JSON.stringify({ intent: 'submit', version: 0, images: [png], copy: '早餐', mealType: 'breakfast', isPublic: true }) });
  assert.equal(privateHealth.status, 201);

  const latest = await call(base, '/api/plaza?sort=latest&page=1&limit=1', { token: member });
  assert.equal(latest.status, 200);
  assert.equal(latest.body.total, 1);
  assert.equal(latest.body.posts[0].teamName, '四校同行队');
  assert.deepEqual(latest.body.posts[0].members.map((item) => item.name), ['u1', 'u2']);
  const postId = latest.body.posts[0].id;

  assert.equal((await call(base, `/api/plaza/${postId}/view`, { method: 'POST', token: member })).body.viewCount, 1);
  assert.equal((await call(base, `/api/plaza/${postId}/like`, { method: 'POST', token: member, body: '{"liked":true}' })).body.likeCount, 1);
  assert.equal((await call(base, `/api/plaza/${postId}/like`, { method: 'POST', token: member, body: '{"liked":false}' })).body.likeCount, 0);
  assert.equal((await call(base, `/api/plaza/${postId}/like`, { method: 'POST', token: otherMember, body: '{"liked":true}' })).body.likeCount, 1);
  const monthly = await call(base, `/api/plaza?sort=monthly&month=${now.toISOString().slice(0, 7)}&page=1&limit=6`, { token: member });
  assert.equal(monthly.body.total, 1);
  assert.equal((await call(base, '/api/plaza', { method: 'POST', token: member, body: '{}' })).status, 403);

  assert.equal((await call(base, `/api/admin/plaza/${postId}`, { method: 'PATCH', token: admin, body: JSON.stringify({ status: 'hidden' }) })).status, 200);
  assert.equal((await call(base, '/api/plaza', { token: member })).body.total, 0);
  assert.equal((await call(base, `/api/admin/plaza/${postId}`, { method: 'PATCH', token: admin, body: JSON.stringify({ status: 'visible' }) })).status, 200);
  assert.equal((await call(base, '/api/plaza', { token: member })).body.total, 1);
  assert.equal((await call(base, `/api/admin/plaza/${postId}`, { method: 'DELETE', token: admin })).status, 200);
  assert.equal((await call(base, '/api/plaza', { token: member })).body.total, 0);
});
