import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const masonry = read('public/plaza-auto-masonry.js');
const bootstrap = read('public/bootstrap.js');
const plazaPage = read('templates/plaza-mobile-page.txt');
const plazaStyle = read('templates/plaza-mobile-style.css');

test('活动广场自动排版脚本与主资源使用同一缓存版本', () => {
  const appVersion = bootstrap.match(/await loadScript\('\/app\.js\?v=([^']+)'\)/)?.[1];
  const masonryVersion = bootstrap.match(/await loadScript\('\/plaza-auto-masonry\.js\?v=([^']+)'\)/)?.[1];
  assert.ok(appVersion);
  assert.ok(masonryVersion);
  assert.equal(masonryVersion, appVersion);
});

test('采用Beav的最短列分配结构并按真实卡片高度校正', () => {
  assert.match(masonry, /Jamailar\/Beav/);
  assert.match(masonry, /estimateMediaCardHeight/);
  assert.match(masonry, /measuredCardHeights:\s*new Map\(\)/);
  assert.match(masonry, /measureCard\(card, state\)/);
  assert.match(masonry, /const columnHeights = Array\.from/);
  assert.match(masonry, /for \(let index = 1; index < columnHeights\.length; index \+= 1\)/);
  assert.match(masonry, /columnHeights\[index\] < columnHeights\[targetColumnIndex\]/);
  assert.match(masonry, /column\.replaceChildren\(\.\.\.masonryColumns\[index\]\)/);
  assert.match(masonry, /verificationPass < 2/);
});

test('图片使用完整自然宽高比而不是统一裁切比例', () => {
  assert.match(masonry, /image\.naturalWidth/);
  assert.match(masonry, /image\.naturalHeight/);
  assert.match(masonry, /const ratio = width \/ height/);
  assert.match(masonry, /'height', 'auto', 'important'/);
  assert.doesNotMatch(masonry, /--plaza-cover-min-ratio|--plaza-cover-max-ratio/);
  assert.doesNotMatch(masonry, /Math\.min\(4 \/ 3, Math\.max\(3 \/ 4/);
});

test('图片加载、卡片变化和视口变化都会触发重新排版', () => {
  assert.match(masonry, /new ResizeObserver/);
  assert.match(masonry, /grid\.addEventListener\('load'/);
  assert.match(masonry, /new MutationObserver/);
  assert.match(masonry, /window\.addEventListener\('resize'/);
  assert.match(masonry, /window\.schedulePlazaMasonryLayout/);
});

test('逐张图片调节功能已完整移除', () => {
  assert.doesNotMatch(bootstrap + plazaPage + plazaStyle, /layoutDebug|plazaLayoutTuner|调布局|单张作品/);
  assert.equal(fs.existsSync('public/plaza-layout-card-tuner.js'), false);
  assert.equal(fs.existsSync('test/plaza-layout-tuner.test.js'), false);
});

test('自动排版只操作活动广场DOM且不接触业务数据', () => {
  assert.match(masonry, /GRID_SELECTOR = '\.plaza-grid'/);
  assert.match(masonry, /CARD_SELECTOR = '\.plaza-card\[data-post\]'/);
  assert.doesNotMatch(masonry, /\/api\/|fetch\(|D1|R2|login|password|checkin/i);
});

test('保留Beav非商业许可证声明', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /Jamailar\/Beav/);
  assert.match(notices, /MIT License – Non-Commercial Use Only/);
  assert.match(notices, /Commercial use of the Software is strictly prohibited/);
});
