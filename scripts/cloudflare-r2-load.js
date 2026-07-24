const dns = require('dns');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

dns.setDefaultResultOrder('ipv4first');

const base = process.env.CLOUDFLARE_TEST_URL || 'https://jinshan-checkin-staging-bvu.pages.dev';
const secretFile = process.env.CLOUDFLARE_LOAD_KEY_FILE
  || path.join(os.tmpdir(), 'jinshan-load-secret-new.txt');
const fixtureFile = process.env.CLOUDFLARE_UPLOAD_FIXTURE
  || path.join(os.tmpdir(), 'jinshan-r2-load-5mb.jpg');
const concurrency = Number(process.env.UPLOAD_CONCURRENCY || 25);
const total = Number(process.env.UPLOAD_TOTAL || 700);

const secret = fs.readFileSync(secretFile, 'utf8').trim();
const fixture = fs.readFileSync(fixtureFile);
const percentile = (values, ratio) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchWithRetry = async (action, maxAttempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await action();
      if (response.status < 500 || attempt === maxAttempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
    await wait(attempt * 750);
  }
  throw lastError;
};

const run = async (kind, action) => {
  const results = [];
  const started = performance.now();
  let next = 1;
  const worker = async () => {
    while (next <= total) {
      const id = next++;
      const requestStarted = performance.now();
      try {
        const response = await action(id);
        results.push({ id, status: response.status, ms: performance.now() - requestStarted });
      } catch (error) {
        results.push({ id, status: 0, ms: performance.now() - requestStarted, error: error.message });
      }
      if (results.length % 50 === 0) {
        process.stderr.write(`${kind}: ${results.length}/${total}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = performance.now() - started;
  const latencies = results.map((item) => item.ms);
  return {
    requests: results.length,
    success: results.filter((item) => item.status >= 200 && item.status < 300).length,
    failed: results.filter((item) => item.status < 200 || item.status >= 300).length,
    statusCounts: Object.fromEntries([...new Set(results.map((item) => item.status))]
      .sort((a, b) => a - b)
      .map((status) => [status, results.filter((item) => item.status === status).length])),
    elapsedMs: Math.round(elapsedMs),
    throughputPerSecond: Number((results.length / (elapsedMs / 1000)).toFixed(2)),
    latencyMs: {
      p50: Math.round(percentile(latencies, 0.5)),
      p95: Math.round(percentile(latencies, 0.95)),
      p99: Math.round(percentile(latencies, 0.99)),
      max: Math.round(Math.max(...latencies))
    },
    errors: results.filter((item) => item.error).slice(0, 10)
  };
};

(async () => {
  const upload = await run('upload', (id) => fetchWithRetry(() => fetch(`${base}/__load/uploads/load-${id}`, {
    method: 'PUT',
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(fixture.length),
      'x-load-key': secret
    },
    body: fixture,
    signal: AbortSignal.timeout(120000)
  })));
  const read = await run('read', (id) => fetchWithRetry(() => fetch(`${base}/__load/objects/load-${id}`, {
    headers: { 'x-load-key': secret },
    signal: AbortSignal.timeout(120000)
  }).then(async (response) => {
    if (response.ok) await response.arrayBuffer();
    return response;
  })));
  console.log(JSON.stringify({
    environment: base,
    generatedAt: new Date().toISOString(),
    objects: total,
    bytesPerObject: fixture.length,
    uploadBytes: total * fixture.length,
    readBytes: total * fixture.length,
    concurrency,
    upload,
    read
  }, null, 2));
  if (upload.failed || read.failed) process.exitCode = 1;
})();
