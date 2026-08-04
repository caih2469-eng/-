import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');
const parseJson = (file) => JSON.parse(read(file));

execFileSync(process.execPath, ['scripts/apply-checkin-service-split.mjs'], { stdio: 'pipe' });

const mainWorkerSource = read('cloudflare/worker.js');
const studentRouteSource = read('cloudflare/routes/student.js');
const workflowSource = read('.github/workflows/checkin-service.yml');

test('independent check-in Worker rejects public access and unrelated routes', async () => {
  const childWorker = (await import(`../cloudflare/checkin-worker.js?test=${Date.now()}`)).default;
  const denied = await childWorker.fetch(
    new Request('https://internal.test/api/checkins'),
    {},
    { waitUntil() {} }
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('x-jinshan-service'), 'checkin');
  assert.equal(denied.headers.get('x-jinshan-service-version'), 'checkin-v1');

  const unrelated = await childWorker.fetch(
    new Request('https://internal.test/api/student-dashboard', {
      headers: {
        'x-jinshan-internal-service': 'checkin-v1',
        'x-jinshan-checkin-user': encodeURIComponent(JSON.stringify({
          id: 'user-1', role: 'student', trackId: 'health', status: 'active'
        }))
      }
    }),
    {},
    { waitUntil() {} }
  );
  assert.equal(unrelated.status, 404);
});

test('internal check-in request reuses the existing route contract', async () => {
  const childWorker = (await import(`../cloudflare/checkin-worker.js?contract=${Date.now()}`)).default;
  const statement = {
    bind() { return this; },
    async all() { return { results: [] }; },
    async first() { return null; },
    async run() { return { meta: { changes: 0 } }; }
  };
  const response = await childWorker.fetch(
    new Request('https://internal.test/api/checkins?date=2026-08-05', {
      headers: {
        'x-jinshan-internal-service': 'checkin-v1',
        'x-jinshan-checkin-user': encodeURIComponent(JSON.stringify({
          id: 'user-1', role: 'student', trackId: 'health', status: 'active'
        }))
      }
    }),
    { DB: { prepare() { return statement; } }, ENVIRONMENT: 'test', MEDIA_SIGNING_SECRET: 'test-secret' },
    { waitUntil() {} }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checkins: [] });
  assert.equal(response.headers.get('x-jinshan-service-version'), 'checkin-v1');
});

test('main Worker forwards only check-in routes and keeps safe fallback semantics', () => {
  const allowlistBlock = mainWorkerSource.slice(
    mainWorkerSource.indexOf('const isCheckinServiceRoute'),
    mainWorkerSource.indexOf('const checkinInternalUser')
  );
  assert.match(mainWorkerSource, /CHECKIN_SERVICE_BINDING_V1/);
  assert.match(allowlistBlock, /pathname === '\/api\/checkins'/);
  assert.match(allowlistBlock, /pathname === '\/api\/checkins\/history'/);
  assert.match(allowlistBlock, /member-checkin/);
  assert.doesNotMatch(allowlistBlock, /submission|public-images|media|plaza/);
  assert.match(mainWorkerSource, /env\.CHECKIN_SERVICE\.fetch\(serviceRequest\)/);
  assert.match(mainWorkerSource, /request\.method === 'GET' \|\| request\.method === 'HEAD'/);
  assert.match(mainWorkerSource, /打卡服务暂时不可用，请稍后重试/);
});

test('main Worker strips forged headers and passes only minimal user fields', () => {
  assert.match(mainWorkerSource, /headers\.delete\(CHECKIN_USER_HEADER\)/);
  assert.match(mainWorkerSource, /headers\.delete\(CHECKIN_SERVICE_HEADER\)/);
  const block = mainWorkerSource.slice(
    mainWorkerSource.indexOf('const checkinInternalUser'),
    mainWorkerSource.indexOf('const dispatchCheckinService')
  );
  assert.match(block, /id: user\.id/);
  assert.match(block, /role: user\.role/);
  assert.match(block, /trackId: user\.trackId/);
  assert.match(block, /status: user\.status/);
  assert.doesNotMatch(block, /studentId|name|password|token|cookie|authorization/i);
});

test('student routes accept trusted internal users without changing local authentication', () => {
  assert.match(studentRouteSource, /CHECKIN_SERVICE_ROUTE_V1/);
  assert.match(studentRouteSource, /authenticatedUser = null/);
  assert.match(studentRouteSource, /authenticatedUser \? \{ user: authenticatedUser \} : await requireUser/);
});

test('test and production Worker configs bind isolated D1 and R2 resources', () => {
  const testConfig = parseJson('cloudflare/checkin-service/wrangler.test.jsonc');
  const productionConfig = parseJson('cloudflare/checkin-service/wrangler.production.jsonc');
  assert.equal(testConfig.name, 'jinshan20-checkin-test');
  assert.equal(productionConfig.name, 'jinshan20-checkin');
  assert.equal(testConfig.workers_dev, false);
  assert.equal(productionConfig.workers_dev, false);
  assert.equal(testConfig.d1_databases[0].database_id, '6d217199-0c06-45a3-8bdc-e32c36140957');
  assert.equal(productionConfig.d1_databases[0].database_id, '1734a812-afc8-4c49-a1f1-f776c4b7ae69');
  assert.equal(testConfig.r2_buckets[0].bucket_name, 'jinshan20-test');
  assert.equal(productionConfig.r2_buckets[0].bucket_name, 'jinshan20');
});

test('stage one deploys the child Worker without switching Pages traffic', () => {
  const testPages = parseJson('cloudflare/pages-test/wrangler.jsonc');
  const productionPages = parseJson('cloudflare/pages-production/wrangler.jsonc');
  assert.equal((testPages.services || []).some((item) => item.binding === 'CHECKIN_SERVICE'), false);
  assert.equal((productionPages.services || []).some((item) => item.binding === 'CHECKIN_SERVICE'), false);
  assert.match(workflowSource, /checkin-service\/deploy-production/);
  assert.match(workflowSource, /Workers R2 Storage \/ Edit/);
  assert.doesNotMatch(workflowSource, /continue-on-error/);
});

test('check-in service split generator is idempotent', () => {
  const firstRoute = read('cloudflare/routes/student.js');
  const firstWorker = read('cloudflare/worker.js');
  execFileSync(process.execPath, ['scripts/apply-checkin-service-split.mjs'], { stdio: 'pipe' });
  assert.equal(read('cloudflare/routes/student.js'), firstRoute);
  assert.equal(read('cloudflare/worker.js'), firstWorker);
});
