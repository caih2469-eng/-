const fs = require('fs');
const { performance } = require('perf_hooks');

const base = process.env.CLOUDFLARE_TEST_URL || 'https://jinshan20-test.pages.dev';
const fixturePath = process.env.CLOUDFLARE_UPLOAD_FIXTURE
  || '.tmp-media-matrix/cache-test-thumb.webp';
const total = Math.max(1, Number(process.env.UPLOAD_CONFIRM_TOTAL || 10));
const concurrency = Math.max(1, Number(process.env.UPLOAD_CONFIRM_CONCURRENCY || 5));
const fixture = fs.readFileSync(fixturePath);

const percentile = (values, ratio) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
};

const timedFetch = async (url, init) => {
  const started = performance.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { response, ms: performance.now() - started };
};

const runOne = async (index) => {
  const studentId = `L${String(index + 1).padStart(4, '0')}`;
  const login = await timedFetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId, password: 'pass' })
  });
  const loginBody = await login.response.json();
  if (!login.response.ok || !loginBody.token) throw new Error(`login:${login.response.status}`);
  const headers = {
    authorization: `Bearer ${loginBody.token}`,
    'content-type': 'application/json'
  };
  const intent = await timedFetch(`${base}/api/media/upload-intents`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      businessType: 'member-checkin',
      variant: 'display',
      mimeType: 'image/webp',
      fileSize: fixture.length,
      width: 360,
      height: 322
    })
  });
  const intentBody = await intent.response.json();
  if (!intent.response.ok || !intentBody.uploadUrl) {
    throw new Error(`intent:${intent.response.status}:${intentBody.error || 'unknown'}`);
  }
  const upload = await timedFetch(intentBody.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/webp' },
    body: fixture
  });
  if (!upload.response.ok) throw new Error(`upload:${upload.response.status}`);
  const confirm = await timedFetch(
    `${base}/api/media/upload-intents/${encodeURIComponent(intentBody.intentId)}/confirm`,
    { method: 'POST', headers, body: '{}' }
  );
  const confirmBody = await confirm.response.json();
  if (!confirm.response.ok || !confirmBody.media?.id) {
    throw new Error(`confirm:${confirm.response.status}:${confirmBody.error || 'unknown'}`);
  }
  return {
    studentId,
    intentId: intentBody.intentId,
    mediaId: confirmBody.media.id,
    loginMs: login.ms,
    intentMs: intent.ms,
    uploadMs: upload.ms,
    confirmMs: confirm.ms
  };
};

const workerPool = async () => {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < total) {
      const index = next++;
      const started = performance.now();
      try {
        results.push({ ok: true, totalMs: performance.now() - started, ...await runOne(index) });
        results[results.length - 1].totalMs = performance.now() - started;
      } catch (error) {
        results.push({ ok: false, totalMs: performance.now() - started, error: error.message });
      }
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return { results, elapsedMs: performance.now() - started };
};

(async () => {
  const { results, elapsedMs } = await workerPool();
  const successful = results.filter((item) => item.ok);
  const summarize = (key) => ({
    p50: Math.round(percentile(successful.map((item) => item[key]), 0.5)),
    p95: Math.round(percentile(successful.map((item) => item[key]), 0.95)),
    max: Math.round(Math.max(0, ...successful.map((item) => item[key])))
  });
  const report = {
    environment: base,
    generatedAt: new Date().toISOString(),
    requests: total,
    concurrency,
    bytesPerUpload: fixture.length,
    success: successful.length,
    failed: results.length - successful.length,
    elapsedMs: Math.round(elapsedMs),
    throughputPerSecond: Number((total / (elapsedMs / 1000)).toFixed(2)),
    latencyMs: {
      login: summarize('loginMs'),
      uploadIntent: summarize('intentMs'),
      directR2Put: summarize('uploadMs'),
      d1Confirmation: summarize('confirmMs'),
      workflow: summarize('totalMs')
    },
    cleanupMediaIds: successful.map((item) => item.mediaId),
    errors: results.filter((item) => !item.ok).slice(0, 10)
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
})();
