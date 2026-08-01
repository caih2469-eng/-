import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('活动广场密度严格压缩为小红书式双列卡片', () => {
  const css = read('templates/plaza-xhs-density-v2.css');
  assert.match(css, /padding:\s*0 6px 24px/);
  assert.match(css, /column-gap:\s*4px/);
  assert.match(css, /\.plaza-column\s*\{[\s\S]*?gap:\s*10px/);
  assert.match(css, /font-size:\s*13px/);
  assert.match(css, /grid-template-columns:\s*18px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.plaza-body h2\s*\{[\s\S]*?display:\s*none !important/);
});

test('超长图片在发现流中裁切但详情原图链路不受影响', () => {
  const runtime = read('templates/plaza-xhs-density-v2.js');
  assert.match(runtime, /Math\.min\(1\.5, Math\.max\(\.75, naturalRatio\)\)/);
  assert.match(runtime, /data\.perfImage !== 'plaza-thumb'/);
  assert.match(runtime, /shell\.style\.aspectRatio/);
  assert.doesNotMatch(runtime, /fetch\(|\/api\//);
});

test('隔离站覆盖层不写入测试数据库或对象存储', () => {
  const apply = read('scripts/apply-plaza-xhs-density-v2.mjs');
  assert.match(apply, /plaza-xhs-density-v2\.css/);
  assert.match(apply, /plaza-xhs-density-v2\.js/);
  assert.doesNotMatch(apply, /wrangler|d1 execute|r2 object|INSERT INTO|DELETE FROM/);
});
