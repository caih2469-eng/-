import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (path) => fs.readFileSync(path, 'utf8');

test('管理端模块生成器可重复执行且语法有效', () => {
  execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs'], { stdio: 'pipe' });
  const first = {
    app: read('public/app.js'),
    admin: read('public/admin-client.js'),
    headers: read('public/_headers')
  };
  execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs'], { stdio: 'pipe' });
  const second = {
    app: read('public/app.js'),
    admin: read('public/admin-client.js'),
    headers: read('public/_headers')
  };
  assert.deepEqual(second, first);
  execFileSync(process.execPath, ['--check', 'public/app.js'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', 'public/admin-client.js'], { stdio: 'pipe' });
});

test('学生主包不再包含管理后台主体', () => {
  const app = read('public/app.js');
  assert.match(app, /\/\* LAZY_ADMIN_CLIENT_MODULE_V1 \*\//);
  assert.match(app, /return loadAdminClient\(undefined, pageEpoch\)/);
  assert.match(app, /user\?\.role !== 'admin'/);
  assert.match(app, /new URL\('\/admin-client\.js', location\.origin\)/);
  assert.match(app, /moduleUrl\.searchParams\.set\('v', version\)/);
  assert.doesNotMatch(app, /async function adminComments\(/);
  assert.doesNotMatch(app, /async function admin\(/);
  assert.doesNotMatch(app, /function openAdminUserDrawer\(/);
});

test('独立管理端模块完整保留后台功能', () => {
  const admin = read('public/admin-client.js');
  assert.match(admin, /\/\* ADMIN_CLIENT_MODULE_V1 \*\//);
  assert.match(admin, /async function adminComments\(/);
  assert.match(admin, /async function admin\(/);
  assert.match(admin, /function openAdminUserDrawer\(/);
  assert.match(admin, /function taskFormFields\(/);
  assert.match(admin, /function reviewSubmission\(/);
  assert.match(admin, /window\.__ADMIN_CLIENT_ENTRY__/);
  assert.doesNotMatch(admin, /if \(window\.__BOOTSTRAP_AUTHENTICATED__\)/);
});

test('管理端模块使用版本化长期缓存且加载失败可重试', () => {
  const app = read('public/app.js');
  const headers = read('public/_headers');
  assert.match(headers, /\/admin-client\.js\s+Cache-Control: public, max-age=31536000, immutable/s);
  assert.match(app, /script\.dataset\.adminClientModule = 'true'/);
  assert.match(app, /script\.onerror = \(\) => \{ script\.remove\(\)/);
  assert.match(app, /adminClientModulePromise = null/);
  assert.match(app, /id=\\"retryAdminClient\\"/);
});
