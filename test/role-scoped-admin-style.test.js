import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (path) => fs.readFileSync(path, 'utf8');

test('管理员样式生成器可重复执行且仅管理员加载', () => {
  execFileSync(process.execPath, ['scripts/apply-role-scoped-admin-style.mjs'], { stdio: 'pipe' });
  const first = read('public/bootstrap.js');
  execFileSync(process.execPath, ['scripts/apply-role-scoped-admin-style.mjs'], { stdio: 'pipe' });
  const second = read('public/bootstrap.js');
  assert.equal(second, first);

  assert.match(first, /ROLE_SCOPED_ADMIN_STYLE_V1/);
  assert.match(first, /if \(window\.__BOOTSTRAP_USER__\?\.role === 'admin'\) \{/);
  assert.match(first, /loadStylesheet\('\/admin-dashboard-refactor\.css\?v=[^']+'\)/);
  assert.match(first, /loadStylesheet\('\/style\.css\?v=[^']+'\)/);

  const adminGuardStart = first.indexOf("if (window.__BOOTSTRAP_USER__?.role === 'admin') {");
  const adminGuardEnd = first.indexOf('\n      }', adminGuardStart);
  assert.ok(adminGuardStart >= 0 && adminGuardEnd > adminGuardStart);
  const adminGuard = first.slice(adminGuardStart, adminGuardEnd);
  assert.match(adminGuard, /admin-dashboard-refactor\.css/);

  const outsideAdminGuard = `${first.slice(0, adminGuardStart)}${first.slice(adminGuardEnd + 8)}`;
  assert.doesNotMatch(outsideAdminGuard, /loadStylesheet\('\/admin-dashboard-refactor\.css/);
});

test('管理员样式与主应用使用相同构建版本', () => {
  execFileSync(process.execPath, ['scripts/apply-build-asset-version.mjs'], { stdio: 'pipe' });
  const bootstrap = read('public/bootstrap.js');
  const appVersion = bootstrap.match(/loadScript\('\/app\.js\?v=([^']+)'\)/)?.[1];
  const adminStyleVersion = bootstrap.match(/admin-dashboard-refactor\.css\?v=([^']+)/)?.[1];
  assert.ok(appVersion);
  assert.ok(adminStyleVersion);
  assert.equal(adminStyleVersion, appVersion);
});

test('正式生成链包含管理员样式按角色加载步骤', () => {
  const approved = read('scripts/apply-approved-plaza-prefetch.mjs');
  const roleScoped = approved.indexOf("await import('./apply-role-scoped-admin-style.mjs')");
  const assetVersion = approved.indexOf("await import('./apply-build-asset-version.mjs')");
  assert.ok(roleScoped >= 0);
  assert.ok(assetVersion > roleScoped);
});
