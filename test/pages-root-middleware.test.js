const test = require('node:test');
const assert = require('node:assert/strict');

const middlewareFiles = [
  '../cloudflare/pages-test/functions/_middleware.js',
  '../cloudflare/pages-production/functions/_middleware.js'
];

for (const file of middlewareFiles) {
  test(`${file} 以308规范化重复斜杠并保留查询参数`, async () => {
    const { onRequest, normalizePagesPathname } = await import(file);
    assert.equal(normalizePagesPathname('//api///tasks'), '/api/tasks');
    let nextCalls = 0;
    const response = await onRequest({
      request: new Request('https://jinshan20-test.pages.dev//api///tasks?page=2&sort=latest'),
      next() {
        nextCalls += 1;
        return new Response('next');
      }
    });
    assert.equal(response.status, 308);
    assert.equal(
      response.headers.get('location'),
      'https://jinshan20-test.pages.dev/api/tasks?page=2&sort=latest'
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(nextCalls, 0);
  });

  test(`${file} 不产生开放重定向且正常路径继续执行`, async () => {
    const { onRequest } = await import(file);
    const malicious = await onRequest({
      request: new Request('https://jinshan20-test.pages.dev//evil.example/path?next=1'),
      next() {
        throw new Error('重复斜杠不得继续执行');
      }
    });
    const target = new URL(malicious.headers.get('location'));
    assert.equal(target.origin, 'https://jinshan20-test.pages.dev');
    assert.equal(target.pathname, '/evil.example/path');
    assert.equal(target.search, '?next=1');

    let nextCalls = 0;
    const passthrough = await onRequest({
      request: new Request('https://jinshan20-test.pages.dev/api/tasks?page=1'),
      next() {
        nextCalls += 1;
        return new Response(null, { status: 204 });
      }
    });
    assert.equal(passthrough.status, 204);
    assert.equal(nextCalls, 1);
  });
}
