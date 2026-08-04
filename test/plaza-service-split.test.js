import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');
const parseJson = (file) => JSON.parse(read(file));

execFileSync(process.execPath, ['scripts/apply-plaza-service-split.mjs'], { stdio: 'pipe' });

const mainWorkerSource = read('cloudflare/worker.js');
const plazaRouteSource = read('cloudflare/routes/plaza.js');
const childWorkerSource = read('cloudflare/plaza-worker.js');
const generatorSource = read('scripts/apply-plaza-service-split.mjs');
const buildHookSource = read('scripts/apply-approved-plaza-prefetch.mjs');

test('广场业务具备独立Worker入口且不直接暴露内部写接口', async () => {
  assert.match(childWorkerSource, /handlePlazaRoutes\(request, env, ctx, url, user\)/);
  assert.match(childWorkerSource, /禁止直接访问活动广场内部服务/);
  assert.match(childWorkerSource, /x-jinshan-service/);
  const childWorker = (await import(`../cloudflare/plaza-worker.js?test=${Date.now()}`)).default;
  const response = await childWorker.fetch(
    new Request('https://internal.test/api/plaza'),
    {},
    { waitUntil() {} }
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-jinshan-service'), 'plaza');
});

test('主Worker在绑定存在时透明转发公开排行请求', async () => {
  let forwarded = null;
  const mainWorker = (await import(`../cloudflare/worker.js?test=${Date.now()}`)).default;
  const response = await mainWorker.fetch(
    new Request('https://example.test/api/rankings?period=day'),
    {
      ENVIRONMENT: 'test',
      PROJECT_NAME: 'main-test',
      PLAZA_SERVICE: {
        async fetch(request) {
          forwarded = request;
          return new Response(JSON.stringify({ service: 'plaza', ok: true }), {
            headers: { 'content-type': 'application/json', 'x-jinshan-service': 'plaza' }
          });
        }
      }
    },
    { waitUntil() {} }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-jinshan-service'), 'plaza');
  assert.equal(new URL(forwarded.url).pathname, '/api/rankings');
  assert.deepEqual(await response.json(), { service: 'plaza', ok: true });
});

test('服务未绑定时保留本地路由，读取失败可回退且写入失败不重复执行', () => {
  assert.match(mainWorkerSource, /if \(!env\.PLAZA_SERVICE \|\| !isPlazaServiceRoute\(url\.pathname\)\) return null/);
  assert.match(mainWorkerSource, /if \(request\.method === 'GET' \|\| request\.method === 'HEAD'\) return null/);
  assert.match(mainWorkerSource, /活动广场服务暂时不可用，请稍后重试/);
  assert.match(mainWorkerSource, /const plaza = await handlePlazaRoutes\(request, env, ctx, url\)/);
  assert.match(mainWorkerSource, /const serviceRequest = new Request\(request\.clone\(\), \{ headers \}\)/);
});

test('主Worker认证后只向内部服务传递最小用户字段', () => {
  assert.match(mainWorkerSource, /id: user\.id/);
  assert.match(mainWorkerSource, /role: user\.role/);
  assert.match(mainWorkerSource, /trackId: user\.trackId/);
  assert.match(mainWorkerSource, /status: user\.status/);
  assert.doesNotMatch(mainWorkerSource, /plazaInternalUser[\s\S]*password/);
  assert.doesNotMatch(mainWorkerSource, /plazaInternalUser[\s\S]*token/);
  assert.match(mainWorkerSource, /headers\.delete\(PLAZA_USER_HEADER\)/);
});

test('独立服务复用原D1并跳过用户请求热路径中的运行时建表', () => {
  assert.match(plazaRouteSource, /authenticatedUser = null/);
  assert.match(plazaRouteSource, /authenticatedUser \? \{ user: authenticatedUser \} : await requireUser/);
  assert.match(plazaRouteSource, /env\.SKIP_RUNTIME_SCHEMA !== 'true'/);
  const testConfig = parseJson('cloudflare/plaza-service/wrangler.test.jsonc');
  const productionConfig = parseJson('cloudflare/plaza-service/wrangler.production.jsonc');
  assert.equal(testConfig.name, 'jinshan20-plaza-test');
  assert.equal(productionConfig.name, 'jinshan20-plaza');
  assert.equal(testConfig.workers_dev, false);
  assert.equal(productionConfig.workers_dev, false);
  assert.equal(testConfig.vars.SKIP_RUNTIME_SCHEMA, 'true');
  assert.equal(productionConfig.vars.SKIP_RUNTIME_SCHEMA, 'true');
  assert.equal(testConfig.d1_databases[0].database_id, '6d217199-0c06-45a3-8bdc-e32c36140957');
  assert.equal(productionConfig.d1_databases[0].database_id, '1734a812-afc8-4c49-a1f1-f776c4b7ae69');
});

test('当前阶段只部署子服务，Pages绑定留到部署成功后的独立切换', () => {
  const testPages = parseJson('cloudflare/pages-test/wrangler.jsonc');
  const productionPages = parseJson('cloudflare/pages-production/wrangler.jsonc');
  assert.equal(testPages.services, undefined);
  assert.equal(productionPages.services, undefined);
  assert.match(buildHookSource, /apply-plaza-service-split\.mjs/);
  assert.match(generatorSource, /PLAZA_SERVICE_BINDING_V1/);
});

test('广场服务拆分生成器可重复执行', () => {
  const firstRoute = read('cloudflare/routes/plaza.js');
  const firstWorker = read('cloudflare/worker.js');
  execFileSync(process.execPath, ['scripts/apply-plaza-service-split.mjs'], { stdio: 'pipe' });
  assert.equal(read('cloudflare/routes/plaza.js'), firstRoute);
  assert.equal(read('cloudflare/worker.js'), firstWorker);
});
