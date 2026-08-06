import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');
const runGenerator = (file) => execFileSync(process.execPath, [file], { stdio: 'pipe' });

runGenerator('scripts/apply-plaza-detail-fast-path.mjs');
runGenerator('scripts/apply-plaza-mobile-layout.mjs');
runGenerator('scripts/finalize-plaza-performance-quality-v3.mjs');

const app = read('public/app.js');
const bootstrap = read('public/bootstrap.js');
const plazaPageTemplate = read('templates/plaza-mobile-page.txt');
const plazaRoute = read('cloudflare/routes/plaza.js');

test('activity plaza detail opens from cached list preview before the full request finishes', () => {
  assert.match(app, /PLAZA_DETAIL_INSTANT_OPEN_V2/);
  assert.match(app, /PLAZA_PERFORMANCE_QUALITY_V3/);
  assert.match(app, /const previewPost = readPlazaPostPreview\(postId\)/);
  assert.doesNotMatch(app, /正在补齐成员与全部图片/);
  assert.match(app, /formatDate\(previewPost\.publishedAt\)/);
  assert.match(app, /plaza-detail-preview-visible/);
  assert.match(app, /previewHit: Boolean\(previewPost\)/);
  assert.match(app, /previewImage\.displayUrl/);
  assert.match(app, /srcset="[^\n]*960w,[^\n]*2048w"/);
});

test('first-screen plaza cards start immediately and use responsive high-quality sources', () => {
  assert.match(app, /cardIndex < 4 \? 'eager' : 'lazy'/);
  assert.match(app, /cardIndex < 2 \? 'high' : cardIndex < 4 \? 'auto' : 'low'/);
  assert.match(app, /cardIndex < 4 \? 'high' : 'low'/);
  assert.match(app, /calc\(50vw - 18px\), 360px/);
  assert.match(app, /post\.images\[0\]\.displayUrl/);
  assert.match(plazaPageTemplate, /PLAZA_PERFORMANCE_QUALITY_V3/);
  assert.match(plazaPageTemplate, /cardIndex < 4/);
  assert.match(plazaPageTemplate, /2048w/);
});

test('detail metadata is warmed immediately for visible cards without waiting for idle time', () => {
  assert.match(app, /warmVisiblePlazaDetails/);
  assert.match(app, /slice\(0, 4\)/);
  assert.match(app, /connection\.saveData/);
  assert.match(app, /const delay = index < 2 \? index \* 40 : 220/);
  assert.match(app, /queueMicrotask\(run\)/);
  assert.match(app, /scheduleVisiblePlazaDetailWarmup\(\);/);
  assert.match(app, /document\.addEventListener\('pointerdown', prefetch/);
  assert.match(app, /document\.addEventListener\('pointerover', prefetch/);
  assert.match(app, /document\.addEventListener\('focusin', prefetch/);
  assert.doesNotMatch(app, /PLAZA_DETAIL_INSTANT_OPEN_V2[\s\S]*new MutationObserver/);
});

test('detail image and comment scheduling prioritize visible high-quality post content', () => {
  const detailStart = app.indexOf('async function openPlazaPost');
  const detailEnd = app.indexOf('\nfunction ', detailStart + 1);
  const detail = app.slice(detailStart, detailEnd > detailStart ? detailEnd : undefined);
  assert.match(detail, /imageIndex === 0/);
  assert.match(detail, /image\.displayUrl/);
  assert.match(detail, /960w,[^\n]*2048w/);
  assert.match(detail, /post\.images\.slice\(0, 2\)/);
  assert.match(detail, /preload\.fetchPriority = imageIndex === 0 \? 'high' : 'low'/);
  const visibleMetric = detail.indexOf("recordPerf('plaza-detail-visible'");
  const commentsRequest = detail.indexOf('/comments?page=1&limit=10');
  assert.ok(visibleMetric >= 0, '缺少详情可见指标');
  assert.ok(commentsRequest > visibleMetric, '评论请求必须在详情可见后启动');
});

test('fresh plaza cache renders first and delays refresh so images keep the critical bandwidth', () => {
  assert.match(app, /const VIEW_CACHE_TTL_MS = 60_000/);
  assert.match(app, /setTimeout\(\(\) => \{ void refresh\(\); \}, 3200\)/);
  assert.doesNotMatch(app, /cacheIsFresh\(cached\)\) queueMicrotask\(\(\) => \{ void refresh\(\); \}\)/);
  assert.match(plazaPageTemplate, /setTimeout\(\(\) => \{ void refresh\(\); \}, 3200\)/);
});

test('student bootstrap preloads four responsive plaza covers and the plaza reuses that response', () => {
  assert.match(bootstrap, /PLAZA_PERFORMANCE_QUALITY_V3/);
  assert.match(bootstrap, /__BOOTSTRAP_PLAZA_PROMISE__/);
  assert.match(bootstrap, /__BOOTSTRAP_PLAZA_IMAGES__/);
  assert.match(bootstrap, /slice\(0, 4\)/);
  assert.match(bootstrap, /preload\.fetchPriority = index < 2 \? 'high' : 'auto'/);
  assert.match(bootstrap, /preload\.srcset/);
  assert.match(bootstrap, /2048w/);
  assert.doesNotMatch(bootstrap, /__BOOTSTRAP_PLAZA_IMAGE__ = preload/);
  assert.match(app, /const bootstrapResult = safeSort === 'latest' && page === 1 && !safeQuery/);
  assert.match(app, /window\.__BOOTSTRAP_PLAZA_PROMISE__/);
  assert.match(app, /const result = bootstrapResult \|\| await api\(path\)/);
  assert.match(plazaPageTemplate, /window\.__BOOTSTRAP_PLAZA_PROMISE__/);
});

test('detail counts combine liked state into the existing aggregate query', () => {
  assert.match(plazaRoute, /PLAZA_DETAIL_INSTANT_OPEN_V2/);
  assert.match(plazaRoute, /EXISTS\(SELECT 1 FROM plaza_likes WHERE post_id=\?1 AND user_id=\?2\) AS liked/);
  assert.match(plazaRoute, /liked: Boolean\(counts\.liked\)/);
  assert.doesNotMatch(plazaRoute, /const \[members, images, counts, liked\]/);
  assert.doesNotMatch(plazaRoute, /SELECT 1 AS liked FROM plaza_likes WHERE post_id=\?1 AND user_id=\?2/);
});

test('plaza performance generators remain idempotent across runtime, templates and converged tests', () => {
  const targets = [
    'public/app.js',
    'public/bootstrap.js',
    'templates/plaza-mobile-page.txt',
    'cloudflare/routes/plaza.js',
    'test/stage-e-ui-cache-navigation.test.js',
    'test/approved-mobile-experience.test.js'
  ];
  const before = new Map(targets.map(target => [target, read(target)]));

  runGenerator('scripts/apply-plaza-detail-fast-path.mjs');
  runGenerator('scripts/apply-plaza-mobile-layout.mjs');
  runGenerator('scripts/finalize-plaza-performance-quality-v3.mjs');

  for (const target of targets) {
    assert.equal(read(target), before.get(target), `${target} 在重复生成后发生变化`);
  }
});