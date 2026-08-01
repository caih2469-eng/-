const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('活动广场卡片只显示文案并采用双列高度平衡布局', () => {
  const page = fs.readFileSync('templates/plaza-mobile-page.txt', 'utf8');
  const style = fs.readFileSync('templates/plaza-mobile-style.css', 'utf8');

  assert.match(page, /const rebalancePlazaColumns = \(\) =>/);
  assert.match(page, /data-plaza-column="0"/);
  assert.match(page, /data-plaza-column="1"/);
  assert.match(page, /getBoundingClientRect\(\)\.height <= columns\[1\]\.getBoundingClientRect\(\)\.height/);
  assert.match(page, /<p class="plaza-card-copy">\$\{escapeHtml\(post\.copy \|\| ''\)\}<\/p>/);
  assert.doesNotMatch(page, /plaza-card-copy">\$\{escapeHtml\(post\.copy \|\| post\.taskName\)/);
  assert.match(page, /requestAnimationFrame\(rebalancePlazaColumns\)/);

  assert.match(style, /\.plaza-body h2\s*\{\s*display:\s*none;/);
  assert.match(style, /\.plaza-grid\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(style, /\.plaza-column\s*\{[\s\S]*flex-direction:\s*column;/);
  assert.match(style, /\.plaza-channel-tabs button\s*\{[\s\S]*font-size:\s*14px;/);
  assert.match(style, /\.plaza-card-copy\s*\{[\s\S]*font-size:\s*14px;[\s\S]*font-weight:\s*500;/);
});
