import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('.github/workflows/plaza-binding-smoke.yml', 'utf8');

test('production binding smoke runs only after the main Cloudflare workflow', () => {
  assert.match(source, /workflow_run:/);
  assert.match(source, /Cloudflare validation and deployment/);
  assert.match(source, /branches:\s*\n\s*- main/);
  assert.match(source, /workflow_run\.event == 'push'/);
  assert.match(source, /workflow_run\.head_branch == 'main'/);
});

test('production binding smoke verifies the deployed plaza service contract', () => {
  assert.match(source, /jinshan20\.pages\.dev\/api\/rankings\?period=day/);
  assert.match(source, /x-jinshan-service:\[\[:space:\]\]\*plaza/);
  assert.match(source, /x-jinshan-service-version:\[\[:space:\]\]\*plaza-v1/);
  assert.match(source, /workflow_run\.conclusion/);
  assert.doesNotMatch(source, /continue-on-error|\|\| true/);
});

test('production binding smoke publishes a readable commit status', () => {
  assert.match(source, /statuses: write/);
  assert.match(source, /plaza-binding\/production-smoke/);
  assert.match(source, /workflow_run\.head_sha/);
  assert.match(source, /state='success'/);
  assert.match(source, /state='failure'/);
});
