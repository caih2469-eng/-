import fs from 'node:fs';
import path from 'node:path';

await import('./apply-plaza-service-split.mjs');

const routePath = path.resolve('cloudflare/routes/student.js');
const workerPath = path.resolve('cloudflare/worker.js');
const routeMarker = '/* CHECKIN_SERVICE_ROUTE_V1 */';
const workerMarker = '/* CHECKIN_SERVICE_BINDING_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

let route = fs.readFileSync(routePath, 'utf8');
if (!route.includes(routeMarker)) {
  route = replaceOnce(
    route,
    "import { createPrivateMediaUrl } from '../lib/media-signing.js';",
    `import { createPrivateMediaUrl } from '../lib/media-signing.js';\n\n${routeMarker}`,
    '打卡路由导入位置'
  );
  route = replaceOnce(
    route,
    'export const handleStudentRoutes = async (request, env, ctx, url) => {',
    'export const handleStudentRoutes = async (request, env, ctx, url, authenticatedUser = null) => {',
    '学生路由函数签名'
  );
  route = replaceOnce(
    route,
    `  const auth = await requireUser(request, env);\n  if (auth.error) return auth.error;\n  const user = auth.user;`,
    `  const auth = authenticatedUser ? { user: authenticatedUser } : await requireUser(request, env);\n  if (auth.error) return auth.error;\n  const user = auth.user;`,
    '学生路由认证链路'
  );
  fs.writeFileSync(routePath, route, 'utf8');
}

const workerHelpers = [
  workerMarker,
  "const CHECKIN_USER_HEADER = 'x-jinshan-checkin-user';",
  "const CHECKIN_SERVICE_HEADER = 'x-jinshan-internal-service';",
  "const CHECKIN_HEALTH_PATH = '/api/checkin-service-health';",
  'const isCheckinServiceRoute = (pathname) => pathname === CHECKIN_HEALTH_PATH',
  "  || pathname === '/api/checkins'",
  "  || pathname === '/api/checkins/history'",
  "  || /^\\/api\\/tasks\\/[^/]+\\/member-checkin$/.test(pathname);",
  'const checkinInternalUser = (user) => encodeURIComponent(JSON.stringify({',
  '  id: user.id,',
  '  role: user.role,',
  '  trackId: user.trackId,',
  '  status: user.status',
  '}));',
  'const dispatchCheckinService = async (request, env, ctx, url) => {',
  '  if (!env.CHECKIN_SERVICE || !isCheckinServiceRoute(url.pathname)) return null;',
  '  const isHealth = url.pathname === CHECKIN_HEALTH_PATH && request.method === \'GET\';',
  '  let user = null;',
  '  if (!isHealth) {',
  '    const auth = await requireUser(request, env);',
  '    if (auth.error) return auth.error;',
  '    user = auth.user;',
  '  }',
  '  const headers = new Headers(request.headers);',
  '  headers.delete(CHECKIN_USER_HEADER);',
  '  headers.delete(CHECKIN_SERVICE_HEADER);',
  "  headers.set(CHECKIN_SERVICE_HEADER, 'checkin-v1');",
  '  if (user) headers.set(CHECKIN_USER_HEADER, checkinInternalUser(user));',
  '  const serviceRequest = new Request(request.clone(), { headers });',
  '  try {',
  '    return await env.CHECKIN_SERVICE.fetch(serviceRequest);',
  '  } catch (error) {',
  "    if (request.method === 'GET' || request.method === 'HEAD') return null;",
  "    return json({ error: '打卡服务暂时不可用，请稍后重试' }, 503, {",
  "      'x-jinshan-service-error': 'checkin-binding'",
  '    });',
  '  }',
  '};',
  ''
].join('\n');

let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes(workerMarker)) {
  worker = replaceOnce(
    worker,
    'const routeRequest = async (request, env, ctx) => {',
    `${workerHelpers}const routeRequest = async (request, env, ctx) => {`,
    '主Worker路由函数位置'
  );
  worker = replaceOnce(
    worker,
    `      const student = await handleStudentRoutes(request, env, ctx, url);`,
    `      const checkinService = await dispatchCheckinService(request, env, ctx, url);\n      if (checkinService) return checkinService;\n\n      const student = await handleStudentRoutes(request, env, ctx, url);`,
    '打卡服务转发位置'
  );
  fs.writeFileSync(workerPath, worker, 'utf8');
}

route = fs.readFileSync(routePath, 'utf8');
worker = fs.readFileSync(workerPath, 'utf8');
if (!route.includes(routeMarker)
    || !route.includes('authenticatedUser = null')
    || !worker.includes(workerMarker)
    || !worker.includes("CHECKIN_HEALTH_PATH = '/api/checkin-service-health'")
    || !worker.includes('env.CHECKIN_SERVICE.fetch(serviceRequest)')
    || !worker.includes("request.method === 'GET' || request.method === 'HEAD'")) {
  throw new Error('打卡独立服务生成不完整');
}

console.log('Applied check-in service binding with safe local fallback.');
