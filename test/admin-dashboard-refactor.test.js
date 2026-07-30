const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const read = (path) => fs.readFileSync(path, 'utf8');

test('admin dashboard patch is idempotent and generates the compact dashboard', () => {
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const first = read('public/app.js');
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const second = read('public/app.js');
  assert.equal(second, first);

  assert.match(first, /ADMIN_DASHBOARD_REFACTOR_V1/);
  assert.match(first, /async function legacyAdmin\(/);
  const start = first.indexOf('/* ADMIN_DASHBOARD_REFACTOR_V1 */');
  const end = first.indexOf('function enhanceAdminSections()', start);
  assert.ok(start >= 0 && end > start);
  const compact = first.slice(start, end);

  assert.match(compact, /全部赛道用户/);
  assert.match(compact, /队伍管理/);
  assert.match(compact, /用户管理/);
  assert.match(compact, /活动广场管理/);
  assert.match(compact, /高级工具/);
  assert.doesNotMatch(compact, /api\/admin\/overview/);
  assert.doesNotMatch(compact, /api\/admin\/material-tasks/);
  assert.match(compact, /refreshCompactPlazaPanel/);
  assert.match(compact, /refreshCompactTeamPanel/);
});

test('bootstrap loads the refactor stylesheet with the unified production cache key', () => {
  const bootstrap = read('public/bootstrap.js');
  assert.match(bootstrap, /admin-dashboard-refactor\.css/);
  assert.match(bootstrap, /20260730-plaza640/);
});

test('compact dashboard stylesheet includes mobile layout rules', () => {
  const css = read('public/admin-dashboard-refactor.css');
  assert.match(css, /admin-accordion-trigger/);
  assert.match(css, /admin-compact-row/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
