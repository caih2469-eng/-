const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

test('阶段10签名会话、权限隔离、安全头和登录限流', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase10-sec-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '安全测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users: [
      { id: 'admin', studentId: 'admin', name: '管理员', password: 'pass', role: 'admin', campus: '', trackId: null, status: 'active', createdAt: now },
      { id: 'u1', studentId: 'u1', name: '学生', password: 'pass', role: 'student', campus: '旗山', trackId: 'health', status: 'active', createdAt: now }
    ], teams: [], tasks: [], taskSubmissions: [], memberCheckins: [], checkins: []
  }));
  const port = 3393;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, SESSION_SECRET: 'test-secret-at-least-random-in-production' }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  for (let i = 0; i < 50; i += 1) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: 'u1', password: 'pass' }) });
  const { token } = await login.json();
  assert.match(token, /^[^.]+\.[^.]+$/);
  assert.equal(login.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}x` } })).status, 401);
  assert.equal((await fetch(`${base}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  for (let i = 0; i < 10; i += 1) {
    await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify({ studentId: 'missing', password: 'wrong' }) });
  }
  assert.equal((await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify({ studentId: 'missing', password: 'wrong' }) })).status, 429);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.match(stored.users.find((item) => item.id === 'u1').password, /^scrypt:/);
});
