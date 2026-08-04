import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (path) => fs.readFileSync(path, 'utf8');

test('活动广场按需资源生成器可重复执行', () => {
  execFileSync(process.execPath, ['scripts/apply-lazy-plaza-assets.mjs'], { stdio: 'pipe' });
  const first = {
    bootstrap: read('public/bootstrap.js'),
    app: read('public/app.js'),
    template: read('templates/plaza-mobile-page.txt')
  };
  execFileSync(process.execPath, ['scripts/apply-lazy-plaza-assets.mjs'], { stdio: 'pipe' });
  const second = {
    bootstrap: read('public/bootstrap.js'),
    app: read('public/app.js'),
    template: read('templates/plaza-mobile-page.txt')
  };
  assert.deepEqual(second, first);
});

test('打卡首屏不再启动广场专用脚本和全局观察器', () => {
  const bootstrap = read('public/bootstrap.js');
  assert.match(bootstrap, /\/\* LAZY_PLAZA_BOOTSTRAP_V1 \*\//);
  assert.match(bootstrap, /const featureScriptPromises = new Map\(\)/);
  assert.match(bootstrap, /return Promise\.all\(\[/);
  assert.doesNotMatch(bootstrap, /await loadScript\('\/plaza-auto-masonry\.js/);
  assert.doesNotMatch(bootstrap, /await loadScript\('\/plaza-comment-mode\.js/);
});

test('进入活动广场时并行加载增强脚本且失败不阻断主体', () => {
  const bootstrap = read('public/bootstrap.js');
  const app = read('public/app.js');
  assert.match(bootstrap, /loadFeatureScript\('\/plaza-auto-masonry\.js/);
  assert.match(bootstrap, /loadFeatureScript\('\/plaza-comment-mode\.js/);
  assert.match(bootstrap, /\.catch\(\(error\) => \{/);
  assert.match(bootstrap, /return false;/);
  assert.match(app, /\/\* LAZY_PLAZA_ENTRY_V1 \*\//);
  assert.match(app, /void window\.__LOAD_PLAZA_EXTRAS__\?\.\(\)/);
});
