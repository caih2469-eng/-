import https from 'node:https';

const baseUrl = (process.env.LOAD_BASE_URL || 'https://jinshan20-test.pages.dev').replace(/\/$/, '');
const adminId = process.env.LOAD_ADMIN_ID;
const adminPassword = process.env.LOAD_ADMIN_PASSWORD;
const targetUserId = process.env.LOAD_TARGET_USER_ID;
const requests = Number(process.env.LOAD_REQUESTS || 700);
const batchSize = Number(process.env.LOAD_BATCH_SIZE || 25);
const imageBytes = Number(process.env.LOAD_IMAGE_BYTES || 131072);

if (!adminId || !adminPassword || !targetUserId) {
  throw new Error('LOAD_ADMIN_ID, LOAD_ADMIN_PASSWORD and LOAD_TARGET_USER_ID are required');
}

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: batchSize,
  maxFreeSockets: batchSize,
  scheduling: 'lifo',
});

function rawRequest(path, { method = 'GET', headers = {}, body = '' } = {}) {
  const started = performance.now();
  return new Promise((resolve) => {
    const req = https.request(new URL(path, baseUrl), {
      method,
      headers: {
        ...headers,
        ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
      },
      agent,
      timeout: 60_000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        duration: performance.now() - started,
        body: Buffer.concat(chunks).toString('utf8'),
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

const loginBody = JSON.stringify({ studentId: adminId, password: adminPassword });
const login = await rawRequest('/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: loginBody,
});
if (!login.ok) throw new Error(`Admin login failed: ${login.status} ${login.body || login.error}`);
const token = JSON.parse(login.body).token;

const image = Buffer.alloc(imageBytes);
Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
for (let index = 8; index < image.length; index += 1) image[index] = index % 251;
const photo = `data:image/png;base64,${image.toString('base64')}`;
const startDate = new Date('2022-01-01T00:00:00.000Z');

const results = [];
const wallStarted = performance.now();
for (let offset = 0; offset < requests; offset += batchSize) {
  const count = Math.min(batchSize, requests - offset);
  const batch = Array.from({ length: count }, (_, localIndex) => {
    const index = offset + localIndex;
    const date = new Date(startDate.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    const body = JSON.stringify({
      date,
      slotId: ['breakfast', 'lunch', 'dinner'][index % 3],
      note: `Cloudflare R2/D1 load verification ${index + 1}`,
      photos: [photo],
    });
    return rawRequest(`/api/admin/users/${encodeURIComponent(targetUserId)}/makeup`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
    });
  });
  results.push(...await Promise.all(batch));
}

const durations = results.map((item) => item.duration).sort((a, b) => a - b);
const successes = results.filter((item) => item.ok).length;
const percentile = (ratio) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * ratio) - 1)] || 0;
const statusCounts = {};
const errorCounts = {};
for (const item of results) {
  statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  if (item.error) errorCounts[item.error] = (errorCounts[item.error] || 0) + 1;
}

const report = {
  baseUrl,
  requests,
  batchSize,
  imageBytes,
  totalPayloadMiB: Number(((requests * imageBytes) / 1024 / 1024).toFixed(2)),
  successes,
  errors: results.length - successes,
  errorRate: Number((((results.length - successes) / results.length) * 100).toFixed(2)),
  averageMs: Number((durations.reduce((sum, item) => sum + item, 0) / durations.length).toFixed(1)),
  p50Ms: Number(percentile(0.5).toFixed(1)),
  p95Ms: Number(percentile(0.95).toFixed(1)),
  p99Ms: Number(percentile(0.99).toFixed(1)),
  maxMs: Number((durations.at(-1) || 0).toFixed(1)),
  wallTimeMs: Number((performance.now() - wallStarted).toFixed(1)),
  statusCounts,
  errorCounts,
};

agent.destroy();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
