import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  createPrivateDisplay,
  parsePrivateBackfillArgs,
  privateVariantKeys,
  validatePrivateBackfillTarget
} from '../scripts/backfill-private-checkin-images.mjs';

test('历史私密打卡补全正式环境必须三重明确确认', () => {
  assert.throws(
    () => validatePrivateBackfillTarget(parsePrivateBackfillArgs(['--environment', 'production'])),
    /--apply/
  );
  assert.throws(
    () => validatePrivateBackfillTarget(parsePrivateBackfillArgs([
      '--environment', 'production', '--apply'
    ])),
    /--confirm-production/
  );
  assert.doesNotThrow(() => validatePrivateBackfillTarget(parsePrivateBackfillArgs([
    '--environment', 'production', '--apply', '--confirm-production', 'jinshan20'
  ])));
});

test('历史私密打卡变体键稳定且隔离环境', () => {
  assert.deepEqual(privateVariantKeys('test', 'record-1'), {
    display: 'media/test/backfill/member-checkins/record-1-display.webp',
    thumb: 'media/test/backfill/member-checkins/record-1-thumb.webp'
  });
});

test('历史私密打卡display转换为不超过960px的WebP', async () => {
  const input = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: '#e85d75' }
  }).jpeg({ quality: 95 }).toBuffer();
  const result = await createPrivateDisplay(input);
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(Math.max(metadata.width, metadata.height) <= 960);
  assert.ok(result.data.byteLength <= 300 * 1024);
});
