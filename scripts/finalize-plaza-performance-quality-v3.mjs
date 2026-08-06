import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'public/app.js');
const templatePath = path.join(root, 'templates/plaza-mobile-page.txt');
const testPath = path.join(root, 'test/stage-e-ui-cache-navigation.test.js');
const mobileTestPath = path.join(root, 'test/approved-mobile-experience.test.js');
const title = '阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离';
const mobileTitle = '活动广场、历史打卡和管理员列表图统一使用960px Pica链路';

const app = fs.readFileSync(appPath, 'utf8');
const template = fs.readFileSync(templatePath, 'utf8');
let testSource = fs.readFileSync(testPath, 'utf8');
let mobileTestSource = fs.readFileSync(mobileTestPath, 'utf8');

if (!app.includes('/* PLAZA_PERFORMANCE_QUALITY_V3 */')
    || !template.includes('/* PLAZA_PERFORMANCE_QUALITY_V3 */')
    || !app.includes('const VIEW_CACHE_TTL_MS = 60_000;')
    || !app.includes('cardIndex < 4')
    || !app.includes('2048w')) {
  throw new Error('活动广场性能与画质V3运行时尚未完成，停止收敛测试');
}

const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`test\\('${escapedTitle}',[\\s\\S]*?\\r?\\n\\}\\);`);
const replacement = String.raw`test('阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离', () => {
  assert.match(appSource, /const VIEW_CACHE_TTL_MS = 60_000;/);
  assert.match(appSource, /const plazaViewCache = new Map\(\);/);
  assert.match(appSource, /const rankingViewCache = new Map\(\);/);
  assert.match(appSource, /const adminCommentViewCache = new Map\(\);/);
  assert.match(appSource, /const scopedCacheKey = \(\.\.\.parts\) => \[/);
  assert.match(appSource, /user\?\.id \|\| user\?\.studentId \|\| 'anonymous'/);
  assert.match(appSource, /\]\.join\('\|'\);/);
  assert.match(appSource, /scopedCacheKey\('plaza', safeSort, page, safeQuery\)/);
  assert.match(appSource, /q=\$\{encodeURIComponent\(safeQuery\)\}/);
  assert.match(adminSource, /scopedCacheKey\('admin-comments', page\)/);
  const cacheBlock = sourceBetween('const VIEW_CACHE_TTL_MS', 'const clearUserViewCaches');
  assert.doesNotMatch(cacheBlock, /localStorage|sessionStorage/);
});`;

if (!pattern.test(testSource)) {
  throw new Error('活动广场阶段E缓存测试锚点未找到');
}
testSource = testSource.replace(pattern, replacement);
fs.writeFileSync(testPath, testSource, 'utf8');

const escapedMobileTitle = mobileTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mobilePattern = new RegExp(`test\\('${escapedMobileTitle}',[\\s\\S]*?\\r?\\n\\}\\);`);
const mobileReplacement = String.raw`test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路', () => {
  const app = read('public/app.js');
  const style = read('public/style.css');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-admin-thumbnails-540.mjs');
  const plazaBody = app.match(/\/\* PLAZA_MOBILE_LAYOUT_V1 \*\/[\s\S]*?async function plaza/)?.[0] || '';
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /data-perf-image="history-thumb"/);
  assert.match(plazaBody, /data-perf-image="plaza-thumb"/);
  assert.match(plazaBody, /data-priority=/);
  assert.match(plazaBody, /cardIndex < 4 \? 'eager' : 'lazy'/);
  assert.match(plazaBody, /cardIndex < 2 \? 'high' : cardIndex < 4 \? 'auto' : 'low'/);
  assert.match(plazaBody, /cardIndex < 4 \? 'high' : 'low'/);
  assert.match(app, /data-perf-image="admin-checkin-thumb"/);
  assert.match(style, /column-count:\s*2/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /thumbs-720-v1/);
  assert.match(backfill, /encode\(720, 84\)/);
});`;

if (!mobilePattern.test(mobileTestSource)) {
  throw new Error('活动广场图片优先级测试锚点未找到');
}
mobileTestSource = mobileTestSource.replace(mobilePattern, mobileReplacement);
fs.writeFileSync(mobileTestPath, mobileTestSource, 'utf8');

if (!testSource.includes('const VIEW_CACHE_TTL_MS = 60_000;')
    || !testSource.includes("scopedCacheKey\\('plaza', safeSort, page, safeQuery\\)")
    || !mobileTestSource.includes("cardIndex < 4 \\? 'eager' : 'lazy'")
    || !mobileTestSource.includes("cardIndex < 2 \\? 'high' : cardIndex < 4 \\? 'auto' : 'low'")
    || !mobileTestSource.includes("cardIndex < 4 \\? 'high' : 'low'")) {
  throw new Error('活动广场V3测试收敛失败');
}

console.log('Finalized plaza V3 runtime, cache and image-priority assertions after mobile layout generation.');