const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

test('登录首页V2交接仅作为短时同用户加速，原session网络链路必须保留', () => {
  const compat = fs.readFileSync('scripts/apply-track-admin-settings-compat.mjs', 'utf8');
  const generator = fs.readFileSync('scripts/apply-login-bootstrap-handoff-v2.mjs', 'utf8');
  const worker = fs.readFileSync('cloudflare/worker.js', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const entrance = fs.readFileSync('public/entrance.js', 'utf8');
  const entranceHtml = fs.readFileSync('public/entrance.html', 'utf8');

  // The production-breaking V1 generator remains disabled.
  assert.doesNotMatch(compat, /apply-login-bootstrap-handoff(?:\.mjs)?/);
  assert.doesNotMatch(generator, /LOGIN_BOOTSTRAP_HANDOFF_V1/);

  // Server-side login keeps normal token/cookie semantics and only adds an optional snapshot.
  assert.match(worker, /LOGIN_BOOTSTRAP_HANDOFF_V2/);
  assert.match(worker, /buildStudentDashboard\(env, user\)\.catch\(\(\) => null\)/);
  assert.match(worker, /const \[token, dashboard\] = await Promise\.all/);
  assert.match(worker, /'set-cookie': `session_token=/);
  assert.match(worker, /bootstrap\n  \}, 200, \{/);

  // Client only consumes a recent same-user snapshot and always retains /api/session fallback.
  assert.match(entrance, /jinshan20\.loginBootstrap\.v2/);
  assert.match(bootstrap, /LOGIN_BOOTSTRAP_HANDOFF_V2/);
  assert.match(bootstrap, /consumeLoginBootstrapV2/);
  assert.match(bootstrap, /age > 10_000/);
  assert.match(bootstrap, /stored\.userId !== cachedUser\?\.id/);
  assert.match(bootstrap, /session\.user\?\.id !== stored\.userId/);
  assert.match(bootstrap, /if \(!session\) \{[\s\S]*fetch\('\/api\/session'/);
  assert.match(bootstrap, /source: 'login-handoff-v2'/);

  // Login page may warm immutable next-navigation assets but must not execute the main app there.
  assert.match(entranceHtml, /LOGIN_HOME_PREFETCH_V2/);
  assert.match(entranceHtml, /rel="prefetch"/);
  assert.doesNotMatch(entranceHtml, /<script[^>]+(?:bootstrap|app)\.js/);

  execFileSync(process.execPath, ['--check', 'cloudflare/worker.js']);
  execFileSync(process.execPath, ['--check', 'public/bootstrap.js']);
  execFileSync(process.execPath, ['--check', 'public/entrance.js']);
});
