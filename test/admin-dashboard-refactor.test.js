const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const read = (path) => fs.readFileSync(path, 'utf8');

test('admin dashboard patch is idempotent and removes retired admin entry points', () => {
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const first = read('public/app.js');
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const second = read('public/app.js');
  assert.equal(second, first);

  assert.match(first, /ADMIN_DASHBOARD_REFACTOR_V1/);
  assert.match(first, /STUDENT_ADMIN_FLOW_V2/);
  assert.doesNotMatch(first, /async function legacyAdmin\(/);
  assert.doesNotMatch(first, /id="legacyAdminTools"/);
  assert.doesNotMatch(first, /id="ranking"/);
  assert.doesNotMatch(first, /function rankingTable\(/);
  assert.doesNotMatch(first, /async function rankings\(/);

  const start = first.indexOf('/* ADMIN_DASHBOARD_REFACTOR_V1 */');
  const end = first.indexOf('function enhanceAdminSections()', start);
  assert.ok(start >= 0 && end > start);
  const compact = first.slice(start, end);

  assert.match(compact, /健康自律赛道/);
  assert.match(compact, /四校区赛道/);
  assert.match(compact, /data-track-filter="health"/);
  assert.match(compact, /data-track-filter="interaction"/);
  assert.match(compact, /track=\$\{adminDashboardState\.userTrack\}/);
  assert.match(compact, /队伍管理/);
  assert.match(compact, /用户管理/);
  assert.match(compact, /活动广场管理/);
  assert.match(compact, /评论管理/);
  assert.doesNotMatch(compact, /高级工具/);
  assert.doesNotMatch(compact, /api\/admin\/overview/);
  assert.doesNotMatch(compact, /api\/admin\/material-tasks/);
  assert.match(compact, /admin-post-tile/);
  assert.match(compact, /refreshCompactPlazaPanel/);
  assert.match(compact, /refreshCompactTeamPanel/);
});

test('bootstrap loads the updated assets with the flow cache key', () => {
  const bootstrap = read('public/bootstrap.js');
  assert.match(bootstrap, /admin-dashboard-refactor\.css/);
  assert.match(bootstrap, /20260730-flow2/);
});

test('compact dashboard stylesheet includes mobile card layouts', () => {
  const css = read('public/admin-dashboard-refactor.css');
  assert.match(css, /admin-accordion-trigger/);
  assert.match(css, /admin-post-grid/);
  assert.match(css, /student-shortcuts-compact/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
