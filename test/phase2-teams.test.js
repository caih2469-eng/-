const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { migratePhase2 } = require('../lib/model');

const projectRoot = path.join(__dirname, '..');

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('测试服务器启动超时');
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    }
  });
  return { status: response.status, body: await response.json() };
}

async function login(baseUrl, studentId, password) {
  const result = await request(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ studentId, password })
  });
  assert.equal(result.status, 200);
  return result.body.token;
}

test('队伍迁移将最大队伍数量持久化为 50', () => {
  const data = { config: {}, teams: undefined };
  assert.equal(migratePhase2(data), true);
  assert.equal(data.config.maxTeams, 50);
  assert.deepEqual(data.teams, []);
  assert.equal(migratePhase2(data), false);
});

test('队伍容量、邀请码、赛道、满员、成员和删除规则', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase2-'));
  const dataDir = path.join(tempRoot, 'data');
  const uploadDir = path.join(tempRoot, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  const now = '2026-07-24T00:00:00.000Z';
  fs.writeFileSync(
    path.join(dataDir, 'db.json'),
    JSON.stringify({
      config: {
        activityName: '测试活动',
        startDate: '2026-09-12',
        endDate: '2026-09-30',
        allowSelfJoin: true,
        slots: []
      },
      tracks: [
        { id: 'interaction', name: '四校区互动赛道' },
        { id: 'health', name: '自律健康赛道' }
      ],
      users: [
        {
          id: 'admin',
          studentId: 'admin',
          name: '管理员',
          password: 'admin-pass',
          role: 'admin',
          campus: '',
          trackId: null,
          status: 'active',
          createdAt: now
        },
        ...[
          ['u1', '20260001', '互动一', 'interaction'],
          ['u2', '20260002', '互动二', 'interaction'],
          ['u3', '20260003', '互动三', 'interaction'],
          ['u4', '20260004', '健康一', 'health']
        ].map(([id, studentId, name, trackId]) => ({
          id,
          studentId,
          name,
          password: 'student-pass',
          role: 'student',
          campus: '旗山',
          trackId,
          status: 'active',
          createdAt: now
        }))
      ],
      checkins: []
    })
  );

  const port = 3318;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      CHECKIN_DATA_DIR: dataDir,
      CHECKIN_UPLOAD_DIR: uploadDir
    },
    stdio: 'ignore'
  });
  context.after(() => {
    server.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  await waitForServer(baseUrl);

  const adminToken = await login(baseUrl, 'admin', 'admin-pass');
  const user1Token = await login(baseUrl, '20260001', 'student-pass');
  const user2Token = await login(baseUrl, '20260002', 'student-pass');
  const user3Token = await login(baseUrl, '20260003', 'student-pass');
  const healthToken = await login(baseUrl, '20260004', 'student-pass');

  const initialTeams = await request(baseUrl, '/api/admin/teams', { token: adminToken });
  assert.equal(initialTeams.body.maxTeams, 50);

  const setCapacity = await request(baseUrl, '/api/admin/team-capacity', {
    method: 'PATCH',
    token: adminToken,
    body: JSON.stringify({ maxTeams: 1 })
  });
  assert.equal(setCapacity.status, 200);

  const createAlpha = await request(baseUrl, '/api/admin/teams', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ name: '四校先锋队', memberLimit: 1 })
  });
  assert.equal(createAlpha.status, 201);
  const alpha = createAlpha.body.team;
  assert.equal(alpha.memberCount, 0);
  assert.equal(alpha.inviteCode.length, 8);

  const overCapacity = await request(baseUrl, '/api/admin/teams', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ name: '超额队伍', memberLimit: 4 })
  });
  assert.equal(overCapacity.status, 409);

  const joinAlpha = await request(baseUrl, '/api/teams/join', {
    method: 'POST',
    token: user1Token,
    body: JSON.stringify({ inviteCode: alpha.inviteCode.toLowerCase() })
  });
  assert.equal(joinAlpha.status, 200);
  assert.equal(joinAlpha.body.team.memberCount, 1);

  const fullTeam = await request(baseUrl, '/api/teams/join', {
    method: 'POST',
    token: user2Token,
    body: JSON.stringify({ inviteCode: alpha.inviteCode })
  });
  assert.equal(fullTeam.status, 409);

  const healthCannotJoin = await request(baseUrl, '/api/teams/join', {
    method: 'POST',
    token: healthToken,
    body: JSON.stringify({ inviteCode: alpha.inviteCode })
  });
  assert.equal(healthCannotJoin.status, 403);

  const cannotDeleteNonEmpty = await request(baseUrl, `/api/admin/teams/${alpha.id}`, {
    method: 'DELETE',
    token: adminToken
  });
  assert.equal(cannotDeleteNonEmpty.status, 409);

  const expandCapacity = await request(baseUrl, '/api/admin/team-capacity', {
    method: 'PATCH',
    token: adminToken,
    body: JSON.stringify({ maxTeams: 2 })
  });
  assert.equal(expandCapacity.status, 200);
  const createBeta = await request(baseUrl, '/api/admin/teams', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({ name: '青春同行队', memberLimit: 4 })
  });
  assert.equal(createBeta.status, 201);
  const beta = createBeta.body.team;

  const cannotJoinSecondTeam = await request(baseUrl, '/api/teams/join', {
    method: 'POST',
    token: user1Token,
    body: JSON.stringify({ inviteCode: beta.inviteCode })
  });
  assert.equal(cannotJoinSecondTeam.status, 409);

  const editAlpha = await request(baseUrl, `/api/admin/teams/${alpha.id}`, {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ name: '四校同心队', memberLimit: 2 })
  });
  assert.equal(editAlpha.status, 200);
  assert.equal(editAlpha.body.team.name, '四校同心队');

  const joinExpandedAlpha = await request(baseUrl, '/api/teams/join', {
    method: 'POST',
    token: user2Token,
    body: JSON.stringify({ inviteCode: alpha.inviteCode })
  });
  assert.equal(joinExpandedAlpha.status, 200);

  const cannotShrinkBelowMembers = await request(baseUrl, `/api/admin/teams/${alpha.id}`, {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ name: '四校同心队', memberLimit: 1 })
  });
  assert.equal(cannotShrinkBelowMembers.status, 400);

  const thirdUserJoinsBeta = await request(baseUrl, '/api/teams/join', {
    method: 'POST',
    token: user3Token,
    body: JSON.stringify({ inviteCode: beta.inviteCode })
  });
  assert.equal(thirdUserJoinsBeta.status, 200);

  const adminTeams = await request(baseUrl, '/api/admin/teams', { token: adminToken });
  assert.equal(adminTeams.body.teams.find((team) => team.id === alpha.id).members.length, 2);

  for (const userId of ['u1', 'u2']) {
    const remove = await request(
      baseUrl,
      `/api/admin/teams/${alpha.id}/members/${userId}`,
      { method: 'DELETE', token: adminToken }
    );
    assert.equal(remove.status, 200);
  }

  const deleteEmpty = await request(baseUrl, `/api/admin/teams/${alpha.id}`, {
    method: 'DELETE',
    token: adminToken
  });
  assert.equal(deleteEmpty.status, 200);

  const cannotReduceBelowExisting = await request(baseUrl, '/api/admin/team-capacity', {
    method: 'PATCH',
    token: adminToken,
    body: JSON.stringify({ maxTeams: 0 })
  });
  assert.equal(cannotReduceBelowExisting.status, 409);

  const myTeam = await request(baseUrl, '/api/teams/me', { token: user3Token });
  assert.equal(myTeam.status, 200);
  assert.equal(myTeam.body.team.id, beta.id);
  assert.equal(myTeam.body.team.members.length, 1);
});
