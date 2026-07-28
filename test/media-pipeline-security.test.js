const test = require('node:test');
const assert = require('node:assert/strict');

const signingModule = import('../cloudflare/lib/media-signing.js');
const mediaRouteModule = import('../cloudflare/routes/media.js');
const runtimeModule = import('../cloudflare/lib/runtime.js');

const env = {
  ENVIRONMENT: 'test',
  MEDIA_SIGNING_SECRET: 'test-only-media-signing-secret-with-sufficient-length'
};

const media = {
  id: 'media-1',
  mediaId: 'media-1',
  objectKey: 'media/test/user-1/media-1.webp'
};

test('私密图片签名只允许原媒体、原对象、原受众和原会话使用', async () => {
  const { createPrivateMediaUrl, verifyPrivateMediaRequest } = await signingModule;
  const signedPath = await createPrivateMediaUrl(env, media, 'owner', 'user-1', 900);
  const signedUrl = new URL(signedPath, 'https://jinshan20-test.pages.dev');

  assert.ok(await verifyPrivateMediaRequest(env, 'media-1', signedUrl.searchParams));

  const cases = [
    ['错误媒体ID', 'media-2', new URLSearchParams(signedUrl.searchParams)],
    ['错误对象Key', 'media-1', mutate(signedUrl.searchParams, 'key', 'media/test/user-1/other.webp')],
    ['错误受众', 'media-1', mutate(signedUrl.searchParams, 'aud', 'admin')],
    ['错误会话范围', 'media-1', mutate(signedUrl.searchParams, 'scope', 'user-2')],
    ['错误环境', 'media-1', mutate(signedUrl.searchParams, 'env', 'production')],
    ['删除签名', 'media-1', mutate(signedUrl.searchParams, 'sig', '')],
    ['篡改签名', 'media-1', mutate(signedUrl.searchParams, 'sig', `${signedUrl.searchParams.get('sig')}x`)],
    ['过期时间', 'media-1', mutate(signedUrl.searchParams, 'exp', '1')],
    ['缺少对象Key', 'media-1', mutate(signedUrl.searchParams, 'key', '')],
    ['缺少范围', 'media-1', mutate(signedUrl.searchParams, 'scope', '')]
  ];

  for (const [name, mediaId, params] of cases) {
    assert.equal(await verifyPrivateMediaRequest(env, mediaId, params), null, name);
  }
});

test('管理员签名与用户签名使用不同受众', async () => {
  const { createPrivateMediaUrl, verifyPrivateMediaRequest } = await signingModule;
  const path = await createPrivateMediaUrl(env, media, 'admin', 'admin-1', 900);
  const url = new URL(path, 'https://jinshan20-test.pages.dev');
  const verified = await verifyPrivateMediaRequest(env, 'media-1', url.searchParams);
  assert.equal(verified.aud, 'admin');
  assert.equal(verified.scope, 'admin-1');
});

test('私密媒体路由拒绝匿名与他人，允许所有者和管理员签名', async () => {
  const { createPrivateMediaUrl } = await signingModule;
  const { handleMediaRoutes } = await mediaRouteModule;
  const { createToken } = await runtimeModule;
  const routeEnv = mediaRouteEnv();
  const ownerToken = await createToken({ id: 'user-1', role: 'student' }, routeEnv.SESSION_SECRET);
  const otherToken = await createToken({ id: 'user-2', role: 'student' }, routeEnv.SESSION_SECRET);
  const adminToken = await createToken({ id: 'admin-1', role: 'admin' }, routeEnv.SESSION_SECRET);
  const ownerUrl = new URL(
    await createPrivateMediaUrl(routeEnv, media, 'owner', 'user-1', 900),
    'https://jinshan20-test.pages.dev'
  );
  const adminUrl = new URL(
    await createPrivateMediaUrl(routeEnv, media, 'admin', 'admin-1', 900),
    'https://jinshan20-test.pages.dev'
  );

  assert.equal((await callMedia(handleMediaRoutes, ownerUrl, routeEnv)).status, 403);
  assert.equal((await callMedia(handleMediaRoutes, ownerUrl, routeEnv, otherToken)).status, 403);
  assert.equal((await callMedia(handleMediaRoutes, ownerUrl, routeEnv, ownerToken)).status, 200);
  assert.equal((await callMedia(handleMediaRoutes, adminUrl, routeEnv, adminToken)).status, 200);
});

