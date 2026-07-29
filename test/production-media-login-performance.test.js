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

test('入口页不加载主应用，登录脚本具备移动端降级、防重复和十秒超时', () => {
  const html = fs.readFileSync('public/entrance.html', 'utf8');
  const index = fs.readFileSync('public/index.html', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const entrance = fs.readFileSync('public/entrance.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  const worker = fs.readFileSync('cloudflare/worker.js', 'utf8');
  assert.doesNotMatch(html, /\bapp\.js\b/);
  assert.match(html, /\bentrance\.js\b/);
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
  assert.match(worker, /studentId:\s*auth\.user\.studentId/);
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
  assert.match(admin, /COALESCE\(m\.object_key,i\.object_key\) AS objectKey/);
  assert.match(student, /COALESCE\(m\.object_key,i\.object_key\) AS objectKey/);
});

test('未发布图片公共接口404且不缓存；可见图片返回WebP并在第二次命中Cache API', async () => {
  const worker = (await import('../cloudflare/worker.js')).default;
  const cacheStore = new Map();
  global.caches = {
    default: {
      match: async (request) => cacheStore.get(request.url)?.clone(),
      put: async (request, response) => cacheStore.set(request.url, response.clone())
    }
  };

  const createEnv = (visible) => {
    const env = {
      ENVIRONMENT: 'test',
      PROJECT_NAME: 'jinshan20-test',
      SESSION_SECRET: 'test-session-secret-with-sufficient-length',
      MEDIA_SIGNING_SECRET: 'test-media-secret-with-sufficient-length',
      _visible: visible,
      _r2Reads: 0,
      DB: {
        prepare(sql) {
          return {
            bind(...args) { this.args = args; return this; },
            first: async () => {
              if (/FROM task_submission_images i[\s\S]*JOIN plaza_posts p/i.test(sql)) {
                return env._visible
                  ? { objectKey: 'media/test/display/image.webp', contentType: 'image/webp' }
                  : null;
              }
              return null;
            }
          };
        }
      },
      UPLOADS: {
        get: async () => {
          env._r2Reads += 1;
          return {
            body: new Blob(['webp-image']).stream(),
            size: 10,
            httpEtag: '"image-etag"',
            httpMetadata: { contentType: 'image/webp' }
          };
        }
      }
    };
    return env;
  };
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const privateEnv = createEnv(false);
  const unpublished = await worker.fetch(
    new Request('https://jinshan20-test.pages.dev/api/public-images/image-1?variant=thumb&v=1'),
    privateEnv,
    ctx
  );
  assert.equal(unpublished.status, 404);
  assert.equal(unpublished.headers.get('cache-control'), 'no-store');
  assert.equal(unpublished.headers.get('content-type').startsWith('application/json'), true);

  const publicEnv = createEnv(true);
  const url = 'https://jinshan20-test.pages.dev/api/public-images/image-1?variant=thumb&v=1';
  const first = await worker.fetch(new Request(url), publicEnv, ctx);
  await Promise.all(pending.splice(0));
  const second = await worker.fetch(new Request(url), publicEnv, ctx);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/webp');
  assert.equal(first.headers.get('x-image-cache'), 'MISS');
  assert.equal(first.headers.get('content-disposition'), 'inline');
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.match(first.headers.get('cache-control'), /immutable/);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('content-type'), 'image/webp');
  assert.equal(second.headers.get('x-image-cache'), 'HIT');
  assert.equal(publicEnv._r2Reads, 1);

  const head = await worker.fetch(new Request(url, { method: 'HEAD' }), publicEnv, ctx);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});


test('二次提速参数前后端一致，并复用已加载缩略图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const media = fs.readFileSync('cloudflare/routes/media.js', 'utf8');
  assert.match(app, /MEDIA_THUMB_MAX_EDGE = 360/);
  assert.match(app, /MEDIA_DISPLAY_MAX_EDGE = 960/);
  assert.match(app, /MEDIA_THUMB_QUALITY = 0\.72/);
  assert.match(app, /MEDIA_DISPLAY_QUALITY = 0\.78/);
  assert.match(app, /renderedImage\?\.complete/);
  assert.match(app, /await displayImage\.decode\(\)/);
  assert.match(media, /THUMB_MAX_EDGE = 360/);
  assert.match(media, /DISPLAY_MAX_EDGE = 960/);
  assert.doesNotMatch(media, /variant === 'thumb' \? 480 : 1280/);
});
