const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, ['scripts/apply-build-asset-version.mjs'], {
  cwd: root,
  stdio: 'pipe'
});
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const indexSource = read('public', 'index.html');
const entranceSource = read('public', 'entrance.html');
const bootstrapSource = read('public', 'bootstrap.js');
const appSource = read('public', 'app.js');
const headerSource = read('public', '_headers');
const workerSource = read('cloudflare', 'worker.js');
const buildVersionSource = read('scripts', 'apply-build-asset-version.mjs');
const plazaPrefetchSource = read('scripts', 'apply-approved-plaza-prefetch.mjs');

test('阶段G：入口资源按当前Git提交自动更新且保留同版本缓存', () => {
  const references = [indexSource, entranceSource, bootstrapSource]
    .flatMap((source) => [...source.matchAll(/\?v=([a-zA-Z0-9._-]+)/g)].map((match) => match[1]));
  assert.ok(references.length >= 5);
  const versions = [...new Set(references)];
  assert.equal(versions.length, 1);
  assert.match(versions[0], /^(?:[0-9a-f]{40}|20260731-approved1(?:-plaza1)?)$/);
  assert.match(buildVersionSource, /GITHUB_SHA/);
  assert.match(buildVersionSource, /CF_PAGES_COMMIT_SHA/);
  assert.match(buildVersionSource, /BUILD_ASSET_VERSION_V1/);
  assert.match(buildVersionSource, /beforeExit/);
  assert.match(buildVersionSource, /public\/index\.html/);
  assert.match(buildVersionSource, /public\/entrance\.html/);
  assert.match(buildVersionSource, /public\/bootstrap\.js/);
  assert.match(plazaPrefetchSource, /apply-build-asset-version\.mjs/);
  assert.match(indexSource, /BUILD_ASSET_VERSION_V1/);
  assert.match(entranceSource, /BUILD_ASSET_VERSION_V1/);
  assert.match(bootstrapSource, /BUILD_ASSET_VERSION_V1/);
  assert.match(headerSource, /\/bootstrap\.js\s+Cache-Control: public, max-age=31536000, immutable/s);
  assert.match(headerSource, /\/app\.js\s+Cache-Control: public, max-age=31536000, immutable/s);
  assert.match(headerSource, /\/health-checkin\.js\s+Cache-Control: public, max-age=31536000, immutable/s);
  assert.match(headerSource, /\/style\.css\s+Cache-Control: public, max-age=31536000, immutable/s);
  assert.match(headerSource, /\/vendor\/\*\s+Cache-Control: public, max-age=31536000, immutable/s);
  assert.match(appSource, /moduleUrl\.searchParams\.set\('v', version\)/);
});

test('阶段G：性能指标只在调试模式记录且不包含凭据或图片内容', () => {
  assert.match(bootstrapSource, /debugPerf/);
  assert.match(bootstrapSource, /window\.__PERF_METRICS__/);
  assert.match(bootstrapSource, /if \(!perfEnabled\) return/);
  assert.match(appSource, /recordPerf\('request'/);
  assert.match(appSource, /recordPerf\('preview'/);
  assert.match(appSource, /recordPerf\('compress'/);
  assert.match(appSource, /recordPerf\('upload'/);
  assert.match(appSource, /recordPerf\('submit'/);
  assert.match(appSource, /recordPerf\('home-restore'/);
  assert.match(appSource, /recordPerf\('module-load'/);
  const recorderBlock = bootstrapSource.slice(
    bootstrapSource.indexOf('window.__RECORD_PERF__'),
    bootstrapSource.indexOf('const bootstrapStarted')
  );
  assert.doesNotMatch(recorderBlock, /password|authorization|cookie|token|imageData|body/i);
});

test('阶段G：Worker为每个响应提供真实请求编号和总耗时，不伪造未测量字段', async () => {
  assert.match(workerSource, /headers\.set\('x-request-id', id\)/);
  assert.match(workerSource, /\['total', totalDuration\]/);
  assert.match(workerSource, /recordRequestTiming\(request, 'd1'/);
  assert.match(workerSource, /recordRequestTiming\(request, 'r2'/);
  const worker = (await import('../cloudflare/worker.js')).default;
  const response = await worker.fetch(
    new Request('https://example.test/health'),
    { ENVIRONMENT: 'test', PROJECT_NAME: 'stage-g' },
    { waitUntil() {} }
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-request-id') || '', /^[a-z0-9-]+$/i);
  assert.match(response.headers.get('server-timing') || '', /total;dur=\d+(?:\.\d+)?/);
  assert.doesNotMatch(response.headers.get('server-timing') || '', /\bauth;|\bd1;|\br2;/);
});
