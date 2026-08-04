import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));

const bindingFor = (config, name) => (config.services || []).find((item) => item.binding === name);

test('production Pages routes plaza traffic to the deployed production Worker', () => {
  const config = readJson('cloudflare/pages-production/wrangler.jsonc');
  assert.deepEqual(bindingFor(config, 'PLAZA_SERVICE'), {
    binding: 'PLAZA_SERVICE',
    service: 'jinshan20-plaza'
  });
});

test('test Pages routes plaza traffic only to the isolated test Worker', () => {
  const config = readJson('cloudflare/pages-test/wrangler.jsonc');
  assert.deepEqual(bindingFor(config, 'PLAZA_SERVICE'), {
    binding: 'PLAZA_SERVICE',
    service: 'jinshan20-plaza-test'
  });
});

test('main Worker keeps safe fallback behavior around the optional service binding', () => {
  const source = fs.readFileSync('cloudflare/worker.js', 'utf8');
  assert.match(source, /if \(!env\.PLAZA_SERVICE \|\| !isPlazaServiceRoute\(url\.pathname\)\) return null;/);
  assert.match(source, /return await env\.PLAZA_SERVICE\.fetch\(serviceRequest\);/);
  assert.match(source, /request\.method === 'GET' \|\| request\.method === 'HEAD'/);
  assert.match(source, /活动广场服务暂时不可用，请稍后重试/);
});
