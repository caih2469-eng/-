import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const version = '20260730-adminphoto2';

const readRequired = (relative) => {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`${relative}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};

const writeIfChanged = (file, before, after) => {
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
};

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const { file, source } = readRequired('scripts/apply-admin-dashboard-refactor.mjs');
  const next = source.replace(/20260730-(?:flow2|adminphoto1|adminphoto2)/g, version);
  if (!next.includes(version)) throw new Error('后台补丁缓存版本更新失败');
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('public/app.js');
  let next = source;
  if (!next.includes('const photos = images.map((media, imageIndex) => {')) {
    next = replaceOnce(
      next,
      'const photos = images.map((media) => {',
      'const photos = images.map((media, imageIndex) => {',
      '管理员照片索引'
    );
  }

  const prioritizedMarker = "fetchpriority=\"${imageIndex === 0 ? 'high' : 'low'}\"";
  if (!next.includes(prioritizedMarker)) {
    const oldMarkup = [
      '          <span class="image-shell"><img data-src="${escapeHtml(thumbUrl)}" loading="lazy"',
      '            fetchpriority="low" decoding="async" width="540" height="405" alt="打卡照片"'
    ].join('\n');
    const newMarkup = [
      '          <span class="image-shell"><img ${imageIndex === 0 ? `src="${escapeHtml(thumbUrl)}"` : `data-src="${escapeHtml(thumbUrl)}"`} loading="${imageIndex === 0 ? \'eager\' : \'lazy\'}"',
      '            fetchpriority="${imageIndex === 0 ? \'high\' : \'low\'}" decoding="async" width="540" height="405" alt="打卡照片"'
    ].join('\n');
    next = replaceOnce(next, oldMarkup, newMarkup, '首张管理员缩略图优先加载标记');
  }

  if (!next.includes(prioritizedMarker)) {
    throw new Error('首张管理员缩略图优先加载补丁失败');
  }
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('public/bootstrap.js');
  const next = source.replace(/20260730-(?:flow2|adminphoto1|adminphoto2)/g, version);
  if (!next.includes(version)) throw new Error('启动资源缓存版本更新失败');
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('public/index.html');
  const next = source.replace(/\/bootstrap\.js\?v=[a-zA-Z0-9-]+/, `/bootstrap.js?v=${version}`);
  if (!next.includes(`/bootstrap.js?v=${version}`)) throw new Error('首页缓存版本更新失败');
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('public/entrance.html');
  const next = source.replace(/\/entrance\.js\?v=[a-zA-Z0-9-]+/, `/entrance.js?v=${version}`);
  if (!next.includes(`/entrance.js?v=${version}`)) throw new Error('登录入口缓存版本更新失败');
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/admin-dashboard-refactor.test.js');
  const next = source.replace(/20260730-(?:flow2|adminphoto1|adminphoto2)/g, version);
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/stage-g-observability-assets.test.js');
  const next = source.replace(
    /const expectedVersion = '20260730-(?:flow2|adminphoto1|adminphoto2)';/,
    `const expectedVersion = '${version}';`
  );
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/production-media-login-performance.test.js');
  const next = source
    .replace(/MEDIA_THUMB_MAX_EDGE = (?:360|540)/g, 'MEDIA_THUMB_MAX_EDGE = 540')
    .replaceAll('MEDIA_THUMB_QUALITY = 0\\.72', 'MEDIA_THUMB_QUALITY = 0\\.82')
    .replace(/THUMB_MAX_EDGE = (?:360|540)/g, 'THUMB_MAX_EDGE = 540');
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/member-checkin-fast.test.js');
  const replacement = `test('单人打卡展示图使用fast接口并生成540px WebP缩略图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const memberBody = app.match(
    /function memberCheckinForm\\(task\\) \\{([\\s\\S]*?)\\r?\\n\\}\\r?\\n\\r?\\nfunction materialSubmissionForm/
  )?.[1] || '';
  assert.match(memberBody, /uploadMemberCheckinFast/);
  assert.match(memberBody, /uploadCompressedImage/);
  assert.match(memberBody, /variant:\\s*'thumb'/);
  assert.match(memberBody, /parentMediaId:\\s*displayMediaId/);
  assert.match(memberBody, /正在生成540px WebP缩略图/);
  assert.match(memberBody, /const mediaIds = session\\?\\.items/);
  assert.doesNotMatch(memberBody, /readFiles/);
  assert.match(app, /const MEMBER_FAST_MAX_BYTES = 307_200/);
  assert.match(app, /const MEDIA_THUMB_MAX_EDGE = 540/);
  assert.match(app, /const MEDIA_THUMB_QUALITY = 0\\.82/);
  assert.match(app, /\\{ maxWidthOrHeight: 960, initialQuality: 0\\.76, maxSizeMB: 0\\.25 \\}/);
  assert.match(app, /\\{ maxWidthOrHeight: 960, initialQuality: 0\\.70, maxSizeMB: 0\\.30 \\}/);
  assert.match(app, /\\{ maxWidthOrHeight: 800, initialQuality: 0\\.68, maxSizeMB: 0\\.30 \\}/);
  assert.match(app, /图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。/);
});`;
  const pattern = /test\('单人打卡前端只使用fast接口、最多三轮压缩且不生成缩略图',[\s\S]*?\n\}\);/;
  const next = pattern.test(source) ? source.replace(pattern, replacement) : source;
  if (!next.includes("test('单人打卡展示图使用fast接口并生成540px WebP缩略图'")) {
    throw new Error('单人打卡测试标准更新失败');
  }
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/mobile-admin-photo-fix.test.js');
  const anchor = "  assert.doesNotMatch(drawer, /new Image\\(\\)/);";
  const addition = `${anchor}\n  assert.match(drawer, /imageIndex === 0/);\n  assert.match(drawer, /loading=\"\\$\\{imageIndex === 0 \\? 'eager' : 'lazy'\\}\"/);\n  assert.match(drawer, /fetchpriority=\"\\$\\{imageIndex === 0 \\? 'high' : 'low'\\}\"/);`;
  const next = source.includes('assert.match(drawer, /imageIndex === 0/);')
    ? source
    : source.replace(anchor, addition);
  if (!next.includes('assert.match(drawer, /imageIndex === 0/);')) {
    throw new Error('管理员首图优先级测试更新失败');
  }
  writeIfChanged(file, source, next);
}

console.log('Finalized mobile admin photo asset versions, first-thumbnail priority and test expectations.');