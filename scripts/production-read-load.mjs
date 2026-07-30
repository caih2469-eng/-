import https from 'node:https';

const baseUrl = (process.env.LOAD_BASE_URL || 'https://jinshan20-test.pages.dev').replace(/\/$/, '');
const studentId = process.env.LOAD_STUDENT_ID;
const password = process.env.LOAD_PASSWORD;
const users = Number(process.env.LOAD_USERS || 700);
const requestedBatchSize = Number(process.env.LOAD_BATCH_SIZE || 50);
if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > 100) {
  throw new Error('LOAD_BATCH_SIZE must be an integer between 1 and 100');
}
const batchSize = requestedBatchSize;
const filePath = process.env.LOAD_FILE_PATH || '';
const postId = process.env.LOAD_POST_ID || '';
const selectedScenarios = new Set((process.env.LOAD_SCENARIOS || '').split(',').map((item) => item.trim()).filter(Boolean));
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: Math.max(1, batchSize),
  maxFreeSockets: Math.max(1, batchSize),
  scheduling: 'lifo',
});

if (!studentId || !password) {
  throw new Error('LOAD_STUDENT_ID and LOAD_PASSWORD are required');
}

const percentile = (sorted, ratio) => {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

async function request(path, options = {}) {
  const started = performance.now();
  return await new Promise((resolve) => {
    const url = new URL(path, baseUrl);
    const body = options.body || '';
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {}),
        ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
      },
      agent,
      timeout: 30_000,
    }, (response) => {
      response.resume();
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        duration: performance.now() - started,
      }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', (error) => resolve({
      ok: false,
      status: 0,
      duration: performance.now() - started,
      error: error.message,
    }));
    if (body) req.write(body);
    req.end();
  });
}

async function runBatched(factory) {
  const results = [];
  for (let offset = 0; offset < users; offset += batchSize) {
    const count = Math.min(batchSize, users - offset);
    results.push(...await Promise.all(Array.from({ length: count }, (_, index) => factory(offset + index))));
  }
  return results;
}

function summarize(name, results) {
  const durations = results.map((item) => item.duration).sort((a, b) => a - b);
  const successes = results.filter((item) => item.ok).length;
  const statusCounts = {};
  const errorCounts = {};
  for (const item of results) statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  for (const item of results.filter((entry) => entry.error)) {
    errorCounts[item.error] = (errorCounts[item.error] || 0) + 1;
  }
  return {
    name,
    requests: results.length,
    successes,
    errors: results.length - successes,
    errorRate: Number((((results.length - successes) / results.length) * 100).toFixed(2)),
    averageMs: Number((durations.reduce((total, value) => total + value, 0) / durations.length).toFixed(1)),
    p50Ms: Number(percentile(durations, 0.5).toFixed(1)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(1)),
    p99Ms: Number(percentile(durations, 0.99).toFixed(1)),
    maxMs: Number((durations.at(-1) || 0).toFixed(1)),
    statusCounts,
    errorCounts,
  };
}

const loginBody = JSON.stringify({ studentId, password });
let seedToken = process.env.LOAD_TOKEN || '';
if (!seedToken) {
const seedResult = await new Promise((resolve, reject) => {
  const url = new URL('/api/login', baseUrl);
  const req = https.request(url, {
  method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(loginBody),
    },
    agent,
    timeout: 30_000,
  }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  req.on('timeout', () => req.destroy(new Error('seed timeout')));
  req.on('error', reject);
  req.end(loginBody);
});
if (seedResult.status < 200 || seedResult.status >= 300) throw new Error(`Seed login failed: ${seedResult.status}`);
seedToken = JSON.parse(seedResult.body).token;
}
const authHeaders = { authorization: `Bearer ${seedToken}` };

const scenarios = [
  ['login', () => request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: loginBody,
  })],
  ['tasks', () => request('/api/tasks', { headers: authHeaders })],
  ['plaza', () => request('/api/plaza?page=1&sort=latest', { headers: authHeaders })],
  ['rankings', () => request('/api/rankings?period=daily')],
];
if (filePath) scenarios.push(['privateFile', () => request(filePath, { headers: authHeaders })]);
if (postId) scenarios.push(['likeIdempotency', () => request(`/api/plaza/${encodeURIComponent(postId)}/like`, {
  method: 'POST',
  headers: { ...authHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ liked: true }),
})]);

const report = {
  baseUrl,
  users,
  batchSize,
  startedAt: new Date().toISOString(),
  results: [],
};

for (const [name, factory] of scenarios.filter(([name]) => !selectedScenarios.size || selectedScenarios.has(name))) {
  const started = performance.now();
  const results = await runBatched(factory);
  report.results.push({
    ...summarize(name, results),
    wallTimeMs: Number((performance.now() - started).toFixed(1)),
  });
}

report.finishedAt = new Date().toISOString();
agent.destroy();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
