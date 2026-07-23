const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const {
  TRACKS,
  USER_STATUSES,
  migrateData,
  safeUser,
  trackIdFromValue,
  statusFromValue
} = require('./lib/model');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.CHECKIN_DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.CHECKIN_UPLOAD_DIR || path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);

for (const dir of [PUBLIC_DIR, DATA_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const defaultDb = {
  config: {
    activityName: '廿载同心·青春同行｜健康三餐打卡',
    startDate: '2026-09-12',
    endDate: '2026-09-30',
    slots: [
      { id: 'breakfast', label: '早餐', start: '06:50', end: '10:00' },
      { id: 'lunch', label: '午餐', start: '10:30', end: '14:00' },
      { id: 'dinner', label: '晚餐', start: '16:30', end: '19:30' }
    ]
  },
  tracks: TRACKS.map((track) => ({ ...track })),
  users: [
    {
      id: 'admin',
      studentId: 'admin',
      name: '管理员',
      password: 'change-me-now',
      role: 'admin',
      campus: '',
      trackId: null,
      status: 'active',
      createdAt: new Date().toISOString()
    }
  ],
  checkins: []
};

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getDb() {
  if (!fs.existsSync(DB_FILE)) saveDb(defaultDb);
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (migrateData(data)) saveDb(data);
  return data;
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > 25 * 1024 * 1024) reject(new Error('文件过大，单次提交最多 25MB'));
    });
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('请求格式错误'));
      }
    });
  });
}

function tokenFor(user) {
  return Buffer.from(JSON.stringify({ id: user.id })).toString('base64url');
}

