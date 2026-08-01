import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('活动广场布局调试通过显式参数开启并跨登录保存在当前浏览器', () => {
  const page = read('templates/plaza-mobile-page.txt');
  const bootstrap = read('public/bootstrap.js');
  assert.match(page, /layoutDebug/);
  assert.match(page, /PLAZA_LAYOUT_TUNER_KEY = 'plazaLayoutTunerV1'/);
  assert.match(page, /localStorage\.setItem\(PLAZA_LAYOUT_TUNER_KEY/);
  assert.match(page, /localStorage\.removeItem\(PLAZA_LAYOUT_TUNER_KEY/);
  assert.match(bootstrap, /plazaLayoutDebugEnabled/);
  assert.match(bootstrap, /url\.searchParams\.get\('layoutDebug'\)/);
  assert.match(bootstrap, /localStorage\.setItem\('plazaLayoutDebugEnabled', '1'\)/);
  assert.match(bootstrap, /history\.replaceState/);
  assert.match(bootstrap, /plaza-layout-card-tuner\.js\?v=20260730-flow2/);
  assert.doesNotMatch(page + bootstrap, /api\([^)]*layout|fetch\([^)]*layout|\/api\/.*layout/i);
});

test('布局调试面板覆盖活动广场主要视觉参数并支持复制配置', () => {
  const page = read('templates/plaza-mobile-page.txt');
  const css = read('templates/plaza-mobile-style.css');
  for (const key of [
    'sidePadding', 'columnGap', 'cardGap', 'navHeight', 'activeTabFontSize',
    'underlineWidth', 'underlineHeight', 'imageRadius', 'coverMinRatio',
    'coverMaxRatio', 'titleFontSize', 'titleLineHeight', 'titleWeight',
    'titlePadding', 'titleTopGap', 'authorHeight', 'avatarSize',
    'authorFontSize', 'likeIconSize'
  ]) assert.match(page, new RegExp(`key: '${key}'`));
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /data-layout-copy/);
  assert.match(page, /data-layout-reset/);
  assert.match(page, /installPlazaLayoutTuner\(\)/);
  assert.match(css, /\.plaza-layout-tuner-button/);
  assert.match(css, /\.plaza-layout-tuner\s*\{/);
  assert.match(css, /var\(--plaza-side-padding, 5px\)/);
  assert.match(css, /var\(--plaza-column-gap, 5px\)/);
  assert.match(css, /var\(--plaza-title-font-size, 15px\)/);
  assert.match(css, /var\(--plaza-avatar-size, 20px\)/);
});

test('调试后的图片比例仍受最小和最大宽高比约束并触发重新排布', () => {
  const page = read('templates/plaza-mobile-page.txt');
  assert.match(page, /--plaza-cover-min-ratio/);
  assert.match(page, /--plaza-cover-max-ratio/);
  assert.match(page, /Math\.min\(maxRatio, Math\.max\(minRatio, naturalRatio\)\)/);
  assert.match(page, /document\.querySelectorAll\('\.plaza-card-cover img'\)/);
  assert.match(page, /rebalancePlazaColumns\(\)/);
});

test('每个广场作品可独立调整卡片和图片宽高缩放及裁切位置', () => {
  const tuner = read('public/plaza-layout-card-tuner.js');
  assert.match(tuner, /CARD_KEY = 'plazaLayoutCardOverridesV2'/);
  assert.match(tuner, /key: 'cardWidthPercent'/);
  assert.match(tuner, /key: 'frameWidthPercent'/);
  assert.match(tuner, /key: 'heightPx'/);
  assert.match(tuner, /key: 'scalePercent'/);
  assert.match(tuner, /key: 'objectX'/);
  assert.match(tuner, /key: 'objectY'/);
  assert.match(tuner, /overrides\[selectedPostId\]/);
  assert.match(tuner, /card\.style\.width = `\$\{value\.cardWidthPercent\}%`/);
  assert.match(tuner, /shell\.style\.width = `\$\{value\.frameWidthPercent\}%`/);
  assert.match(tuner, /shell\.style\.height = `\$\{value\.heightPx\}px`/);
  assert.match(tuner, /image\.style\.transform = `scale\(\$\{value\.scalePercent \/ 100\}\)`/);
  assert.match(tuner, /image\.style\.objectPosition = `\$\{value\.objectX\}% \$\{value\.objectY\}%`/);
  assert.match(tuner, /data-card-pick/);
  assert.match(tuner, /data-card-reset/);
  assert.match(tuner, /data-card-copy-all/);
  assert.match(tuner, /event\.stopImmediatePropagation\(\)/);
  assert.match(tuner, /restoreAutomaticHeight/);
  assert.match(tuner, /rebalanceColumns/);
  assert.doesNotMatch(tuner, /new MutationObserver/);
});
