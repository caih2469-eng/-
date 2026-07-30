const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeFile } = require('node:fs/promises');
const sharp = require('sharp');

const testTarget = {
  environment: 'test',
  database: 'jinshan20-test',
  bucket: 'jinshan20-test',
  config: 'cloudflare/pages-test/wrangler.jsonc'
};

test('read-only thumbnail audit inventories records and objects, not only missing D1 rows', async () => {
  const {
    runThumbnailAudit,
    thumbnailInventorySql,
    validateReadOnlySql,
    validateReadOnlyTarget
  } = await import('../scripts/audit-plaza-thumbnails.mjs');

  assert.match(thumbnailInventorySql, /LEFT JOIN image_variants tv/);
  assert.match(thumbnailInventorySql, /LEFT JOIN image_variants dv/);
  assert.doesNotMatch(thumbnailInventorySql, /WHERE\s+tv\.object_key\s+IS\s+NULL/i);
  assert.doesNotThrow(() => validateReadOnlySql('SELECT 1'));
  assert.throws(() => validateReadOnlySql('DELETE FROM image_variants'), /read-only|只读/i);
  assert.doesNotThrow(() => validateReadOnlyTarget(testTarget));
  assert.doesNotThrow(() => validateReadOnlyTarget({
    environment: 'production',
    database: 'jinshan20',
    bucket: 'jinshan20',
    config: 'cloudflare/pages-production/wrangler.jsonc'
  }));

  const validImage = await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: { r: 210, g: 120, b: 80 }
    }
  }).webp({ quality: 80 }).toBuffer();
  const rows = [{
    media_id: 'media-missing-thumb',
    original_key: 'task-submissions/source.webp',
    original_bytes: validImage.length,
    original_content_type: 'image/webp',
    post_id: 'post-1',
    post_status: 'visible',
    submission_id: 'submission-1',
    is_public: 1,
    thumb_key: null,
    thumb_bytes: null,
    thumb_content_type: null,
    display_key: 'task-submissions/display.webp',
    display_bytes: validImage.length,
    display_content_type: 'image/webp'
  }, {
    media_id: 'media-missing-object',
    original_key: 'task-submissions/source-2.webp',
    original_bytes: validImage.length,
    original_content_type: 'image/webp',
    post_id: 'post-2',
    post_status: 'visible',
    submission_id: 'submission-2',
    is_public: 1,
    thumb_key: 'media/test/thumb-missing.webp',
    thumb_bytes: validImage.length,
    thumb_content_type: 'image/webp',
    display_key: null,
    display_bytes: null,
    display_content_type: null
  }];
  const report = await runThumbnailAudit(testTarget, {
    queryD1: async () => ({ results: rows }),
    fetchR2Object: async (_options, key, destination) => {
      if (key.includes('thumb-missing')) return false;
      await writeFile(destination, validImage);
      return true;
    }
  });
  assert.equal(report.totals.plazaMedia, 2);
  assert.equal(report.totals.issueCounts.thumbRecordMissing, 1);
  assert.equal(report.totals.issueCounts.thumbObjectMissing, 1);
  assert.equal(report.totals.issueCounts.displayObjectMissing, 1);
  assert.equal(report.totals.affected, 2);
});

test('backfill keeps test protection and requires all production confirmations', async () => {
  const { parseBackfillArgs, validateSafeTarget } = await import(
    '../scripts/backfill-plaza-thumbnails.mjs'
  );
  assert.doesNotThrow(() => validateSafeTarget({
    ...testTarget,
    apply: true,
    confirmProduction: null
  }));
  assert.throws(() => validateSafeTarget(parseBackfillArgs([
    '--environment', 'production'
  ])), /--apply/);
  assert.throws(() => validateSafeTarget(parseBackfillArgs([
    '--environment', 'production', '--apply'
  ])), /--confirm-production jinshan20/);
  assert.doesNotThrow(() => validateSafeTarget(parseBackfillArgs([
    '--environment', 'production',
    '--apply',
    '--confirm-production', 'jinshan20'
  ])));
  assert.throws(() => validateSafeTarget({
    ...testTarget,
    database: 'jinshan20',
    apply: true,
    confirmProduction: null
  }), /D1/);
});

test('thumbnail generation is WebP, no longer than 360px and no larger than 120KB', async () => {
  const {
    createThumbnail,
    MAX_THUMB_EDGE,
    MAX_THUMB_BYTES
  } = await import('../scripts/backfill-plaza-thumbnails.mjs');
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

test('plaza responses prefer thumb URLs', () => {
  const plazaRoute = fs.readFileSync(
    path.join(__dirname, '..', 'cloudflare', 'routes', 'plaza.js'),
    'utf8'
  );
  const thumbUrls = plazaRoute.match(/thumbUrl:\s*`[^`]*variant=thumb[^`]*`/g) || [];
  const imageUrls = plazaRoute.match(/imageUrl:\s*`[^`]*variant=thumb[^`]*`/g) || [];
  assert.ok(thumbUrls.length >= 2);
  assert.ok(imageUrls.length >= 2);
});
