import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = Object.freeze({
  database: 'jinshan20-test',
  bucket: 'jinshan20-test',
  config: 'cloudflare/pages-test/wrangler.jsonc',
  environment: 'test'
});

export const MAX_THUMB_EDGE = 360;
export const MAX_THUMB_BYTES = 120 * 1024;

export const missingThumbnailSql = `
SELECT i.id AS media_id,
       i.object_key AS original_key,
       i.bytes AS original_bytes,
       i.content_type AS original_content_type,
       p.id AS post_id,
       p.status AS post_status,
       s.id AS submission_id,
       s.is_public,
       dv.object_key AS display_key,
       dv.bytes AS display_bytes
  FROM task_submission_images i
  JOIN task_submissions s ON s.id=i.submission_id
  JOIN plaza_posts p ON p.submission_id=s.id
  LEFT JOIN image_variants tv
    ON tv.source_type='task_submission_image'
   AND tv.source_id=i.id
   AND tv.variant='thumb'
  LEFT JOIN image_variants dv
    ON dv.source_type='task_submission_image'
   AND dv.source_id=i.id
   AND dv.variant='display'
 WHERE tv.object_key IS NULL
 ORDER BY p.published_at, i.sort_order, i.id
`.trim();

const stripAnsi = (value) => String(value || '').replace(
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*m/g,
  ''
);

const parseArgs = (argv) => {
  const options = { ...DEFAULTS, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--apply') options.apply = true;
    else if (item === '--database') options.database = argv[++index];
    else if (item === '--bucket') options.bucket = argv[++index];
    else if (item === '--config') options.config = argv[++index];
    else if (item === '--environment') options.environment = argv[++index];
    else throw new Error(`未知参数：${item}`);
  }
  return options;
};

export const validateSafeTarget = (options) => {
  if (options.environment !== 'test') {
    throw new Error('安全保护：该脚本只允许 environment=test。');
  }
  if (!String(options.database || '').endsWith('-test')) {
    throw new Error('安全保护：D1 数据库名称必须以 -test 结尾。');
  }
  if (!String(options.bucket || '').endsWith('-test')) {
    throw new Error('安全保护：R2 存储桶名称必须以 -test 结尾。');
  }
  if (!/pages-test[\\/]wrangler\.jsonc$/i.test(String(options.config || ''))) {
    throw new Error('安全保护：必须使用 pages-test/wrangler.jsonc。');
  }
};

export const thumbnailObjectKey = (environment, mediaId) =>
  `media/${environment}/backfill/plaza-thumbs/${encodeURIComponent(mediaId)}-thumb.webp`;

const wranglerCli = path.resolve('node_modules/wrangler/bin/wrangler.js');

const runWrangler = (args, { allowMissingObject = false } = {}) => {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status === 0) return result.stdout;
  const message = stripAnsi(`${result.stderr || ''}\n${result.stdout || ''}`).trim();
  if (allowMissingObject && /specified key does not exist/i.test(message)) return null;
  throw new Error(message || `Wrangler 执行失败，退出码 ${result.status}`);
};

const queryD1 = (options, sql) => {
  const output = runWrangler([
    'd1', 'execute', options.database,
    '--remote',
    '--config', options.config,
    '--command', sql,
    '--json'
  ]);
  const payload = JSON.parse(stripAnsi(output));
  return payload[0] || { results: [], meta: {} };
};

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

