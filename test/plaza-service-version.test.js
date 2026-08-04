import assert from 'node:assert/strict';
import test from 'node:test';

import plazaWorker from '../cloudflare/plaza-worker.js';

test('独立广场服务响应包含固定协议版本和构建标识', async () => {
  const response = await plazaWorker.fetch(
    new Request('https://internal.test/api/plaza'),
    {},
    { waitUntil() {} }
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-jinshan-service'), 'plaza');
  assert.equal(response.headers.get('x-jinshan-service-version'), 'plaza-v1');
  assert.equal(response.headers.get('x-jinshan-service-build'), '20260804-plaza1');
});
