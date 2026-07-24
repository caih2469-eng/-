const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { migratePhase7 } = require('../lib/model');

const projectRoot = path.join(__dirname, '..');
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

test('阶段 7 迁移初始化冻结快照与排名排除字段', () => {
  const data = { plazaPosts: [{ id: 'p1' }] };
  assert.equal(migratePhase7(data), true);
  assert.deepEqual(data.rankingFreezes, []);
  assert.equal(data.plazaPosts[0].excludedFromRanking, false);
  assert.equal(migratePhase7(data), false);
});

test('归一化日榜、月队伍榜、冻结与 Excel 导出', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase7-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date();
  const iso = now.toISOString();
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  const monthKey = dateKey.slice(0, 7);
  const user = (id, role = 'student') => ({ id, studentId: id, name: id, password: 'pass', role, campus: '旗山', trackId: role === 'admin' ? null : 'interaction', status: 'active', createdAt: iso });
  const post = (id, teamId, teamName, excludedFromRanking = false) => ({ id, submissionId: `s-${id}`, taskId: 'task', taskName: '任务', teamId, teamName, members: [], images: [], copy: '', publishedAt: iso, viewCount: 0, likedBy: [], status: 'visible', excludedFromRanking });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '排行测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users: [user('admin', 'admin'), user('u1'), user('u2'), user('u3')],
    teams: [], tasks: [], taskSubmissions: [], checkins: [],
    plazaPosts: [post('p1', 't1', '甲队'), post('p2', 't2', '乙队'), post('p3', 't3', '排除队', true)],
    plazaLikes: [
      { postId: 'p1', userId: 'u1', likedAt: iso }, { postId: 'p1', userId: 'u2', likedAt: iso },
      { postId: 'p2', userId: 'u1', likedAt: iso }, { postId: 'p3', userId: 'u3', likedAt: iso }
    ],
    plazaViews: [
      { postId: 'p1', userId: 'u1', windowStartedAt: `${iso}-1`, viewedAt: iso },
      ...['u1', 'u2', 'u3'].map((userId, index) => ({ postId: 'p2', userId, windowStartedAt: `${iso}-${index}`, viewedAt: iso }))
    ],
    rankingFreezes: []
  }));
  const port = 3327;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: path.join(temp, 'uploads') }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  await wait(base);
  const admin = await login(base, 'admin');
  const student = await login(base, 'u1');
  const daily = await call(base, `/api/rankings?period=day&key=${dateKey}`, { token: student });
  assert.equal(daily.status, 200);
  assert.equal(daily.body.likeRank[0].teamName, '甲队');
  assert.equal(daily.body.viewRank[0].teamName, '乙队');
  assert.equal(daily.body.heatRank[0].teamName, '甲队');
  assert.equal(daily.body.heatRank[0].heatScore, 80);
  assert.equal(daily.body.heatRank.some((item) => item.teamName === '排除队'), false);

  const monthly = await call(base, `/api/rankings?period=month&key=${monthKey}`, { token: student });
  assert.equal(monthly.body.teamRank[0].publicCount, 1);
  const freeze = await call(base, '/api/admin/rankings/freeze', { method: 'POST', token: admin, body: JSON.stringify({ month: monthKey }) });
  assert.equal(freeze.status, 201);
  assert.equal((await call(base, '/api/admin/rankings/freeze', { method: 'POST', token: admin, body: JSON.stringify({ month: monthKey }) })).status, 409);
  const frozen = await call(base, `/api/rankings?period=month&key=${monthKey}`, { token: student });
  assert.equal(frozen.body.frozen, true);
  assert.deepEqual(frozen.body.teamRank, freeze.body.snapshot.teamRank);

  assert.equal((await call(base, `/api/admin/rankings/export?month=${monthKey}`, { token: student })).status, 403);
  const exported = await call(base, `/api/admin/rankings/export?month=${monthKey}`, { token: admin });
  assert.equal(exported.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(exported.body.file, 'base64'));
  assert.equal(workbook.worksheets[0].getCell('B2').value, '甲队');
  assert.match(exported.body.filename, /已冻结/);
});
