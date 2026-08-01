import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('活动广场使用小红书式紧凑双列密度', () => {
  const css = read('templates/plaza-mobile-style.css');
  assert.match(css, /padding:\s*0 6px 24px/);
  assert.match(css, /min-height:\s*48px/);
  assert.match(css, /column-gap:\s*4px/);
  assert.match(css, /\.plaza-column\s*\{[\s\S]*?gap:\s*10px/);
  assert.match(css, /\.plaza-channel-tabs button\s*\{[\s\S]*?font-size:\s*13px/);
});

test('卡片只突出文案并压缩作者信息区', () => {
  const css = read('templates/plaza-mobile-style.css');
  assert.match(css, /\.plaza-body h2\s*\{\s*display:\s*none/);
  assert.match(css, /\.plaza-card-copy\s*\{[\s\S]*?font-size:\s*13px/);
  assert.match(css, /grid-template-columns:\s*18px minmax\(0,1fr\) auto/);
  assert.match(css, /\.plaza-card-meta\s*\{[\s\S]*?font-size:\s*11px/);
  assert.match(css, /\.plaza-avatar\s*\{[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px/);
});

test('超长封面仅在信息流裁切且详情打开逻辑保留', () => {
  const css = read('templates/plaza-mobile-style.css');
  const page = read('templates/plaza-mobile-page.txt');
  assert.match(css, /max-height:\s*calc\(\(100vw - 16px\) \* \.6667\)/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(page, /openPlazaPost\(card\.dataset\.post/);
  assert.doesNotMatch(css, /display:\s*none[^}]*\.plaza-card-cover/);
});
