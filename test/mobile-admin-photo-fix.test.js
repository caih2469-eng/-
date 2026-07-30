import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('管理员用户卡片点击后立即打开打卡抽屉，不再等待全部队伍和任务', () => {
  const app = read('public/app.js');
  const panelStart = app.indexOf('const renderAdminUserPanel');
  const panelEnd = app.indexOf('async function refreshCompactAdminUsers', panelStart);
  const panel = app.slice(panelStart, panelEnd);
  assert.match(panel, /openAdminUserDrawer\(studentUser, date\)/);
  assert.doesNotMatch(panel, /loadCompactAdminTeams\(\)/);
  assert.doesNotMatch(panel, /api\('\/api\/admin\/tasks'\)/);
  assert.doesNotMatch(panel, /beginButtonLoading\(button/);
});

test('打卡抽屉仅显示打卡记录并提供一分钟缓存和请求去重', () => {
  const app = read('public/app.js');
  const start = app.indexOf('/* MOBILE_ADMIN_PHOTO_FIX_V1 */');
  const end = app.indexOf('function taskFormFields', start);
  const drawer = app.slice(start, end);
  assert.match(drawer, /ADMIN_CHECKIN_CACHE_TTL_MS = 60_000/);
  assert.match(drawer, /adminCheckinInflight/);
  assert.match(drawer, /admin-checkin-photo-grid/);
  assert.doesNotMatch(drawer, /基本资料|所属队伍|补卡权限|管理操作/);
  assert.doesNotMatch(drawer, /new Image\(\)/);
});

test('所有管理端缩略图限制为最长边540px并优先WebP', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  assert.match(app, /MEDIA_THUMB_MAX_EDGE = 540/);
  assert.match(app, /MEDIA_THUMB_QUALITY = 0\.82/);
  assert.match(app, /正在生成540px WebP缩略图/);
  assert.match(app, /businessType: 'member-checkin'[\s\S]*variant: 'thumb'[\s\S]*parentMediaId: displayMediaId/);
  assert.match(media, /THUMB_MAX_EDGE = 540/);
});

test('手机管理端头部使用两列紧凑按钮并让退出独占一行', () => {
  const css = read('public/admin-dashboard-refactor.css');
  assert.match(css, /\.admin-header-actions \{ display: grid; grid-template-columns: repeat\(2/);
  assert.match(css, /\.admin-header-actions #out \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /min-height: 52px/);
});

test('媒体签名复用导入后的HMAC密钥', () => {
  const signing = read('cloudflare/lib/media-signing.js');
  assert.match(signing, /let hmacKeyPromise = null/);
  assert.match(signing, /if \(!hmacKeyPromise \|\| hmacKeySecret !== secret\)/);
});

test('540px缩略图回填脚本具备正式环境双重确认和原图保护', () => {
  const script = read('scripts/backfill-admin-thumbnails-540.mjs');
  assert.match(script, /--confirm-production jinshan20/);
  assert.match(script, /withoutEnlargement: true/);
  assert.match(script, /oldThumbObjectKeysPreserved/);
  assert.doesNotMatch(script, /r2', 'object', 'delete/);
});
