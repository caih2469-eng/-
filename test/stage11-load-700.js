const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-load-700-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const salt = Buffer.from('stage11-load-test');
const passwordHash = `scrypt:${salt.toString('base64url')}:${crypto.scryptSync('pass', salt, 64).toString('base64url')}`;
const createdAt = new Date().toISOString();
const users = Array.from({ length: 700 }, (_, index) => ({
  id: `load-${index + 1}`,
  studentId: `L${String(index + 1).padStart(4, '0')}`,
  name: `压力用户${index + 1}`,
  password: passwordHash,
  role: 'student',
  campus: ['旗山校区', '仓山校区', '怡山校区', '晋江校区'][index % 4],
  trackId: 'health',
  status: 'active',
  createdAt
}));
fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
  config: { activityName: '700用户压力测试', maxTeams: 50, slots: [], activityEnabled: true, trackEnabled: { interaction: true, health: true } },
  tracks: [{ id: 'interaction', name: '四校区互动赛道' }, { id: 'health', name: '自律健康赛道' }],
  users,
  teams: [], tasks: [], taskSubmissions: [], memberCheckins: [], checkins: [],
  plazaPosts: [], plazaLikes: [], plazaViews: [], rankingFreezes: [], materialTasks: [], materialSubmissions: []
}));

const port = 3395;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(port), CHECKIN_DATA_DIR: dataDir, CHECKIN_UPLOAD_DIR: path.join(temp, 'uploads'), CHECKIN_MATERIAL_FILE_DIR: path.join(temp, 'materials'), SESSION_SECRET: 'stage11-load-secret' },
  stdio: 'ignore'
});

const percentile = (values, ratio) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))];
const timed = async (action) => {
  const started = performance.now();
  try {
    const response = await action();
    return { status: response.status, ms: performance.now() - started, body: response };
  } catch (error) {
    return { status: 0, ms: performance.now() - started, error: error.message };
  }
};

(async () => {
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if ((await fetch(base)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const loginStarted = performance.now();
    const loginResults = await Promise.all(users.map((user) => timed(async () => {
      const response = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `198.51.${Math.floor(Number(user.id.slice(5)) / 250)}.${(Number(user.id.slice(5)) % 250) + 1}` },
        body: JSON.stringify({ studentId: user.studentId, password: 'pass' })
      });
      const body = await response.json();
      response.token = body.token;
      return response;
    })));
    const tokens = loginResults.map((result) => result.body?.token).filter(Boolean);
    const readStarted = performance.now();
    const readResults = [];
    for (let offset = 0; offset < tokens.length; offset += 100) {
      const batch = tokens.slice(offset, offset + 100);
      readResults.push(...await Promise.all(batch.map((token, batchIndex) => {
        const index = offset + batchIndex;
        return timed(() => fetch(`${base}${index % 3 === 0 ? '/api/tasks' : index % 3 === 1 ? '/api/material-tasks' : '/api/me'}`, { headers: { Authorization: `Bearer ${token}` } }));
      })));
    }
  const summarize = (results, elapsedMs) => ({
      requests: results.length,
      success: results.filter((item) => item.status === 200).length,
      failed: results.filter((item) => item.status !== 200).length,
      statusCounts: Object.fromEntries([...new Set(results.map((item) => item.status))].sort((a, b) => a - b).map((status) => [status, results.filter((item) => item.status === status).length])),
      elapsedMs: Math.round(elapsedMs),
      throughputPerSecond: Number((results.length / (elapsedMs / 1000)).toFixed(2)),
      latencyMs: {
        p50: Math.round(percentile(results.map((item) => item.ms), 0.5)),
        p95: Math.round(percentile(results.map((item) => item.ms), 0.95)),
        p99: Math.round(percentile(results.map((item) => item.ms), 0.99)),
        max: Math.round(Math.max(...results.map((item) => item.ms)))
      }
    });
    const report = {
      users: users.length,
      readConcurrency: 100,
      concurrentLogin: summarize(loginResults, performance.now() - loginStarted),
      concurrentAuthenticatedReads: summarize(readResults, performance.now() - readStarted),
      memoryRssMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.concurrentLogin.failed || report.concurrentAuthenticatedReads.failed) process.exitCode = 1;
  } finally {
    server.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
