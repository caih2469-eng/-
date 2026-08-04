import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

test('administrator JavaScript is absent from the student bundle and loaded once on demand', () => {
  execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs'], { stdio: 'pipe' });
  const app = fs.readFileSync('public/app.js', 'utf8');
  const admin = fs.readFileSync('public/admin-client.js', 'utf8');
  assert.match(app, /ADMIN_CLIENT_LAZY_LOADER_V1/);
  assert.match(app, /user\?\.role !== 'admin'/);
  assert.match(app, /adminClientModulePromise/);
  assert.match(app, /retryAdminClient/);
  assert.doesNotMatch(app, /async function adminComments\(/);
  assert.match(admin, /ADMIN_CLIENT_LAZY_CLIENT_V1/);
  assert.match(admin, /async function adminComments\(/);
  assert.match(admin, /async function admin\(/);
});
