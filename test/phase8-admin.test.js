const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');

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

test('阶段 8 看板、审核删除、排名排除和六类权限导出', async (context) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase8-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = new Date();
  const iso = now.toISOString();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  const month = date.slice(0, 7);
  const users = [
    { id: 'admin', studentId: 'admin', name: '管理员', password: 'pass', role: 'admin', campus: '', trackId: null, status: 'active', createdAt: iso },
    { id: 'u1', studentId: '202600000000000001', name: '张三', password: 'pass', role: 'student', campus: '旗山', trackId: 'interaction', status: 'active', createdAt: iso },
    { id: 'u2', studentId: '202600000000000002', name: '李四', password: 'pass', role: 'student', campus: '安溪', trackId: 'health', status: 'active', createdAt: iso }
  ];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    config: { activityName: '后台测试', maxTeams: 50, slots: [{ id: 'breakfast', label: '早餐', start: '06:00', end: '10:00' }], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
    tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
    users,
    teams: [{ id: 't1', name: '测试队', memberLimit: 4, inviteCode: 'ABCDEFGH', memberIds: ['u1'], createdAt: iso }],
    tasks: [{ id: 'task1', name: '合影任务', trackId: 'interaction' }],
    taskSubmissions: [{ id: 's1', taskId: 'task1', ownerType: 'team', ownerId: 't1', submittedBy: 'u1', images: ['/uploads/a.jpg'], copy: '材料', isPublic: true, status: 'submitted', version: 1, createdAt: iso, updatedAt: iso, submittedAt: iso }],
    checkins: [{ id: 'c1', userId: 'u2', date, slotId: 'breakfast', photos: ['/uploads/b.jpg'], note: '', submittedAt: iso, status: 'pending' }],
    plazaPosts: [{ id: 'p1', submissionId: 's1', taskId: 'task1', taskName: '合影任务', teamId: 't1', teamName: '测试队', members: [{ id: 'u1', name: '张三', campus: '旗山' }], images: ['/uploads/a.jpg'], copy: '材料', publishedAt: iso, viewCount: 1, likedBy: [], status: 'visible', excludedFromRanking: false }],
    plazaLikes: [{ postId: 'p1', userId: 'u2', likedAt: iso }],
    plazaViews: [{ postId: 'p1', userId: 'u2', windowStartedAt: iso, viewedAt: iso }],
    rankingFreezes: []
  }));
  const port = 3328;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: path.join(temp, 'uploads') }, stdio: 'ignore' });
  context.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  await wait(base);
  const admin = await login(base, 'admin');
  const student = await login(base, '202600000000000001');

  const overview = await call(base, '/api/admin/overview', { token: admin });
  assert.deepEqual(overview.body, { userCount: 2, teamCount: 1, todaySubmissions: 2, publicPostCount: 1, likeCount: 1, viewCount: 1 });
  assert.equal((await call(base, '/api/admin/overview', { token: student })).status, 403);

  const exclude = await call(base, '/api/admin/plaza/p1', { method: 'PATCH', token: admin, body: JSON.stringify({ excludedFromRanking: true }) });
  assert.equal(exclude.status, 200);
  assert.equal(exclude.body.post.excludedFromRanking, true);
  const ranking = await call(base, `/api/rankings?period=month&key=${month}`, { token: student });
  assert.equal(ranking.body.teamRank.length, 0);

  for (const type of ['users', 'teams', 'checkins', 'missing', 'rankings', 'materials']) {
    assert.equal((await call(base, `/api/admin/exports/${type}?date=${date}&month=${month}`, { token: student })).status, 403);
    const exported = await call(base, `/api/admin/exports/${type}?date=${date}&month=${month}`, { token: admin });
    assert.equal(exported.status, 200, type);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(exported.body.file, 'base64'));
    assert.ok(workbook.worksheets[0].name.length > 0);
    if (type === 'users') {
      assert.equal(workbook.worksheets[0].getCell('B2').value, '202600000000000001');
      assert.equal(workbook.worksheets[0].getColumn(2).numFmt, '@');
    }
  }

  const removed = await call(base, '/api/admin/submissions/s1', { method: 'DELETE', token: admin });
  assert.equal(removed.status, 200);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(stored.taskSubmissions.length, 0);
  assert.equal(stored.plazaPosts.length, 0);
  assert.equal(stored.plazaLikes.length, 0);
  assert.equal(stored.plazaViews.length, 0);
});
