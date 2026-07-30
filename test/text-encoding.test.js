const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('仓库文本均为UTF-8且主要页面、管理页面和错误提示不含乱码替换串', async () => {
  const { auditTextFiles } = await import('../scripts/audit-text-encoding.mjs');
  const report = await auditTextFiles(path.resolve('.'));
  assert.ok(report.filesScanned > 0);
  assert.deepEqual(report.violations, []);
});
