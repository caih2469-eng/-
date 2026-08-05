import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');

execFileSync(process.execPath, ['scripts/apply-plaza-detail-fast-path.mjs'], { stdio: 'pipe' });

const app = read('public/app.js');
const plazaRoute = read('cloudflare/routes/plaza.js');

test('activity plaza detail opens from cached list preview before the full request finishes', () => {
  assert.match(app, /PLAZA_DETAIL_INSTANT_OPEN_V2/);
  assert.match(app, /const previewPost = readPlazaPostPreview\(postId\)/);
  assert.match(app, /正在补齐成员与全部图片/);
  assert.match(app, /plaza-detail-preview-visible/);
  assert.match(app, /previewHit: Boolean\(previewPost\)/);
  assert.match(app, /previewImage\.thumbUrl/);
});

test('detail metadata is prefetched only on likely intent and for the first visible cards', () => {
  assert.match(app, /warmVisiblePlazaDetails/);
  assert.match(app, /slice\(0, 4\)/);
  assert.match(app, /connection\.saveData/);
  assert.match(app, /document\.addEventListener\('pointerdown', prefetch/);
  assert.match(app, /document\.addEventListener\('pointerover', prefetch/);
  assert.match(app, /document\.addEventListener\('focusin', prefetch/);
  assert.doesNotMatch(app, /PLAZA_DETAIL_INSTANT_OPEN_V2[\s\S]*new MutationObserver/);
});

test('detail image and comment scheduling prioritize visible post content', () => {
  const detailStart = app.indexOf('async function openPlazaPost');
  const detailEnd = app.indexOf('\nfunction ', detailStart + 1);
  const detail = app.slice(detailStart, detailEnd > detailStart ? detailEnd : undefined);
  assert.match(detail, /imageIndex === 0 \? 'src' : 'data-src'/);
  const visibleMetric = detail.indexOf("recordPerf('plaza-detail-visible'");
  const commentsRequest = detail.indexOf('/comments?page=1&limit=10');
  assert.ok(visibleMetric >= 0, '缺少详情可见指标');
  assert.ok(commentsRequest > visibleMetric, '评论请求必须在详情可见后启动');
});

test('detail counts combine liked state into the existing aggregate query', () => {
  assert.match(plazaRoute, /PLAZA_DETAIL_INSTANT_OPEN_V2/);
  assert.match(plazaRoute, /EXISTS\(SELECT 1 FROM plaza_likes WHERE post_id=\?1 AND user_id=\?2\) AS liked/);
  assert.match(plazaRoute, /liked: Boolean\(counts\.liked\)/);
  assert.doesNotMatch(plazaRoute, /const \[members, images, counts, liked\]/);
  assert.doesNotMatch(plazaRoute, /SELECT 1 AS liked FROM plaza_likes WHERE post_id=\?1 AND user_id=\?2/);
});

test('instant-open generator remains idempotent', () => {
  const firstApp = read('public/app.js');
  const firstRoute = read('cloudflare/routes/plaza.js');
  execFileSync(process.execPath, ['scripts/apply-plaza-detail-fast-path.mjs'], { stdio: 'pipe' });
  assert.equal(read('public/app.js'), firstApp);
  assert.equal(read('cloudflare/routes/plaza.js'), firstRoute);
});
