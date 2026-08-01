const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('活动广场卡片只显示文案并采用独立双列最短列布局', () => {
  const page = fs.readFileSync('templates/plaza-mobile-page.txt', 'utf8');
  const style = fs.readFileSync('templates/plaza-mobile-style.css', 'utf8');

  assert.match(page, /const rebalancePlazaColumns = \(\) =>/);
  assert.match(page, /data-plaza-column="0"/);
  assert.match(page, /data-plaza-column="1"/);
  assert.match(page, /getBoundingClientRect\(\)\.height <= columns\[1\]\.getBoundingClientRect\(\)\.height/);
  assert.match(page, /<p class="plaza-card-copy">\$\{escapeHtml\(post\.copy \|\| ''\)\}<\/p>/);
  assert.doesNotMatch(page, /plaza-card-copy">\$\{escapeHtml\(post\.copy \|\| post\.taskName\)/);
  assert.match(page, /requestAnimationFrame\(rebalancePlazaColumns\)/);

  assert.match(style, /body\[data-view="plaza"\] main\s*\{[\s\S]*padding:\s*0 5px 24px;/);
  assert.match(style, /\.plaza-grid\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*5px;[\s\S]*margin:\s*0;/);
  assert.doesNotMatch(style, /\.plaza-grid\s*\{[\s\S]*grid-template-columns/);
  assert.match(style, /\.plaza-column\s*\{[\s\S]*flex:\s*0 0 calc\(\(100vw - 15px\) \/ 2\);[\s\S]*width:\s*calc\(\(100vw - 15px\) \/ 2\);[\s\S]*gap:\s*10px;/);
  assert.match(style, /\.plaza-card\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*#fff;[\s\S]*box-shadow:\s*none;/);
  assert.match(style, /\.plaza-card-copy\s*\{[\s\S]*margin:\s*8px 0 0;[\s\S]*padding:\s*0 10px;[\s\S]*font-size:\s*15px;[\s\S]*line-height:\s*21px;[\s\S]*font-weight:\s*500;/);
  assert.match(style, /\.plaza-card-meta\s*\{[\s\S]*height:\s*34px;[\s\S]*grid-template-columns:\s*20px minmax\(0,1fr\) auto;[\s\S]*font-size:\s*12px;/);
  assert.match(style, /\.plaza-avatar\s*\{[\s\S]*width:\s*20px;[\s\S]*height:\s*20px;/);
  assert.match(style, /\.plaza-like svg\s*\{[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/);
  assert.match(style, /\.plaza-appbar\s*\{[\s\S]*height:\s*50px;/);
  assert.match(style, /\.plaza-channel-tabs button\.active\s*\{[\s\S]*font-size:\s*17px;[\s\S]*font-weight:\s*600;/);
  assert.match(style, /\.plaza-channel-tabs button\.active::after\s*\{[\s\S]*width:\s*22px;[\s\S]*height:\s*3px;[\s\S]*background:\s*#ff2442;/);
});

test('信息流图片比例限制在3比4至4比3且详情链路保持不变', () => {
  const page = fs.readFileSync('templates/plaza-mobile-page.txt', 'utf8');
  const style = fs.readFileSync('templates/plaza-mobile-style.css', 'utf8');

  assert.match(page, /Math\.min\(4 \/ 3, Math\.max\(3 \/ 4, naturalRatio\)\)/);
  assert.match(page, /shell\.style\.aspectRatio = String\(feedRatio\)/);
  assert.match(page, /onload="applyPlazaCoverRatio\(this\)"/);
  assert.match(style, /\.plaza-card-cover img\s*\{[\s\S]*width:\s*100%;[\s\S]*object-fit:\s*cover;/);
  assert.match(page, /openPlazaPost\(card\.dataset\.post/);
});
