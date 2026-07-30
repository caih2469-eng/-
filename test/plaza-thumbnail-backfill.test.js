const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('历史广场缩略图脚本只允许测试资源且对象键幂等', async () => {
  const {
    validateSafeTarget,
    thumbnailObjectKey,
    missingThumbnailSql
  } = await import('../scripts/backfill-plaza-thumbnails.mjs');
  const safe = {
    environment: 'test',
    database: 'jinshan20-test',
    bucket: 'jinshan20-test',
    config: 'cloudflare/pages-test/wrangler.jsonc'
  };
  assert.doesNotThrow(() => validateSafeTarget(safe));
  assert.throws(
    () => validateSafeTarget({ ...safe, database: 'jinshan20' }),
    /数据库名称必须以 -test 结尾/
  );
  assert.throws(
    () => validateSafeTarget({ ...safe, bucket: 'jinshan20' }),
    /存储桶名称必须以 -test 结尾/
  );
  assert.throws(
    () => validateSafeTarget({ ...safe, environment: 'production' }),
    /只允许 environment=test/
  );
  assert.equal(
    thumbnailObjectKey('test', 'media-1'),
    'media/test/backfill/plaza-thumbs/media-1-thumb.webp'
  );
  assert.match(missingThumbnailSql, /JOIN plaza_posts/);
  assert.match(missingThumbnailSql, /tv\.object_key IS NULL/);
  assert.doesNotMatch(missingThumbnailSql, /p\.status='visible'/);
});

test('缩略图生成WebP、最长边不超过360px且小于120KB', async () => {
  const {
    createThumbnail,
    MAX_THUMB_EDGE,
    MAX_THUMB_BYTES
  } = await import('../scripts/backfill-plaza-thumbnails.mjs');
  const sharp = require('sharp');
  const source = await sharp({
    create: {
      width: 1800,
      height: 1200,
      channels: 3,
      background: { r: 226, g: 118, b: 76 }
    }
  }).jpeg({ quality: 96 }).toBuffer();
  const thumbnail = await createThumbnail(source);
  const metadata = await sharp(thumbnail.data).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(Math.max(metadata.width, metadata.height) <= MAX_THUMB_EDGE);
  assert.ok(thumbnail.data.byteLength <= MAX_THUMB_BYTES);
});

test('广场列表与详情均优先返回thumb地址', () => {
  const plazaRoute = fs.readFileSync(
    path.join(__dirname, '..', 'cloudflare', 'routes', 'plaza.js'),
    'utf8'
  );
  const thumbUrls = plazaRoute.match(/thumbUrl:\s*`[^`]*variant=thumb[^`]*`/g) || [];
  const imageUrls = plazaRoute.match(/imageUrl:\s*`[^`]*variant=thumb[^`]*`/g) || [];
  assert.ok(thumbUrls.length >= 2, '广场列表和详情都必须提供thumbUrl');
  assert.ok(imageUrls.length >= 2, '兼容imageUrl也必须指向thumb');
});
