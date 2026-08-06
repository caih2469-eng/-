import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('用户首页仅包含确认的四项同排入口与累计打卡', () => {
  const app = read('public/app.js');
  assert.match(app, /student-shortcuts-four/);
  assert.match(app, /id="historyCheckins"/);
  assert.match(app, /id="plaza"/);
  assert.match(app, /id="inbox"/);
  assert.match(app, /id="teamCheckinStats"/);
  assert.match(app, /个人累计打卡/);
  assert.doesNotMatch(app, /<h2>最终截图证明<\/h2>/);
  assert.doesNotMatch(app, /data-material=/);
});

test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路', () => {
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
});

test('高清原图位于详情之上并可保存且不销毁下层详情', () => {
  const app = read('public/app.js');
  const css = read('public/admin-dashboard-refactor.css');
  assert.match(app, /data-image-close/);
  assert.match(app, /data-image-save/);
  assert.match(app, /saveOriginalImage/);
  assert.match(app, /window\.open\(target, '_blank'/);
  assert.match(css, /\.image-viewer \{ z-index: 100000/);
  assert.match(app, /activeImageViewer\.remove\(\)/);
});

test('管理员可以设置打卡日期时段星期和两类照片数量', () => {
  const app = read('public/app.js');
  const admin = read('cloudflare/routes/admin.js');
  const runtime = read('cloudflare/lib/runtime.js');
  const dashboard = read('cloudflare/services/student-dashboard.js');
  assert.match(app, /adminAccordionMarkup\('checkin', '打卡设置'/);
  assert.match(app, /personalImageLimit/);
  assert.match(app, /teamImageLimit/);
  assert.match(admin, /\/api\/admin\/checkin-settings/);
  assert.match(runtime, /checkinSettings:/);
  assert.match(dashboard, /applyInteractionCheckinSettings/);
  assert.match(dashboard, /memberImageLimit/);
  assert.match(dashboard, /checkinEnabled/);
});

test('累计打卡数据由后端按有效日期去重计算', () => {
  const dashboard = read('cloudflare/services/student-dashboard.js');
  assert.match(dashboard, /COUNT\(DISTINCT checkin_date\)/);
  assert.match(dashboard, /COUNT\(DISTINCT occurrence_date\)/);
  assert.match(dashboard, /personalDays/);
  assert.match(dashboard, /teamDays/);
  assert.match(dashboard, /status IN \('submitted','approved'\)/);
});

test('管理员广场详情返回照片并自动显示队伍名称', () => {
  const app = read('public/app.js');
  const admin = read('cloudflare/routes/admin.js');
  assert.match(app, /<dt>队伍<\/dt><dd>\$\{escapeHtml\(post\.teamName\)\}<\/dd>/);
  assert.match(app, /admin-post-photo-grid/);
  assert.match(app, /data-perf-image="admin-plaza-thumb"/);
  assert.match(admin, /imagesBySubmission/);
  assert.match(admin, /images: imagesBySubmission\.get\(item\.submissionId\)/);
});

test('所有入口使用本轮唯一新资源版本', () => {
  for (const path of ['public/bootstrap.js', 'public/index.html', 'public/entrance.html']) {
    const content = read(path);
    assert.match(content, /20260731-approved1/);
    assert.doesNotMatch(content, /20260730-(?:flow2|adminphoto1|adminphoto2)/);
  }
});