function userFrom(req, data) {
  try {
    const encoded = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    const user = data.users.find((item) => item.id === payload.id);
    return user && user.status === 'active' ? user : null;
  } catch {
    return null;
  }
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function nowTime() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

function saveImage(dataUrl, prefix) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  const [meta, raw] = dataUrl.split(',');
  const ext = (meta.match(/data:image\/(png|jpeg|jpg|webp)/) || [])[1] || 'jpg';
  const filename = `${prefix}-${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(raw, 'base64'));
  return `/uploads/${filename}`;
}

function cleanText(value, maxLength = 100) {
  return String(value || '').trim().slice(0, maxLength);
}

function validateStudent(input, data, currentUserId = null) {
  const requestedStatus =
    input.status === undefined || input.status === ''
      ? 'active'
      : USER_STATUSES.includes(input.status)
        ? input.status
        : statusFromValue(input.status, null);
  const student = {
    name: cleanText(input.name, 50),
    studentId: cleanText(input.studentId, 40),
    campus: cleanText(input.campus, 50),
    trackId: trackIdFromValue(input.trackId),
    status: requestedStatus
  };
  const errors = [];
  if (!student.name) errors.push('姓名不能为空');
  if (!student.studentId) errors.push('学号不能为空');
  if (!student.campus) errors.push('校区不能为空');
  if (!student.trackId) errors.push('所属赛道无效');
  if (!student.status) errors.push('账号状态无效');
  if (data.users.some((user) => user.studentId === student.studentId && user.id !== currentUserId)) {
    errors.push('学号已存在');
  }
  return { student, errors };
}

function excelCellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
  }
  return String(value);
}

async function parseExcelUsers(fileData, data) {
  const raw = String(fileData || '').replace(/^data:.*?;base64,/, '');
  if (!raw) throw new Error('请选择 Excel 文件');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(raw, 'base64'));
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('Excel 中没有可导入的数据');

  const aliases = {
    name: ['姓名', 'name'],
    studentId: ['学号', 'studentid', 'student_id'],
    campus: ['校区', 'campus'],
    trackId: ['所属赛道', '赛道', 'track', 'trackid'],
    status: ['账号状态', '状态', 'status'],
    password: ['初始密码', '密码', 'password']
  };
  const headers = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const header = excelCellText(cell.value).trim().toLowerCase();
    for (const [field, names] of Object.entries(aliases)) {
      if (names.includes(header)) headers[field] = col;
    }
  });
  const required = ['name', 'studentId', 'campus', 'trackId', 'password'];
  const missing = required.filter((field) => !headers[field]);
  if (missing.length) throw new Error('Excel 缺少必要列：姓名、学号、校区、所属赛道、初始密码');

  const users = [];
  const errors = [];
  const seenStudentIds = new Set();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const input = {};
    for (const field of Object.keys(headers)) {
      input[field] = excelCellText(row.getCell(headers[field]).value).trim();
    }
    if (!Object.values(input).some(Boolean)) continue;
    input.status = statusFromValue(input.status);
    const { student, errors: rowErrors } = validateStudent(input, data);
    const password = cleanText(input.password, 100);
    if (!password) rowErrors.push('初始密码不能为空');
    if (seenStudentIds.has(student.studentId)) rowErrors.push('Excel 内学号重复');
    seenStudentIds.add(student.studentId);
    if (rowErrors.length) {
      errors.push(`第 ${rowNumber} 行：${rowErrors.join('、')}`);
    } else {
      users.push({
        id: crypto.randomUUID(),
        ...student,
        password,
        role: 'student',
        createdAt: new Date().toISOString()
      });
    }
  }
  if (errors.length) {
    const error = new Error(errors.slice(0, 20).join('\n'));
    error.statusCode = 400;
    throw error;
  }
  if (!users.length) throw new Error('Excel 中没有可导入的有效用户');
  return users;
}

async function handleApi(req, res, url) {
  const data = getDb();
  const route = url.pathname;

  if (route === '/api/login' && req.method === 'POST') {
    const body = await readJson(req);
    const studentId = cleanText(body.studentId, 40);
    const user = data.users.find(
      (item) => item.studentId === studentId && item.password === body.password
    );
    if (!user) return sendJson(res, 401, { error: '学号或密码不正确' });
    if (user.status !== 'active') return sendJson(res, 403, { error: '账号已被禁用' });
    return sendJson(res, 200, {
      token: tokenFor(user),
      user: safeUser(user),
      config: data.config,
      tracks: data.tracks
    });
  }

  const currentUser = userFrom(req, data);
  if (!currentUser) return sendJson(res, 401, { error: '请先登录或账号已被禁用' });

  if (route === '/api/me') {
    return sendJson(res, 200, {
      user: safeUser(currentUser),
      config: data.config,
      tracks: data.tracks,
      date: today(),
      time: nowTime()
    });
  }

  if (route === '/api/checkins' && req.method === 'GET') {
    const date = url.searchParams.get('date') || today();
    return sendJson(res, 200, {
      checkins: data.checkins.filter(
        (checkin) => checkin.userId === currentUser.id && checkin.date === date
      )
    });
  }

  if (route === '/api/checkins' && req.method === 'POST') {
    if (currentUser.role !== 'student') {
      return sendJson(res, 403, { error: '管理员账号不可打卡' });
    }
    const body = await readJson(req);
    const slot = data.config.slots.find((item) => item.id === body.slotId);
    const date = body.date || today();
    if (!slot) return sendJson(res, 400, { error: '打卡时段不存在' });
    if (date !== today()) return sendJson(res, 400, { error: '只能提交当天材料' });
    if (nowTime() < slot.start || nowTime() > slot.end) {
      return sendJson(res, 400, {
        error: `当前不在${slot.label}时段（${slot.start}–${slot.end}）`
      });
    }
    const photos = (body.photos || [])
      .map((photo, index) =>
        saveImage(photo, `${currentUser.studentId}-${date}-${slot.id}-${index}`)
      )
      .filter(Boolean);
    if (!photos.length) return sendJson(res, 400, { error: '至少上传一张水印截图' });
    data.checkins = data.checkins.filter(
      (checkin) =>
        !(
          checkin.userId === currentUser.id &&
          checkin.date === date &&
          checkin.slotId === slot.id
        )
    );
    data.checkins.push({
      id: crypto.randomUUID(),
      userId: currentUser.id,
      date,
      slotId: slot.id,
      photos,
      summary: saveImage(body.summary, `${currentUser.studentId}-${date}-summary`),
      note: cleanText(body.note, 300),
      submittedAt: new Date().toISOString(),
      status: 'pending'
    });
    saveDb(data);
    return sendJson(res, 201, { ok: true });
  }

  if (currentUser.role !== 'admin') {
    return sendJson(res, 403, { error: '仅管理员可访问' });
  }

  if (route === '/api/admin/dashboard' && req.method === 'GET') {
    const date = url.searchParams.get('date') || today();
    const students = data.users.filter((user) => user.role === 'student');
    return sendJson(res, 200, {
      date,
      config: data.config,
      tracks: data.tracks,
      students: students.map((student) => ({
        ...safeUser(student),
        slots: data.config.slots.map(
          (slot) =>
            data.checkins.find(
              (checkin) =>
                checkin.userId === student.id &&
                checkin.date === date &&
                checkin.slotId === slot.id
            ) || null
        )
      }))
    });
  }

  if (route === '/api/admin/users' && req.method === 'GET') {
    return sendJson(res, 200, {
      users: data.users.filter((user) => user.role === 'student').map(safeUser),
      tracks: data.tracks
    });
  }

  if (route === '/api/admin/users' && req.method === 'POST') {
    const body = await readJson(req);
    const { student, errors } = validateStudent(body, data);
    const password = cleanText(body.password, 100);
    if (!password) errors.push('初始密码不能为空');
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    data.users.push({
      id: crypto.randomUUID(),
      ...student,
      password,
      role: 'student',
      createdAt: new Date().toISOString()
    });
    saveDb(data);
    return sendJson(res, 201, { ok: true });
  }

  if (route === '/api/admin/users/import' && req.method === 'POST') {
    const body = await readJson(req);
    try {
      const users = await parseExcelUsers(body.file, data);
      data.users.push(...users);
      saveDb(data);
      return sendJson(res, 201, { ok: true, imported: users.length });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
  }

  const userMatch = route.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PUT') {
    const target = data.users.find(
      (user) => user.id === decodeURIComponent(userMatch[1]) && user.role === 'student'
    );
    if (!target) return sendJson(res, 404, { error: '用户不存在' });
    const body = await readJson(req);
    const { student, errors } = validateStudent(body, data, target.id);
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    Object.assign(target, student);
    if (body.password) target.password = cleanText(body.password, 100);
    saveDb(data);
    return sendJson(res, 200, { ok: true, user: safeUser(target) });
  }

  const statusMatch = route.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'PATCH') {
    const target = data.users.find(
      (user) => user.id === decodeURIComponent(statusMatch[1]) && user.role === 'student'
    );
    if (!target) return sendJson(res, 404, { error: '用户不存在' });
    const body = await readJson(req);
    if (!USER_STATUSES.includes(body.status)) {
      return sendJson(res, 400, { error: '账号状态无效' });
    }
    target.status = body.status;
    saveDb(data);
    return sendJson(res, 200, { ok: true, user: safeUser(target) });
  }

  if (route === '/api/admin/config' && req.method === 'PUT') {
    data.config = { ...data.config, ...(await readJson(req)) };
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  const checkinMatch = route.match(/^\/api\/admin\/checkins\/([^/]+)$/);
  if (checkinMatch && req.method === 'PUT') {
    const checkin = data.checkins.find(
      (item) => item.id === decodeURIComponent(checkinMatch[1])
    );
    if (!checkin) return sendJson(res, 404, { error: '记录不存在' });
    const body = await readJson(req);
    checkin.status = body.status === 'approved' ? 'approved' : 'rejected';
    checkin.reviewNote = cleanText(body.reviewNote, 300);
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const isUpload = url.pathname.startsWith('/uploads/');
    const base = isUpload ? UPLOAD_DIR : PUBLIC_DIR;
    const relative = isUpload
      ? url.pathname.slice('/uploads/'.length)
      : url.pathname === '/'
        ? 'index.html'
        : url.pathname.replace(/^\//, '');
    const file = path.join(base, relative);
    if (!file.startsWith(base) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp'
    };
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream'
    });
    return fs.createReadStream(file).pipe(res);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || '请求失败' });
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
