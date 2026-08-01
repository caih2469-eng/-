import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('活动广场使用5px边距和独立双列瀑布流', () => {
  const css = read('templates/plaza-mobile-style.css');
  assert.match(css, /padding:\s*0 5px 24px/);
  assert.match(css, /height:\s*50px/);
  assert.match(css, /\.plaza-grid\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.plaza-grid\s*\{[\s\S]*?gap:\s*5px/);
  assert.doesNotMatch(css, /\.plaza-grid\s*\{[\s\S]*?grid-template-columns/);
  assert.match(css, /\.plaza-column\s*\{[\s\S]*?calc\(\(100vw - 15px\) \/ 2\)/);
  assert.match(css, /\.plaza-column\s*\{[\s\S]*?gap:\s*10px/);
});

test('卡片文案作者和点赞严格使用指定尺寸', () => {
  const css = read('templates/plaza-mobile-style.css');
  assert.match(css, /\.plaza-body h2\s*\{\s*display:\s*none/);
  assert.match(css, /\.plaza-card-copy\s*\{[\s\S]*?padding:\s*0 10px/);
  assert.match(css, /\.plaza-card-copy\s*\{[\s\S]*?font-size:\s*15px/);
  assert.match(css, /\.plaza-card-copy\s*\{[\s\S]*?line-height:\s*21px/);
  assert.match(css, /\.plaza-card-meta\s*\{[\s\S]*?height:\s*34px/);
  assert.match(css, /grid-template-columns:\s*20px minmax\(0,1fr\) auto/);
  assert.match(css, /\.plaza-card-meta\s*\{[\s\S]*?color:\s*#999/);
  assert.match(css, /\.plaza-card-meta\s*\{[\s\S]*?font-size:\s*12px/);
  assert.match(css, /\.plaza-avatar\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px/);
  assert.match(css, /\.plaza-like svg\s*\{[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px/);
});

test('封面比例限制在3比4至4比3且详情原图链路保留', () => {
  const css = read('templates/plaza-mobile-style.css');
  const page = read('templates/plaza-mobile-page.txt');
  assert.match(page, /Math\.min\(4 \/ 3, Math\.max\(3 \/ 4, naturalRatio\)\)/);
  assert.match(page, /applyPlazaCoverRatio/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(page, /openPlazaPost\(card\.dataset\.post/);
  assert.doesNotMatch(css, /display:\s*none[^}]*\.plaza-card-cover/);
});
