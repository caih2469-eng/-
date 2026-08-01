import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const masonry = read('public/plaza-auto-masonry.js');
const bootstrap = read('public/bootstrap.js');

test('活动广场自动排版脚本与主资源使用同一缓存版本', () => {
  assert.match(bootstrap, /await loadScript\('\/plaza-auto-masonry\.js\?v=20260730-flow2'\)/);
  assert.match(bootstrap, /await loadScript\('\/app\.js\?v=20260730-flow2'\)/);
});

test('图片自动排版先估算高度再按真实高度二次校正', () => {
  assert.match(masonry, /estimateCardHeight/);
  assert.match(masonry, /measuredHeights = new Map\(\)/);
  assert.match(masonry, /measureCard\(card, state\)/);
  assert.match(masonry, /const columnHeights = \[0, 0\]/);
  assert.match(masonry, /columnHeights\[1\] < columnHeights\[0\] \? 1 : 0/);
  assert.match(masonry, /column\.replaceChildren\(\.\.\.assignments\[index\]\)/);
  assert.match(masonry, /verificationPass < 2/);
});

test('图片加载和尺寸变化会自动重排并限制展示比例', () => {
  assert.match(masonry, /new ResizeObserver/);
  assert.match(masonry, /grid\.addEventListener\('load'/);
  assert.match(masonry, /image\.naturalWidth/);
  assert.match(masonry, /image\.naturalHeight/);
  assert.match(masonry, /--plaza-cover-min-ratio/);
  assert.match(masonry, /--plaza-cover-max-ratio/);
  assert.match(masonry, /object-fit', 'cover'/);
  assert.match(masonry, /window\.addEventListener\('resize'/);
});

test('自动排版只操作活动广场DOM且保留单张手动覆盖', () => {
  assert.match(masonry, /GRID_SELECTOR = '\.plaza-grid'/);
  assert.match(masonry, /CARD_SELECTOR = '\.plaza-card\[data-post\]'/);
  assert.match(masonry, /cover\.dataset\.individualHeight === 'true'/);
  assert.match(masonry, /window\.schedulePlazaMasonryLayout/);
  assert.doesNotMatch(masonry, /\/api\/|fetch\(|D1|R2|login|password|checkin/i);
});
