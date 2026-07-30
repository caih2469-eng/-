import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  MAX_THUMB_BYTES,
  MAX_THUMB_EDGE,
  runThumbnailAudit,
  validateObjectKey
} from './audit-plaza-thumbnails.mjs';

const TARGETS = Object.freeze({
  test: Object.freeze({
    database: 'jinshan20-test',
    bucket: 'jinshan20-test',
    config: 'cloudflare/pages-test/wrangler.jsonc'
  }),
  production: Object.freeze({
    database: 'jinshan20',
    bucket: 'jinshan20',
    config: 'cloudflare/pages-production/wrangler.jsonc'
  })
});

export { MAX_THUMB_EDGE, MAX_THUMB_BYTES };

export const parseBackfillArgs = (argv) => {
  const values = {
    environment: 'test',
    apply: false,
    confirmProduction: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--environment') values.environment = argv[++index];
    else if (item === '--database') values.database = argv[++index];
    else if (item === '--bucket') values.bucket = argv[++index];
    else if (item === '--config') values.config = argv[++index];
    else if (item === '--confirm-production') values.confirmProduction = argv[++index];
    else if (item === '--apply') values.apply = true;
    else throw new Error(`未知参数：${item}`);
  }
  const target = TARGETS[values.environment];
  if (!target) throw new Error('environment 只能是 test 或 production');
  return { ...target, ...values };
};

export const validateSafeTarget = (options) => {
  const target = TARGETS[options.environment];
  if (!target) throw new Error('补全脚本仅支持 test 或 production');
  if (options.database !== target.database) {
    throw new Error(`安全保护：${options.environment} D1 必须是 ${target.database}`);
  }
  if (options.bucket !== target.bucket) {
    throw new Error(`安全保护：${options.environment} R2 必须是 ${target.bucket}`);
  }
  if (!path.normalize(String(options.config || '')).endsWith(path.normalize(target.config))) {
    throw new Error(`安全保护：必须使用 ${target.config}`);
  }
  if (options.environment === 'production') {
    if (!options.apply) {
      throw new Error('正式补全必须同时提供 --environment production 和 --apply');
    }
    if (options.confirmProduction !== 'jinshan20') {
      throw new Error('正式补全必须提供 --confirm-production jinshan20');
    }
  } else if (options.confirmProduction) {
    throw new Error('测试环境不得提供 --confirm-production');
  }
};

export const thumbnailObjectKey = (environment, mediaId) =>
  `media/${environment}/backfill/plaza-thumbs/${encodeURIComponent(mediaId)}-thumb-640-v2.webp`;

const stripAnsi = (value) => String(value || '').replace(
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*m/g,
  ''
);
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
  if (allowMissingObject && /specified key does not exist|not found|does not exist/i.test(message)) {
    return null;
  }
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
  const dimensions = [640, 620, 600];
  const qualities = [86, 84, 82, 80, 78, 76, 74, 72];
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

const uploadNewR2Object = (options, objectKey, source) => {
  runWrangler([
    'r2', 'object', 'put', `${options.bucket}/${objectKey}`,
    '--remote',
    '--config', options.config,
    '--file', source,
    '--content-type', 'image/webp',
    '--cache-control', 'public, max-age=31536000, immutable'
  ]);
};

const deleteR2Object = (options, objectKey) => {
  runWrangler([
    'r2', 'object', 'delete', `${options.bucket}/${objectKey}`,
    '--remote',
    '--config', options.config
  ]);
};

const verifyExistingThumbnail = async (filePath) => {
  const file = await readFile(filePath);
  const metadata = await sharp(file).metadata();
  const longestEdge = Math.max(Number(metadata.width || 0), Number(metadata.height || 0));
  if (metadata.format !== 'webp') throw new Error('已有对象不是 WebP，拒绝覆盖');
  if (longestEdge > MAX_THUMB_EDGE) {
    throw new Error(`已有对象最长边为 ${longestEdge}px，拒绝覆盖`);
  }
  if (file.byteLength > MAX_THUMB_BYTES) {
    throw new Error(`已有对象为 ${file.byteLength} 字节，拒绝覆盖`);
  }
  return { bytes: file.byteLength, width: metadata.width, height: metadata.height };
};

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const verifyUploadedThumbnail = async (options, objectKey, workDir, mediaId) => {
  const retryDelays = [0, 500, 1000, 1500];
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) await wait(retryDelays[attempt]);
    const verifyPath = path.join(workDir, `${mediaId}-verify-${attempt}.webp`);
    const uploadedObject = await fetchR2Object(options, objectKey, verifyPath, true);
    if (uploadedObject) return verifyExistingThumbnail(verifyPath);
  }
  throw new Error('R2缩略图上传后校验失败，D1未切换');
};

