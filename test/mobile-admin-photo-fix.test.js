import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('管理员用户卡片点击立即打开，并在触摸和空闲阶段预取记录', () => {
  const app = read('public/app.js');
  const panelStart = app.indexOf('const renderAdminUserPanel');
  const panelEnd = app.indexOf('async function refreshCompactAdminUsers', panelStart);
  const panel = app.slice(panelStart, panelEnd);
  assert.match(panel, /openAdminUserDrawer\(studentUser, date\)/);
  assert.match(panel, /touchstart/);
  assert.match(panel, /pointerdown/);
  assert.match(panel, /prefetchAdminCheckinForUser/);
  assert.match(panel, /prefetchAdminCheckinsForUsers\(result\.users, date\)/);
  assert.doesNotMatch(panel, /loadCompactAdminTeams\(\)/);
  assert.doesNotMatch(panel, /api\('\/api\/admin\/tasks'\)/);
  assert.doesNotMatch(panel, /beginButtonLoading\(button/);
});

test('V3抽屉使用五分钟缓存、请求去重和首图高优先级', () => {
  const app = read('public/app.js');
  const start = app.indexOf('/* MOBILE_ADMIN_PHOTO_FIX_V3 */');
  const end = app.indexOf('function taskFormFields', start);
  const drawer = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(drawer, /ADMIN_CHECKIN_CACHE_TTL_MS = 300_000/);
  assert.match(drawer, /ADMIN_CHECKIN_PREFETCH_LIMIT = 8/);
  assert.match(drawer, /ADMIN_CHECKIN_PREFETCH_CONCURRENCY = 2/);
  assert.match(drawer, /adminCheckinInflight/);
  assert.match(drawer, /warmAdminThumbnail/);
  assert.match(drawer, /requestIdleCallback/);
  assert.match(drawer, /loading="\$\{first \? 'eager' : 'lazy'\}"/);
  assert.match(drawer, /fetchpriority="\$\{first \? 'high' : 'low'\}"/);
  assert.match(drawer, /admin-thumb-visible/);
  assert.doesNotMatch(drawer, /基本资料|所属队伍|补卡权限|管理操作|管理员代为补卡/);
});

test('管理端缩略图最长边540px、WebP且目标体积不超过150KB', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-admin-thumbnails-540.mjs');
  assert.match(app, /MEDIA_THUMB_MAX_EDGE = 540/);
  assert.match(app, /MEDIA_THUMB_MAX_SIZE_MB = 0\.10/);
  assert.match(app, /MEDIA_THUMB_QUALITY = 0\.78/);
  assert.match(app, /正在生成540px WebP缩略图/);
  assert.match(app, /businessType: 'member-checkin'[\s\S]*variant: 'thumb'[\s\S]*parentMediaId: displayMediaId/);
  assert.match(media, /THUMB_MAX_EDGE = 540/);
  assert.match(backfill, /admin-thumbs-540-v3/);
  assert.match(backfill, /encode\(540, 78\)/);
  assert.match(backfill, /120 \* 1024/);
  assert.match(backfill, /超过150KB/);
});

test('私密缩略图鉴权后使用边缘缓存，浏览器仍使用私有缓存', () => {
  const media = read('cloudflare/routes/media.js');
  assert.match(media, /PRIVATE_MEDIA_EDGE_CACHE_V3/);
  assert.match(media, /verifyPrivateMediaRequest/);
  assert.match(media, /cache\.match\(cacheKey\)/);
  assert.match(media, /x-media-cache', 'HIT/);
  assert.match(media, /private, max-age=900, immutable/);
  assert.match(media, /cache\.put\(cacheKey/);
});

test('手机管理端头部使用两列紧凑按钮并让退出独占一行', () => {
  const css = read('public/admin-dashboard-refactor.css');
  assert.match(css, /\.admin-header-actions \{ display: grid; grid-template-columns: repeat\(2/);
  assert.match(css, /\.admin-header-actions #out \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /min-height: 52px/);
});

test('媒体签名URL在十五分钟窗口内稳定以复用缓存', () => {
  const signing = read('cloudflare/lib/media-signing.js');
  assert.match(signing, /let hmacKeyPromise = null/);
  assert.match(signing, /Math\.floor\(nowSeconds \/ ttlSeconds\)/);
});

test('正式资源使用adminphoto3且生成无缓存部署标记', () => {
  const deployment = JSON.parse(read('public/deployment.json'));
  const index = read('public/index.html');
  const bootstrap = read('public/bootstrap.js');
  const headers = read('public/_headers');
  assert.equal(deployment.version, '20260730-adminphoto3');
  assert.equal(deployment.feature, 'mobile-admin-thumb-prefetch-v3');
  assert.match(index, /bootstrap\.js\?v=20260730-adminphoto3/);
  assert.match(bootstrap, /app\.js\?v=20260730-adminphoto3/);
  assert.doesNotMatch(`${index}\n${bootstrap}`, /20260730-(?:flow2|adminphoto1|adminphoto2)/);
  assert.match(headers, /\/deployment\.json\n  Cache-Control: no-cache, no-store, must-revalidate/);
});

test('V3缩略图回填保留原图和旧缩略图', () => {
  const script = read('scripts/backfill-admin-thumbnails-540.mjs');
  assert.match(script, /--confirm-production jinshan20/);
  assert.match(script, /withoutEnlargement: true/);
  assert.match(script, /oldThumbObjectKeysPreserved/);
  assert.doesNotMatch(script, /r2', 'object', 'delete/);
});
