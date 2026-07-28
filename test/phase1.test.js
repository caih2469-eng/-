const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { migrateData } = require('../lib/model');

const projectRoot = path.join(__dirname, '..');

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
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
  const body = await response.json();
  return { status: response.status, body };
}

test('旧数据迁移补齐双赛道与用户资料字段', () => {
  const data = {
    config: {},
    users: [
      { id: 'admin', studentId: 'admin', name: '管理员', password: 'secret', role: 'admin' },
      { id: 'u1', studentId: '20260001', name: '学生', password: 'secret', role: 'student' }
    ],
    checkins: []
  };
  assert.equal(migrateData(data, '2026-07-24T00:00:00.000Z'), true);
  assert.deepEqual(data.tracks.map((track) => track.id), ['interaction', 'health']);
  assert.equal(data.users[0].status, 'active');
  assert.equal(data.users[0].trackId, null);
  assert.equal(data.users[1].trackId, 'health');
  assert.equal(data.users[1].createdAt, '2026-07-24T00:00:00.000Z');
});

test('登录、资料、双赛道、管理员权限和 Excel 导入', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-phase1-'));
  const dataDir = path.join(tempRoot, 'data');
  const uploadDir = path.join(tempRoot, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'db.json'),
    JSON.stringify({
      config: {
        activityName: '测试活动',
        startDate: '2026-09-12',
        endDate: '2026-09-30',
        slots: [
          { id: 'breakfast', label: '早餐', start: '06:50', end: '10:00' },
          { id: 'lunch', label: '午餐', start: '10:30', end: '14:00' },
          { id: 'dinner', label: '晚餐', start: '16:30', end: '19:30' }
        ]
      },
      users: [
        {
          id: 'admin',
          studentId: 'admin',
          name: '管理员',
          password: 'change-me-now',
          role: 'admin'
        }
      ],
      checkins: []
    })
  );

  const port = 3317;
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

  const adminLogin = await request(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ studentId: 'admin', password: 'change-me-now' })
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.user.role, 'admin');
  assert.equal('password' in adminLogin.body.user, false);
  assert.equal('tracks' in adminLogin.body, false);
  assert.equal('config' in adminLogin.body, false);
  const adminToken = adminLogin.body.token;

  const createUser = await request(baseUrl, '/api/admin/users', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: '互动学生',
      studentId: '20260001',
      campus: '旗山',
      trackId: 'interaction',
      status: 'active',
      password: 'test-pass-1'
    })
  });
  assert.equal(createUser.status, 201);

  const usersAfterCreate = await request(baseUrl, '/api/admin/users', {
    token: adminToken
  });
  assert.equal(usersAfterCreate.status, 200);
  assert.equal(usersAfterCreate.body.users.length, 1);
  const interactionUser = usersAfterCreate.body.users[0];
  assert.equal(interactionUser.trackId, 'interaction');
  assert.equal(interactionUser.campus, '旗山');
  assert.equal(interactionUser.status, 'active');
  assert.ok(interactionUser.createdAt);
  assert.equal('password' in interactionUser, false);

  const editUser = await request(
    baseUrl,
    `/api/admin/users/${interactionUser.id}`,
    {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({
        ...interactionUser,
        campus: '仓山',
        password: ''
      })
    }
  );
  assert.equal(editUser.status, 200);
  assert.equal(editUser.body.user.campus, '仓山');
  assert.equal(editUser.body.user.createdAt, interactionUser.createdAt);

  const studentLogin = await request(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ studentId: '20260001', password: 'test-pass-1' })
  });
  assert.equal(studentLogin.status, 200);
  const studentToken = studentLogin.body.token;

  const ownProfile = await request(baseUrl, '/api/me', { token: studentToken });
  assert.equal(ownProfile.status, 200);
  assert.equal(ownProfile.body.user.studentId, '20260001');
  assert.equal(ownProfile.body.user.trackId, 'interaction');
  assert.equal(ownProfile.body.user.campus, '仓山');
  assert.equal('password' in ownProfile.body.user, false);

  const forbiddenList = await request(baseUrl, '/api/admin/users', {
    token: studentToken
  });
  assert.equal(forbiddenList.status, 403);

  const forbiddenEdit = await request(
    baseUrl,
    `/api/admin/users/${interactionUser.id}`,
    {
      method: 'PUT',
      token: studentToken,
      body: JSON.stringify({
        ...interactionUser,
        name: '越权修改'
      })
    }
  );
  assert.equal(forbiddenEdit.status, 403);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('名单');
  sheet.addRow(['姓名', '学号', '校区', '所属赛道', '初始密码', '账号状态']);
  sheet.addRow(['健康学生', '20260002', '安溪', '自律健康赛道', 'test-pass-2', '启用']);
  const workbookBuffer = await workbook.xlsx.writeBuffer();
  const importResult = await request(baseUrl, '/api/admin/users/import', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      file: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(workbookBuffer).toString('base64')}`
    })
  });
  assert.equal(importResult.status, 201);
  assert.equal(importResult.body.imported, 1);

  const allUsers = await request(baseUrl, '/api/admin/users', { token: adminToken });
  assert.equal(allUsers.body.users.length, 2);
  assert.equal(
    allUsers.body.users.find((item) => item.studentId === '20260002').trackId,
    'health'
  );

  const disableResult = await request(
    baseUrl,
    `/api/admin/users/${interactionUser.id}/status`,
    {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ status: 'disabled' })
    }
  );
  assert.equal(disableResult.status, 200);
  assert.equal(disableResult.body.user.status, 'disabled');

  const disabledSession = await request(baseUrl, '/api/me', { token: studentToken });
  assert.equal(disabledSession.status, 401);
  const disabledLogin = await request(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ studentId: '20260001', password: 'test-pass-1' })
  });
  assert.equal(disabledLogin.status, 403);
});
