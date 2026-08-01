import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const commentMode = read('public/plaza-comment-mode.js');
const bootstrap = read('public/bootstrap.js');
const pipeline = read('templates/pica-image-pipeline-runtime.txt');

test('Beav评论呈现脚本与主应用使用同一缓存版本', () => {
  const appVersion = bootstrap.match(/await loadScript\('\/app\.js\?v=([^']+)'\)/)?.[1];
  const commentVersion = bootstrap.match(/await loadScript\('\/plaza-comment-mode\.js\?v=([^']+)'\)/)?.[1];
  assert.ok(appVersion);
  assert.ok(commentVersion);
  assert.equal(commentVersion, appVersion);
});

test('评论模式保留现有发布删除和加载更多选择器', () => {
  assert.match(commentMode, /PANEL_SELECTOR = '\.plaza-detail \.comments-panel'/);
  assert.match(commentMode, /#commentForm/);
  assert.match(commentMode, /textarea\[name="content"\]/);
  assert.match(commentMode, /\.delete-comment/);
  assert.match(commentMode, /#moreComments/);
  assert.match(commentMode, /#commentCount/);
});

test('评论模式采用作者正文时间与底部发送栏且不触碰业务接口', () => {
  assert.match(commentMode, /Jamailar\/Beav/);
  assert.match(commentMode, /beav-comment-avatar/);
  assert.match(commentMode, /beav-comment-author/);
  assert.match(commentMode, /beav-comment-content/);
  assert.match(commentMode, /beav-comment-meta/);
  assert.match(commentMode, /beav-comment-composer/);
  assert.match(commentMode, /position:\s*sticky/);
  assert.doesNotMatch(commentMode, /fetch\(|\/api\/|D1|R2|password|checkin/i);
});

test('评论列表动态新增后会自动适配且不复制评论数据', () => {
  assert.match(commentMode, /new MutationObserver/);
  assert.match(commentMode, /record\.addedNodes/);
  assert.match(commentMode, /item\.replaceChildren\(avatar, main\)/);
  assert.doesNotMatch(commentMode, /localStorage|sessionStorage|indexedDB/);
});

test('当前新上传活动缩略图最长边为960px且不放大小图', () => {
  assert.match(pipeline, /const PICA_THUMB_MAX_EDGE = 960;/);
  assert.match(pipeline, /const PICA_THUMB_MAX_BYTES = 491520;/);
  assert.match(pipeline, /Math\.min\(1, PICA_THUMB_MAX_EDGE \/ Math\.max\(masterCanvas\.width, masterCanvas\.height\)\)/);
  assert.match(pipeline, /suffix: 'thumb'/);
});
