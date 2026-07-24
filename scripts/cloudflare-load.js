const dns = require('dns');
const { performance } = require('perf_hooks');

dns.setDefaultResultOrder('ipv4first');

const base = process.env.CLOUDFLARE_TEST_URL || 'https://jinshan-checkin-staging.pages.dev';
const users = 700;
const loginConcurrency = Number(process.env.LOGIN_CONCURRENCY || 100);
const readConcurrency = Number(process.env.READ_CONCURRENCY || 100);
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 20000);

const percentile = (values, ratio) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
};

const timed = async (action) => {
  const started = performance.now();
  try {
    const response = await action();
    return { status: response.status, ms: performance.now() - started, response };
  } catch (error) {
    return { status: 0, ms: performance.now() - started, error: error.message };
  }
};

const runBatched = async (items, concurrency, action) => {
  const results = [];
  const started = performance.now();
  for (let offset = 0; offset < items.length; offset += concurrency) {
    results.push(...await Promise.all(items.slice(offset, offset + concurrency).map(action)));
  }
  return { results, elapsedMs: performance.now() - started };
};

const summarize = (results, elapsedMs) => ({
  requests: results.length,
  success: results.filter((item) => item.status >= 200 && item.status < 300).length,
  failed: results.filter((item) => item.status < 200 || item.status >= 300).length,
  statusCounts: Object.fromEntries([...new Set(results.map((item) => item.status))]
    .sort((a, b) => a - b)
    .map((status) => [status, results.filter((item) => item.status === status).length])),
  elapsedMs: Math.round(elapsedMs),
  throughputPerSecond: Number((results.length / (elapsedMs / 1000)).toFixed(2)),
  latencyMs: {
    p50: Math.round(percentile(results.map((item) => item.ms), 0.5)),
    p95: Math.round(percentile(results.map((item) => item.ms), 0.95)),
    p99: Math.round(percentile(results.map((item) => item.ms), 0.99)),
    max: Math.round(Math.max(...results.map((item) => item.ms)))
  }
});

(async () => {
  const loginRun = await runBatched(Array.from({ length: users }, (_, index) => index), loginConcurrency, (index) => timed(async () => {
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        studentId: `L${String(index + 1).padStart(4, '0')}`,
        password: 'pass'
      })
    });
    const body = await response.json().catch(() => ({}));
    response.token = body.token;
    return response;
  }));
  const loginResults = loginRun.results;
  const tokens = loginResults.map((item) => item.response?.token).filter(Boolean);

  const reads = await runBatched(tokens, readConcurrency, (token, index) => timed(() => fetch(
    `${base}${index % 2 ? '/api/tasks' : '/api/me'}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(requestTimeoutMs) }
  )));
  const rankingRequests = await runBatched(
    Array.from({ length: users }),
    readConcurrency,
    () => timed(() => fetch(`${base}/api/rankings?period=load-test`, {
      signal: AbortSignal.timeout(requestTimeoutMs)
    }))
  );

  const report = {
    environment: base,
    generatedAt: new Date().toISOString(),
    users,
    loginConcurrency,
    readConcurrency,
    requestTimeoutMs,
    login: summarize(loginResults, loginRun.elapsedMs),
    authenticatedReads: summarize(reads.results, reads.elapsedMs),
    rankingReads: summarize(rankingRequests.results, rankingRequests.elapsedMs)
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.login.failed || report.authenticatedReads.failed || report.rankingReads.failed) {
    process.exitCode = 1;
  }
})();
