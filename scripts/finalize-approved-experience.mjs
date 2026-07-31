import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_MOBILE_EXPERIENCE_FINALIZED_V1 */';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!/\breadConfig\b/.test(next.slice(0, next.indexOf("from '../lib/runtime.js'")))) {
      next = next.replace('  nowIso,\n  readJson,', '  nowIso,\n  readConfig,\n  readJson,');
    }
    next = next.replace(/const THUMB_MAX_EDGE = (?:360|540|640);/, 'const THUMB_MAX_EDGE = 640;');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/lib/runtime.js');
  if (!source.includes(marker)) {
    let next = source;
    next = next.replace('    checkinSettings: {\n      enabled:', '    checkinSettings: {\n      configured: Boolean(values.checkinSettings),\n      enabled:');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(marker)) {
    let next = source;
    next = next.replace(
      "  const settings = config?.checkinSettings || {};\n  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};",
      "  const settings = config?.checkinSettings || {};\n  if (!settings.configured) {\n    return { ...task, memberImageLimit: Math.min(8, Math.max(1, Number(task.imageLimit || 3))) };\n  }\n  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};"
    );
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    const next = marker + '\n' + source
      .replaceAll('正在生成540px WebP缩略图', '正在生成640px WebP缩略图')
      .replaceAll('生成540px WebP缩略图', '生成640px WebP缩略图')
      .replace(/const MEDIA_THUMB_MAX_EDGE = (?:360|540|640);/, 'const MEDIA_THUMB_MAX_EDGE = 640;');
    write(file, next);
  }
}

for (const relativePath of ['test/member-checkin-fast.test.js', 'test/mobile-admin-photo-fix.test.js']) {
  const { file, source } = read(relativePath);
  const next = source
    .replaceAll('540px WebP缩略图', '640px WebP缩略图')
    .replaceAll('最长边540px', '最长边640px')
    .replace(/MEDIA_THUMB_MAX_EDGE = (?:360|540|640)/g, 'MEDIA_THUMB_MAX_EDGE = 640')
    .replace(/THUMB_MAX_EDGE = (?:360|540|640)/g, 'THUMB_MAX_EDGE = 640');
  if (next !== source) write(file, next);
}

console.log('Finalized approved 640px media imports, labels, tests and check-in settings compatibility.');
await import('./prepare-approved-layout-team-draft-720-v2.mjs');
await import('./apply-approved-layout-team-draft-720-v2.mjs');

const target720TestFiles = [
  'test/member-checkin-fast.test.js',
  'test/mobile-admin-photo-fix.test.js',
  'test/approved-mobile-experience.test.js',
  'test/production-media-login-performance.test.js'
];

for (const relativePath of target720TestFiles) {
  const { file, source } = read(relativePath);
  const next = source
    .replaceAll('正在生成540px WebP缩略图', '正在生成720px WebP缩略图')
    .replaceAll('正在生成640px WebP缩略图', '正在生成720px WebP缩略图')
    .replaceAll('生成540px WebP缩略图', '生成720px WebP缩略图')
    .replaceAll('生成640px WebP缩略图', '生成720px WebP缩略图')
    .replaceAll('最长边540px', '最长边720px')
    .replaceAll('最长边640px', '最长边720px')
    .replace(/MEDIA_THUMB_MAX_EDGE = (?:360|540|640|720)/g, 'MEDIA_THUMB_MAX_EDGE = 720')
    .replace(/MEDIA_THUMB_QUALITY = 0\.(?:72|82|84)/g, 'MEDIA_THUMB_QUALITY = 0.84')
    .replace(/(^|[^A-Z_])THUMB_MAX_EDGE = (?:360|540|640|720)/gm, '$1THUMB_MAX_EDGE = 720')
    .replaceAll('width="640" height="480"', 'width="720" height="540"')
    .replaceAll('thumbs-640-v1', 'thumbs-720-v1')
    .replaceAll('encode\\(640, 84\\)', 'encode\\(720, 84\\)');
  if (next !== source) write(file, next);
}

console.log('Aligned legacy media assertions with the approved 720px target while preserving the separate 640px plaza pipeline.');
