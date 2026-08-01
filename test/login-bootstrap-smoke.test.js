const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

test('登录与首页启动脚本保持原网络会话链路且语法有效', () => {
  const compat = fs.readFileSync('scripts/apply-track-admin-settings-compat.mjs', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const entrance = fs.readFileSync('public/entrance.js', 'utf8');
  assert.doesNotMatch(compat, /apply-login-bootstrap-handoff/);
  assert.doesNotMatch(bootstrap, /consumeLoginBootstrap|jinshan20\.loginBootstrap/);
  assert.doesNotMatch(entrance, /jinshan20\.loginBootstrap/);
  assert.match(bootstrap, /fetch\('\/api\/session'/);
  execFileSync(process.execPath, ['--check', 'public/bootstrap.js']);
  execFileSync(process.execPath, ['--check', 'public/entrance.js']);
});
