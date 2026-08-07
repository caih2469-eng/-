const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('站内路径统一为单斜杠，媒体地址不会生成 //api', () => {
  const source = fs.readFileSync('public/site-path.js', 'utf8');
  const context = {
    globalThis: {
      location: { origin: 'https://jinshan20-test.pages.dev' }
    },
    URL
  };
  vm.runInNewContext(source, context);
  const { normalizeSitePath, buildMediaUrl } = context.globalThis;
  const paths = [
    '/api/public-images/a',
    '//api/public-images/a',
    '///api//public-images///a',
    'api/public-images/a',
    '//api/public-images/a?variant=thumb&v=1'
  ];
  for (const input of paths) {
    const normalized = normalizeSitePath(input);
    assert.match(normalized, /^\/api\//);
    assert.doesNotMatch(normalized, /^\/\/api\//);
  }
  assert.equal(
    buildMediaUrl('//api/public-images/a', 'thumb', '37'),
    '/api/public-images/a?variant=thumb&v=37'
  );
});

test('入口页不执行主应用，允许仅预取下一页资源；登录脚本具备移动端降级、防重复和十秒超时', () => {
  const html = fs.readFileSync('public/entrance.html', 'utf8');
  const index = fs.readFileSync('public/index.html', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const entrance = fs.readFileSync('public/entrance.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  const worker = fs.readFileSync('cloudflare/worker.js', 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*(?:\/app\.js|\/bootstrap\.js)/i);
  assert.match(html, /\bentrance\.js\b/);
  if (/\bapp\.js\b/.test(html) || /\bbootstrap\.js\b/.test(html)) {
    assert.match(html, /LOGIN_HOME_PREFETCH_V2/);
    assert.match(html, /<link[^>]+rel=["']prefetch["'][^>]+href=["'][^"']*\/(?:app|bootstrap)\.js/i);
  }
  assert.doesNotMatch(html, /\.ttf(?:[?"'])/i);
  assert.match(html, /font-display:\s*swap/i);
  assert.match(entrance, /AbortController/);
  assert.match(entrance, /10_?000/);
  assert.match(entrance, /loginPending/);
  assert.match(entrance, /location\.replace\(['"]\/['"]\)/);
  assert.match(entrance, /MicroMessenger|MQQBrowser/);
  assert.doesNotMatch(index, /<script[^>]+src=["']\/app\.js/i);
  assert.match(index, /\bbootstrap\.js\b/);
  assert.match(bootstrap, /fetch\(['"]\/api\/session['"]/);
  assert.match(bootstrap, /__BOOTSTRAP_AUTHENTICATED__/);
  assert.match(app, /window\.__BOOTSTRAP_AUTHENTICATED__/);
  assert.match(worker, /user:\s*auth\.user/);
  assert.match(worker, /dashboard/);
});

test('图片列表在SQL层分页，首屏不超过20张且管理员每页不超过30人', () => {
  const plaza = fs.readFileSync('cloudflare/routes/plaza.js', 'utf8');
  const admin = fs.readFileSync('cloudflare/routes/admin.js', 'utf8');
  const student = fs.readFileSync('cloudflare/routes/student.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(plaza, /Math\.min\(20/);
  assert.match(plaza, /LIMIT \?\$\{params\.length - 1\} OFFSET \?\$\{params\.length\}/);
  assert.match(admin, /Math\.min\(30/);
  assert.match(admin, /ORDER BY u\.name,u\.student_id LIMIT \?4 OFFSET \?5/);
  assert.match(student, /Math\.min\(20/);
  assert.doesNotMatch(app, /new MutationObserver/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /data-src=/);
  assert.match(app, /limit=20/);
  assert.doesNotMatch(`${plaza}\n${admin}\n${student}`, /data:image\/[^;]+;base64/i);
  assert.match(admin, /IN \('task:thumb','admin-makeup:thumb'\)/);
  assert.match(student, /IN \('member-checkin:thumb','admin-makeup:thumb'\)/);
  assert.doesNotMatch(plaza, /SELECT\s+\*/i);
  assert.doesNotMatch(admin, /SELECT\s+\*/i);
  assert.doesNotMatch(student, /SELECT\s+\*/i);
});