const insertVariant = (options, item, objectKey, bytes) => queryD1(options, `
INSERT OR IGNORE INTO image_variants
  (source_type,source_id,variant,object_key,content_type,bytes,created_at)
VALUES
  ('task_submission_image',${sqlText(item.mediaId)},'thumb',
   ${sqlText(objectKey)},'image/webp',${Number(bytes)},${sqlText(new Date().toISOString())})
`.trim());

const updateVariant = (options, item, objectKey, bytes) => queryD1(options, `
UPDATE image_variants
   SET object_key=${sqlText(objectKey)},content_type='image/webp',bytes=${Number(bytes)}
 WHERE source_type='task_submission_image'
   AND source_id=${sqlText(item.mediaId)}
   AND variant='thumb'
   AND object_key=${sqlText(item.thumb.key)}
`.trim());

const readVariant = (options, mediaId) => queryD1(options, `
SELECT source_id AS media_id,object_key,content_type,bytes,created_at
  FROM image_variants
 WHERE source_type='task_submission_image'
   AND source_id=${sqlText(mediaId)}
   AND variant='thumb'
 LIMIT 1
`.trim()).results?.[0] || null;

const issueCodes = (item) => new Set(item.issues.map((issue) => issue.code));

export const runBackfill = async (options) => {
  validateSafeTarget(options);
  const before = await runThumbnailAudit(options);
  const candidates = before.items.filter((item) => {
    const codes = issueCodes(item);
    return codes.has('thumbRecordMissing')
      || codes.has('thumbObjectMissing')
      || codes.has('thumbEdgeTooShort');
  });
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: options.environment,
    database: options.database,
    bucket: options.bucket,
    before: before.totals,
    candidates: candidates.length,
    completed: 0,
    failed: 0,
    skippedUnsafe: 0,
    r2ObjectsAdded: 0,
    d1RecordsAdded: 0,
    d1RecordsUpdated: 0,
    rollback: {
      r2ObjectKeysToDelete: [],
      d1Statements: []
    },
    items: candidates.map((item) => ({
      mediaId: item.mediaId,
      postId: item.postId,
      originalBytes: item.original.bytes,
      sourceKey: item.display.exists ? item.display.key : item.original.key,
      issuesBefore: item.issues
    }))
  };
  if (!options.apply || candidates.length === 0) {
    report.after = before.totals;
    return report;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan20-thumb-backfill-'));
  try {
    for (const candidate of candidates) {
      const resultItem = report.items.find((entry) => entry.mediaId === candidate.mediaId);
      const codes = issueCodes(candidate);
      const unsafeExisting = [
        'thumbNotWebP',
        'thumbTooLarge',
        'thumbEdgeTooLong',
        'invalidObjectKey'
      ].some((code) => codes.has(code));
      if (unsafeExisting || (!candidate.display.exists && !candidate.original.exists)) {
        resultItem.result = 'skipped-unsafe';
        resultItem.error = unsafeExisting
          ? '已有缩略图或对象键异常，拒绝覆盖'
          : '原始图和display对象均不可用';
        report.skippedUnsafe += 1;
        report.failed += 1;
        continue;
      }

      const missingRecord = codes.has('thumbRecordMissing');
      const objectKey = thumbnailObjectKey(options.environment, candidate.mediaId);
      if (!validateObjectKey(objectKey, options.environment, { thumbnail: true })) {
        resultItem.result = 'skipped-unsafe';
        resultItem.error = `缩略图对象键不安全：${objectKey}`;
        report.skippedUnsafe += 1;
        report.failed += 1;
        continue;
      }
      const sourceKey = candidate.display.exists ? candidate.display.key : candidate.original.key;
      const sourcePath = path.join(workDir, `${candidate.mediaId}-source`);
      const outputPath = path.join(workDir, `${candidate.mediaId}-thumb.webp`);
      let addedObjectKey = null;
      try {
        const existingObject = await fetchR2Object(options, objectKey, outputPath, true);
        let thumbnail;
        if (existingObject) {
          thumbnail = await verifyExistingThumbnail(outputPath);
          resultItem.reusedExistingObject = true;
        } else {
          await fetchR2Object(options, sourceKey, sourcePath);
          const generated = await createThumbnail(await readFile(sourcePath));
          await writeFile(outputPath, generated.data);
          thumbnail = {
            bytes: generated.data.byteLength,
            width: generated.info.width,
            height: generated.info.height,
            quality: generated.quality
          };
          uploadNewR2Object(options, objectKey, outputPath);
          addedObjectKey = objectKey;
          report.r2ObjectsAdded += 1;
          report.rollback.r2ObjectKeysToDelete.push(objectKey);
          await verifyUploadedThumbnail(options, objectKey, workDir, candidate.mediaId);
        }

        if (missingRecord) {
          const insertion = insertVariant(options, candidate, objectKey, thumbnail.bytes);
          const changes = Number(insertion.meta?.changes || 0);
          report.d1RecordsAdded += changes;
          if (changes) {
            report.rollback.d1Statements.push(
              `DELETE FROM image_variants WHERE source_type='task_submission_image' `
              + `AND source_id=${sqlText(candidate.mediaId)} AND variant='thumb';`
            );
          }
        } else {
          const oldType = candidate.thumb.contentType;
          const oldBytes = candidate.thumb.bytes;
          const oldKey = candidate.thumb.key;
          const update = updateVariant(options, candidate, objectKey, thumbnail.bytes);
          const changes = Number(update.meta?.changes || 0);
          report.d1RecordsUpdated += changes;
          if (changes) {
            report.rollback.d1Statements.push(
              `UPDATE image_variants SET object_key=${sqlText(oldKey)},`
              + `content_type=${sqlText(oldType)},bytes=${Number(oldBytes)} `
              + `WHERE source_type='task_submission_image' AND source_id=${sqlText(candidate.mediaId)} `
              + `AND variant='thumb';`
            );
          }
        }

        const saved = readVariant(options, candidate.mediaId);
        if (!saved || saved.object_key !== objectKey) {
          throw new Error('D1缩略图变体记录校验失败');
        }
        resultItem.result = 'completed';
        resultItem.thumbKey = objectKey;
        resultItem.thumbBytes = thumbnail.bytes;
        resultItem.width = thumbnail.width;
        resultItem.height = thumbnail.height;
        if (thumbnail.quality) resultItem.quality = thumbnail.quality;
        report.completed += 1;
      } catch (error) {
        if (addedObjectKey) {
          try {
            deleteR2Object(options, addedObjectKey);
            report.r2ObjectsAdded -= 1;
            report.rollback.r2ObjectKeysToDelete = report.rollback.r2ObjectKeysToDelete
              .filter((key) => key !== addedObjectKey);
            resultItem.rolledBackR2Object = true;
          } catch (rollbackError) {
            resultItem.rollbackError = rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          }
        }
        resultItem.result = 'failed';
        resultItem.error = error instanceof Error ? error.message : String(error);
        report.failed += 1;
      }
    }
  } finally {
    const resolved = path.resolve(workDir);
    const safePrefix = path.resolve(tmpdir()) + path.sep;
    if (!resolved.startsWith(safePrefix)
        || !path.basename(resolved).startsWith('jinshan20-thumb-backfill-')) {
      throw new Error(`拒绝清理非预期临时目录：${resolved}`);
    }
    await rm(resolved, { recursive: true, force: true });
  }

  const after = await runThumbnailAudit(options);
  report.after = after.totals;
  report.remainingAffectedMediaIds = after.items
    .filter((item) => item.issues.length)
    .map((item) => item.mediaId);
  return report;
};

const main = async () => {
  const options = parseBackfillArgs(process.argv.slice(2));
  const report = await runBackfill(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed || report.after.affected) process.exitCode = 1;
};

if (process.argv[1] && path.basename(process.argv[1]) === 'backfill-plaza-thumbnails.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