test('公开媒体匿名可读并真实命中Cache API，未发布和旧私密路由均为404', async () => {
  const { handleMediaRoutes } = await mediaRouteModule;
  const store = new Map();
  global.caches = {
    default: {
      match: async (request) => store.get(request.url)?.clone(),
      put: async (request, response) => store.set(request.url, response.clone())
    }
  };
  const routeEnv = mediaRouteEnv(true);
  const ctx = { waitUntil: (promise) => promise };
  const publicUrl = new URL('https://jinshan20-test.pages.dev/api/public-media/media-1');
  const first = await handleMediaRoutes(new Request(publicUrl), routeEnv, ctx, publicUrl);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await handleMediaRoutes(new Request(publicUrl), routeEnv, ctx, publicUrl);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-media-cache'), 'MISS');
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-media-cache'), 'HIT');

  routeEnv._visible = false;
  const unpublished = await handleMediaRoutes(new Request(publicUrl), routeEnv, ctx, publicUrl);
  assert.equal(unpublished.status, 404);
  const legacyUrl = new URL('https://jinshan20-test.pages.dev/api/media/media-1');
  const legacy = await handleMediaRoutes(new Request(legacyUrl), routeEnv, ctx, legacyUrl);
  assert.equal(legacy.status, 404);
});

test('媒体迁移包含上传意图、对象元数据和回滚脚本', () => {
  const fs = require('node:fs');
  const migration = fs.readFileSync('migrations/production/0006_media_pipeline.sql', 'utf8');
  const rollback = fs.readFileSync('migrations/production/0006_media_pipeline.rollback.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS media_upload_intents/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS media_objects/);
  assert.match(migration, /object_key TEXT NOT NULL UNIQUE/);
  assert.match(rollback, /DROP TABLE IF EXISTS media_objects/);
  assert.match(rollback, /DROP TABLE IF EXISTS media_upload_intents/);
});

test('前端使用固定版本压缩库且新图片流程不发送Base64', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(html, /browser-image-compression-2\.0\.2\.js/);
  assert.match(app, /useWebWorker:\s*true/);
  assert.match(app, /method:\s*'PUT'/);
  assert.match(app, /mediaIds:/);
  assert.doesNotMatch(app, /body:\s*JSON\.stringify\(\{\s*images:\s*photos/);
});

function mutate(original, key, value) {
  const params = new URLSearchParams(original);
  if (value === '') params.delete(key);
  else params.set(key, value);
  return params;
}

function mediaRouteEnv(visible = false) {
  const routeEnv = {
    ...env,
    SESSION_SECRET: 'test-session-secret-with-sufficient-length',
    _visible: visible,
    DB: {
      prepare(sql) {
        return {
          bind(...args) { this.args = args; return this; },
          first: async function () {
            if (/FROM users WHERE id/i.test(sql)) {
              const id = this.args?.[0];
              return {
                id,
                studentId: id,
                name: id,
                role: String(id).startsWith('admin') ? 'admin' : 'student',
                campus: '测试',
                trackId: 'interaction',
                status: 'active',
                createdAt: '2026-07-29T00:00:00.000Z'
              };
            }
            return routeEnv._visible
              ? { objectKey: media.objectKey, mimeType: 'image/webp' }
              : null;
          }
        };
      }
    },
    UPLOADS: {
      get: async () => ({
        body: new Blob(['webp-test']).stream(),
        size: 9,
        httpEtag: '"etag-media-1"',
        httpMetadata: { contentType: 'image/webp' }
      })
    }
  };
  return routeEnv;
}

const callMedia = async (handle, url, routeEnv, token = '') => {
  const request = new Request(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return handle(request, routeEnv, { waitUntil() {} }, url);
};
