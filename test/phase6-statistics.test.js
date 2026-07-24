const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { migratePhase6 } = require('../lib/model');

const projectRoot = path.join(__dirname, '..');
async function wait(base) {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server timeout');
}
async function call(base, route, options = {}) {
  const response = await fetch(base + route, { ...options, headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) } });
  return { status: response.status, body: await response.json() };
}

test('阶段 6 迁移建立独立点赞和浏览记录', () => {
  const data = { plazaPosts: [{ id: 'p1', likedBy: ['u1'], viewCount: 1, status: 'visible' }] };
  assert.equal(migratePhase6(data, '2026-07-24T00:00:00.000Z'), true);
  assert.deepEqual(data.plazaLikes, [{ postId: 'p1', userId: 'u1', likedAt: '2026-07-24T00:00:00.000Z' }]);
  assert.deepEqual(data.plazaViews, []);
  assert.equal(migratePhase6(data), false);
});

test('并发点赞额度、幂等请求、取消恢复和 24 小时浏览去重', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase6-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date().toISOString();
  const posts = Array.from({ length: 7 }, (_, index) => ({
    id: `p${index + 1}`, submissionId: `s${index + 1}`, taskId: `t${index + 1}`,
    taskName: `任务${index + 1}`, teamId: 'team', teamName: '测试队',
    members: [{ id: 'u1', name: '学生', campus: '旗山' }], images: ['/uploads/test.jpg'],
    copy: '测试', publishedAt: now, viewCount: 0, likedBy: [], status: 'visible'
  }));
  const user = (id, role) => ({ id, studentId: id, name: id, password: 'pass', role, campus: '旗山', trackId: role === 'admin' ? null : 'interaction', status: 'active', createdAt: now });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '统计测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users: [user('admin', 'admin'), user('u1', 'student')], teams: [], tasks: [], taskSubmissions: [],
    plazaPosts: posts, plazaLikes: [], plazaViews: [], checkins: []
  }));
  const port = 3326;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: path.join(temp, 'uploads') }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  await wait(base);
  const login = async (id) => (await call(base, '/api/login', { method: 'POST', body: JSON.stringify({ studentId: id, password: 'pass' }) })).body.token;
  const token = await login('u1');
  const admin = await login('admin');

  const duplicates = await Promise.all(Array.from({ length: 5 }, () => call(base, '/api/plaza/p1/like', { method: 'POST', token, body: '{"liked":true}' })));
  assert.ok(duplicates.every((result) => result.status === 200));
  assert.ok(duplicates.every((result) => result.body.likeCount === 1));

  const quotaRace = await Promise.all(['p2', 'p3', 'p4', 'p5', 'p6'].map((id) => call(base, `/api/plaza/${id}/like`, { method: 'POST', token, body: '{"liked":true}' })));
  assert.equal(quotaRace.filter((result) => result.status === 200).length, 4);
  assert.equal(quotaRace.filter((result) => result.status === 429).length, 1);
  const storedAtLimit = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(storedAtLimit.plazaLikes.filter((like) => like.userId === 'u1').length, 5);

  const cancel = await call(base, '/api/plaza/p1/like', { method: 'POST', token, body: '{"liked":false}' });
  assert.equal(cancel.body.likeQuota.remaining, 1);
  const restored = await call(base, '/api/plaza/p7/like', { method: 'POST', token, body: '{"liked":true}' });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.likeQuota.remaining, 0);

  const views = await Promise.all(Array.from({ length: 8 }, () => call(base, '/api/plaza/p1/view', { method: 'POST', token })));
  assert.equal(views.filter((result) => result.body.counted).length, 1);
  assert.ok(views.every((result) => result.body.viewCount === 1));
  const adminView = await call(base, '/api/plaza/p1/view', { method: 'POST', token: admin });
  assert.equal(adminView.body.counted, false);
  assert.equal(adminView.body.viewCount, 1);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(stored.plazaViews.length, 1);
  assert.equal(new Set(stored.plazaLikes.map((like) => `${like.postId}:${like.userId}`)).size, stored.plazaLikes.length);
});
