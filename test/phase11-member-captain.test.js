const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const rootProject = path.join(__dirname, '..');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const request = async (base, route, token, method = 'GET', body) => {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const login = async (base, studentId) => (await request(base, '/api/login', null, 'POST', { studentId, password: 'pass' })).body.token;

test('个人打卡进度、队长权限与全员完成校验', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase11-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date();
  const user = (id, role = 'student') => ({ id, studentId: id, name: id, password: 'pass', role, campus: '校区', trackId: role === 'student' ? 'interaction' : null, status: 'active', createdAt: now.toISOString() });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users: [user('admin', 'admin'), user('captain'), user('member')],
    teams: [{ id: 't1', name: '一队', memberLimit: 4, memberIds: ['captain', 'member'], captainId: 'captain', inviteCode: 'ABCDEFGH', createdAt: now.toISOString() }],
    tasks: [{ id: 'task', name: '任务', description: '', trackId: 'interaction', scheduleType: 'oneTime', startAt: new Date(now - 60000).toISOString(), endAt: new Date(now.getTime() + 3600000).toISOString(), allowLate: false, imageLimit: 3, copyRequirement: '', status: 'published' }],
    taskSubmissions: [], memberCheckins: [], checkins: []
  }));
  const port = 3391;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: rootProject, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: path.join(temp, 'uploads') }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  for (let i = 0; i < 40; i += 1) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
  const captain = await login(base, 'captain');
  const member = await login(base, 'member');
  assert.equal((await request(base, '/api/tasks/task/member-checkin', captain, 'PUT', { images: [png] })).status, 201);
  const progress = await request(base, '/api/tasks', captain);
  assert.equal(progress.body.tasks[0].teamProgress.completed, 1);
  assert.equal((await request(base, '/api/tasks/task/submission', member, 'PUT', { intent: 'draft', version: 0 })).status, 403);
  assert.equal((await request(base, '/api/tasks/task/submission', captain, 'PUT', { intent: 'submit', version: 0, images: [png] })).status, 409);
  assert.equal((await request(base, '/api/tasks/task/member-checkin', member, 'PUT', { images: [png] })).status, 201);
  assert.equal((await request(base, '/api/tasks/task/submission', captain, 'PUT', { intent: 'submit', version: 0, images: [png] })).status, 201);
});