export const createThumbnail = async (input) => {
  const dimensions = [360, 340, 320, 300, 280];
  const qualities = [84, 80, 76, 72, 68, 64, 60];
  let best = null;
  for (const edge of dimensions) {
    for (const quality of qualities) {
      const { data, info } = await sharp(input, { failOn: 'warning' })
        .rotate()
        .resize({
          width: edge,
          height: edge,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toColourspace('srgb')
        .webp({
          quality,
          alphaQuality: 90,
          effort: 5,
          smartSubsample: true
        })
        .toBuffer({ resolveWithObject: true });
      best = { data, info, quality, requestedEdge: edge };
      if (data.byteLength <= MAX_THUMB_BYTES) return best;
    }
  }
  throw new Error(
    `缩略图压缩后仍为 ${best?.data?.byteLength || 0} 字节，超过 ${MAX_THUMB_BYTES} 字节限制`
  );
};

const fetchR2Object = async (options, objectKey, destination, allowMissing = false) => {
  const result = runWrangler([
    'r2', 'object', 'get', `${options.bucket}/${objectKey}`,
    '--remote',
    '--config', options.config,
    '--file', destination
  ], { allowMissingObject: allowMissing });
  return result !== null;
};

const uploadR2Object = (options, objectKey, source) => {
  runWrangler([
    'r2', 'object', 'put', `${options.bucket}/${objectKey}`,
    '--remote',
    '--config', options.config,
    '--file', source,
    '--content-type', 'image/webp',
    '--cache-control', 'public, max-age=31536000, immutable',
    '--force'
  ]);
};

const verifyExistingThumbnail = async (filePath) => {
  const file = await readFile(filePath);
  const metadata = await sharp(file).metadata();
  const longestEdge = Math.max(Number(metadata.width || 0), Number(metadata.height || 0));
  if (metadata.format !== 'webp') throw new Error('已有对象不是 WebP');
  if (longestEdge > MAX_THUMB_EDGE) throw new Error(`已有对象最长边为 ${longestEdge}px`);
  if (file.byteLength > MAX_THUMB_BYTES) throw new Error(`已有对象为 ${file.byteLength} 字节`);
  return { bytes: file.byteLength, width: metadata.width, height: metadata.height };
};

const insertVariant = (options, row, objectKey, bytes) => queryD1(options, `
INSERT OR IGNORE INTO image_variants
  (source_type,source_id,variant,object_key,content_type,bytes,created_at)
VALUES
  ('task_submission_image',${sqlText(row.media_id)},'thumb',
   ${sqlText(objectKey)},'image/webp',${Number(bytes)},${sqlText(new Date().toISOString())})
`.trim());

const readVariant = (options, mediaId) => queryD1(options, `
SELECT source_id AS media_id,object_key,content_type,bytes,created_at
  FROM image_variants
 WHERE source_type='task_submission_image'
   AND source_id=${sqlText(mediaId)}
   AND variant='thumb'
 LIMIT 1
`.trim()).results?.[0] || null;

export const runBackfill = async (options) => {
  validateSafeTarget(options);
  const inventory = queryD1(options, missingThumbnailSql).results || [];
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: options.environment,
    database: options.database,
    bucket: options.bucket,
    beforeMissing: inventory.length,
    completed: 0,
    failed: 0,
    r2ObjectsAdded: 0,
    d1RecordsAdded: 0,
    items: inventory.map((row) => ({
      mediaId: row.media_id,
      postId: row.post_id,
      postStatus: row.post_status,
      originalBytes: Number(row.original_bytes || 0),
      sourceBytes: Number(row.display_bytes || row.original_bytes || 0),
      sourceKey: row.display_key || row.original_key
    }))
  };
  if (!options.apply || inventory.length === 0) {
    report.afterMissing = inventory.length;
    return report;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan20-thumb-backfill-'));
  try {
    for (const row of inventory) {
      const item = report.items.find((entry) => entry.mediaId === row.media_id);
      const objectKey = thumbnailObjectKey(options.environment, row.media_id);
      const sourcePath = path.join(workDir, `${row.media_id}-source`);
      const outputPath = path.join(workDir, `${row.media_id}-thumb.webp`);
      try {
        const existingRecord = readVariant(options, row.media_id);
        if (existingRecord) {
          item.result = 'already-recorded';
          item.thumbKey = existingRecord.object_key;
          item.thumbBytes = Number(existingRecord.bytes);
          report.completed += 1;
          continue;
        }

        const existingObject = await fetchR2Object(options, objectKey, outputPath, true);
        let thumbnail;
        if (existingObject) {
          thumbnail = await verifyExistingThumbnail(outputPath);
          item.reusedExistingObject = true;
        } else {
          const sourceKey = row.display_key || row.original_key;
          await fetchR2Object(options, sourceKey, sourcePath);
          const generated = await createThumbnail(await readFile(sourcePath));
          await writeFile(outputPath, generated.data);
          thumbnail = {
            bytes: generated.data.byteLength,
            width: generated.info.width,
            height: generated.info.height,
            quality: generated.quality
          };
          uploadR2Object(options, objectKey, outputPath);
          report.r2ObjectsAdded += 1;
        }

        const insertion = insertVariant(options, row, objectKey, thumbnail.bytes);
        report.d1RecordsAdded += Number(insertion.meta?.changes || 0);
        const saved = readVariant(options, row.media_id);
        if (!saved || saved.object_key !== objectKey) {
          throw new Error('D1 缩略图变体记录校验失败');
        }
        item.result = 'completed';
        item.thumbKey = objectKey;
        item.thumbBytes = thumbnail.bytes;
        item.width = thumbnail.width;
        item.height = thumbnail.height;
        if (thumbnail.quality) item.quality = thumbnail.quality;
        report.completed += 1;
      } catch (error) {
        item.result = 'failed';
        item.error = error instanceof Error ? error.message : String(error);
        report.failed += 1;
      }
    }
  } finally {
    const resolved = path.resolve(workDir);
    const safePrefix = path.resolve(tmpdir()) + path.sep;
    if (!resolved.startsWith(safePrefix) || !path.basename(resolved).startsWith('jinshan20-thumb-backfill-')) {
      throw new Error(`拒绝清理非预期临时目录：${resolved}`);
    }
    await rm(resolved, { recursive: true, force: true });
  }

  const remaining = queryD1(options, missingThumbnailSql).results || [];
  report.afterMissing = remaining.length;
  report.remainingMediaIds = remaining.map((row) => row.media_id);
  return report;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBackfill(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed || report.afterMissing) process.exitCode = 1;
};

if (process.argv[1] && path.basename(process.argv[1]) === 'backfill-plaza-thumbnails.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
