import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('布局调试入口在登录跳转后通过本机开关继续生效', () => {
  const index = read('public/index.html');
  const tuner = read('public/plaza-layout-tuner-v3.js');
  assert.match(index, /plaza-layout-tuner-v3\.js\?v=20260801-1/);
  assert.match(tuner, /plazaLayoutDebugEnabledV3/);
  assert.match(tuner, /params\.get\('layoutDebug'\) === '1'/);
  assert.match(tuner, /localStorage\.setItem\(DEBUG_KEY, '1'\)/);
  assert.match(tuner, /localStorage\.getItem\(DEBUG_KEY\) === '1'/);
  assert.match(tuner, /localStorage\.removeItem\(DEBUG_KEY\)/);
});

test('每张广场卡片可以独立设置宽高缩放和裁切位置', () => {
  const tuner = read('public/plaza-layout-tuner-v3.js');
  assert.match(tuner, /plazaLayoutCardOverridesV3/);
  assert.match(tuner, /key: 'cardWidth'/);
  assert.match(tuner, /key: 'coverWidth'/);
  assert.match(tuner, /key: 'coverHeight'/);
  assert.match(tuner, /key: 'imageScale'/);
  assert.match(tuner, /key: 'positionX'/);
  assert.match(tuner, /key: 'positionY'/);
  assert.match(tuner, /cardConfigs\[postId\]/);
  assert.match(tuner, /card\.style\.width = `\$\{config\.cardWidth\}%`/);
  assert.match(tuner, /cover\.style\.height = `\$\{config\.coverHeight\}px`/);
  assert.match(tuner, /image\.style\.transform = `scale\(\$\{config\.imageScale \/ 100\}\)`/);
  assert.match(tuner, /image\.style\.objectPosition = `\$\{config\.positionX\}% \$\{config\.positionY\}%`/);
});

test('单张选择模式拦截详情打开并按帖子编号保存', () => {
  const tuner = read('public/plaza-layout-tuner-v3.js');
  assert.match(tuner, /selectionMode = true/);
  assert.match(tuner, /closest\?\.\('\.plaza-card\[data-post\]'\)/);
  assert.match(tuner, /event\.stopImmediatePropagation\(\)/);
  assert.match(tuner, /selectedPostId = card\.dataset\.post/);
  assert.match(tuner, /cardConfigs\[selectedPostId\] = normalize/);
  assert.match(tuner, /writeJson\(CARD_KEY, cardConfigs\)/);
  assert.match(tuner, /data-tuner-tab="card"/);
});

test('恢复自动高度会重新计算原图比例且调试器不会因重排循环安装', () => {
  const tuner = read('public/plaza-layout-tuner-v3.js');
  assert.match(tuner, /restoreNaturalCover/);
  assert.match(tuner, /Math\.min\(4 \/ 3, Math\.max\(3 \/ 4, ratio\)\)/);
  assert.match(tuner, /cover\.style\.aspectRatio = String\(naturalRatio\(image\)\)/);
  assert.match(tuner, /installQueued/);
  assert.match(tuner, /requestAnimationFrame\(\(\) => \{\s*installQueued = false;\s*install\(\)/);
  assert.match(tuner, /applyCards\(false\)/);
});
