import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const appPath = 'public/app.js';
const run = (script) => {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.status !== 0) process.exit(result.status || 1);
};

let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('/* ADMIN_DASHBOARD_REFACTOR_V1 */')) {
  run('scripts/apply-admin-dashboard-refactor.mjs');
  app = fs.readFileSync(appPath, 'utf8');
}

if (!app.includes('/* MOBILE_ADMIN_PHOTO_FIX_V1 */')
    && !app.includes('/* MOBILE_ADMIN_PHOTO_FIX_V3 */')) {
  run('scripts/apply-mobile-admin-photo-fix.mjs');
}

run('scripts/finalize-mobile-admin-photo-fix.mjs');

const updateTest = (file, transform) => {
  const source = fs.readFileSync(file, 'utf8');
  const next = transform(source);
  if (next !== source) fs.writeFileSync(file, next, 'utf8');
};

updateTest('test/production-media-login-performance.test.js', (source) => source
  .replace(/MEDIA_THUMB_MAX_EDGE = (?:360|540)/g, 'MEDIA_THUMB_MAX_EDGE = 540')
  .replace(/MEDIA_THUMB_QUALITY = 0\\\.(?:72|78|82)/g, 'MEDIA_THUMB_QUALITY = 0\\.78')
  .replace(/THUMB_MAX_EDGE = (?:360|540)/g, 'THUMB_MAX_EDGE = 540'));

updateTest('test/member-checkin-fast.test.js', (source) => {
  let next = source.replace(/MEDIA_THUMB_QUALITY = 0\\\.(?:72|78|82)/g, 'MEDIA_THUMB_QUALITY = 0\\.78');
  const replacement = `test('单人打卡展示图使用fast接口并生成540px WebP缩略图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const memberBody = app.match(
    /function memberCheckinForm\\(task\\) \\{([\\s\\S]*?)\\r?\\n\\}\\r?\\n\\r?\\nfunction materialSubmissionForm/
  )?.[1] || '';
  assert.match(memberBody, /uploadMemberCheckinFast/);
  assert.match(memberBody, /uploadCompressedImage/);
  assert.match(memberBody, /variant:\\s*'thumb'/);
  assert.match(memberBody, /parentMediaId:\\s*displayMediaId/);
  assert.match(memberBody, /正在生成540px WebP缩略图/);
  assert.match(memberBody, /const mediaIds = session\\?\\.items/);
  assert.doesNotMatch(memberBody, /readFiles/);
  assert.match(app, /const MEMBER_FAST_MAX_BYTES = 307_200/);
  assert.match(app, /const MEDIA_THUMB_MAX_EDGE = 540/);
  assert.match(app, /const MEDIA_THUMB_QUALITY = 0\\.78/);
  assert.match(app, /\\{ maxWidthOrHeight: 960, initialQuality: 0\\.76, maxSizeMB: 0\\.25 \\}/);
  assert.match(app, /\\{ maxWidthOrHeight: 960, initialQuality: 0\\.70, maxSizeMB: 0\\.30 \\}/);
  assert.match(app, /\\{ maxWidthOrHeight: 800, initialQuality: 0\\.68, maxSizeMB: 0\\.30 \\}/);
  assert.match(app, /图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。/);
});`;
  const pattern = /test\('单人打卡前端只使用fast接口、最多三轮压缩且不生成缩略图',[\s\S]*?\n\}\);/;
  if (pattern.test(next)) next = next.replace(pattern, replacement);
  return next;
});

app = fs.readFileSync(appPath, 'utf8');
const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
const index = fs.readFileSync('public/index.html', 'utf8');
if (!app.includes('/* MOBILE_ADMIN_PHOTO_FIX_V3 */')) {
  throw new Error('当前手机管理端 V3 代码未生成');
}
if (!bootstrap.includes('20260730-adminphoto3') || !index.includes('20260730-adminphoto3')) {
  throw new Error('当前资源版本未统一为 20260730-adminphoto3');
}
if (/20260730-(?:flow2|adminphoto1|adminphoto2)/.test(`${bootstrap}\n${index}`)) {
  throw new Error('仍检测到旧资源版本，停止构建');
}
console.log('Current assets ready: 20260730-adminphoto3.');
