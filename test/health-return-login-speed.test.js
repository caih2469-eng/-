const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const read = (file) => fs.readFileSync(file, 'utf8');

const applyGeneratedFixes = () => {
  execFileSync(process.execPath, ['scripts/apply-health-client-checkin.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/apply-login-bootstrap-handoff.mjs'], { stdio: 'pipe' });
};

test('健康打卡返回时复用原卡片节点，不再闪现普通任务空状态', () => {
  applyGeneratedFixes();
  const generator = read('scripts/apply-health-client-checkin.mjs');
  const patch = read('templates/health-client-return-preserve.txt');
  const app = read('public/app.js');
  assert.match(generator, /health-client-return-preserve\.txt/);
  assert.match(generator, /HEALTH_CLIENT_RETURN_PRESERVE_V2/);
  assert.match(patch, /rememberHealthSection/);
  assert.match(patch, /replacement\.replaceWith\(preserved\)/);
  assert.match(patch, /data-health-client-slot/);
  assert.match(patch, /preservedHealthDate === nextDate/);
  assert.doesNotMatch(patch, /MutationObserver/);
  assert.match(app, /HEALTH_CLIENT_RETURN_PRESERVE_V2/);
  assert.doesNotThrow(() => new Function(patch));
});

test('学生登录复用本次登录生成的首页快照并保留网络回退', () => {
  applyGeneratedFixes();
  const generator = read('scripts/apply-login-bootstrap-handoff.mjs');
  const worker = read('cloudflare/worker.js');
  const entrance = read('public/entrance.js');
  const bootstrap = read('public/bootstrap.js');
  assert.match(generator, /LOGIN_BOOTSTRAP_HANDOFF_V1/);
  assert.match(generator, /buildStudentDashboard/);
  assert.match(worker, /LOGIN_BOOTSTRAP_HANDOFF_V1/);
  assert.match(worker, /bootstrap\s*=\s*\{/);
  assert.match(entrance, /jinshan20\.loginBootstrap/);
  assert.match(entrance, /sessionStorage\.setItem/);
  assert.match(bootstrap, /consumeLoginBootstrap/);
  assert.match(bootstrap, /source:\s*'login-handoff'/);
  assert.match(bootstrap, /fetch\('\/api\/session'/);
  assert.match(bootstrap, /age > 30_000/);
  assert.doesNotMatch(generator, /CREATE TABLE|ALTER TABLE|DROP TABLE/);
  execFileSync(process.execPath, ['--check', 'scripts/apply-login-bootstrap-handoff.mjs']);
  execFileSync(process.execPath, ['--check', 'public/bootstrap.js']);
  execFileSync(process.execPath, ['--check', 'public/entrance.js']);
  execFileSync(process.execPath, ['--check', 'cloudflare/worker.js']);
});
