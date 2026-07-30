import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createThumbnail } from './backfill-plaza-thumbnails.mjs';

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

const wranglerCli = path.resolve('node_modules/wrangler/bin/wrangler.js');
const stripAnsi = (value) => String(value || '').replace(
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*m/g,
  ''
);
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

export const parsePrivateBackfillArgs = (argv) => {
  const values = { environment: 'test', apply: false, confirmProduction: null };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--environment') values.environment = argv[++index];
    else if (item === '--database') values.database = argv[++index];
    else if (item === '--bucket') values.bucket = argv[++index];
    else if (item === '--config') values.config = argv[++index];
    else if (item === '--apply') values.apply = true;
    else if (item === '--confirm-production') values.confirmProduction = argv[++index];
    else throw new Error(`未知参数：${item}`);
  }
  const target = TARGETS[values.environment];
  if (!target) throw new Error('environment 只能是 test 或 production');
  return { ...target, ...values };
};

export const validatePrivateBackfillTarget = (options) => {
  const target = TARGETS[options.environment];
  if (!target
      || options.database !== target.database
      || options.bucket !== target.bucket
      || !path.normalize(options.config).endsWith(path.normalize(target.config))) {
    throw new Error('D1、R2或Wrangler配置与目标环境不匹配');
  }
  if (options.environment === 'production') {
    if (!options.apply || options.confirmProduction !== 'jinshan20') {
      throw new Error(
        '正式环境写入必须同时提供 --environment production --apply '
        + '--confirm-production jinshan20'
      );
    }
  } else if (options.confirmProduction) {
    throw new Error('测试环境不得提供正式环境确认参数');
  }
};

const runWrangler = (args, { allowMissing = false } = {}) => {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status === 0) return result.stdout;
  const message = stripAnsi(`${result.stderr || ''}\n${result.stdout || ''}`).trim();
  if (allowMissing && /specified key does not exist|not found|does not exist/i.test(message)) {
    return null;
  }
  throw new Error(message || `Wrangler执行失败，退出码 ${result.status}`);
};

const queryD1 = (options, sql) => {
  const output = runWrangler([
    'd1', 'execute', options.database,
    '--remote',
    '--config', options.config,
    '--command', sql,
    '--json'
  ]);
  return JSON.parse(stripAnsi(output))[0] || { results: [], meta: {} };
};

const inventorySql = `
SELECT mc.id,mc.user_id AS owner_user_id,mc.task_id,mc.object_key AS original_key,
       mc.content_type AS original_content_type,mc.bytes AS original_bytes,mc.submitted_at
  FROM member_checkins mc
  LEFT JOIN media_objects m
    ON m.business_id=mc.id AND m.business_type='member-checkin'
 WHERE m.id IS NULL
 ORDER BY mc.submitted_at,mc.id
`.trim();

export const privateVariantKeys = (environment, checkinId) => ({
  display: `media/${environment}/backfill/member-checkins/${checkinId}-display.webp`,
  thumb: `media/${environment}/backfill/member-checkins/${checkinId}-thumb.webp`
});

export const createPrivateDisplay = async (input) => {
  const { data, info } = await sharp(input, { failOn: 'warning' })
    .rotate()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .webp({ quality: 88, alphaQuality: 92, effort: 5, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

const getObject = (options, key, file, allowMissing = false) => runWrangler([
  'r2', 'object', 'get', `${options.bucket}/${key}`,
  '--remote',
  '--config', options.config,
  '--file', file
], { allowMissing }) !== null;

const putObject = (options, key, file) => runWrangler([
  'r2', 'object', 'put', `${options.bucket}/${key}`,
  '--remote',
  '--config', options.config,
  '--file', file,
  '--content-type', 'image/webp',
  '--cache-control', 'private, max-age=31536000, immutable'
]);

const verifyVariant = async (file, maxEdge, maxBytes) => {
  const data = await readFile(file);
  const metadata = await sharp(data).metadata();
  const longestEdge = Math.max(Number(metadata.width || 0), Number(metadata.height || 0));
  if (metadata.format !== 'webp' || longestEdge > maxEdge || data.byteLength > maxBytes) {
    throw new Error(`已有变体不合规：${metadata.format}/${longestEdge}px/${data.byteLength}B`);
  }
  return {
    data,
    width: Number(metadata.width),
    height: Number(metadata.height)
  };
};

const insertRecordsSql = (item, keys, display, thumb, now) => {
  const displayId = `backfill-display-${item.id}`;
  const thumbId = `backfill-thumb-${item.id}`;
  return `
INSERT OR IGNORE INTO media_objects
 (id,owner_user_id,task_id,business_type,business_id,object_key,mime_type,file_size,
  width,height,etag,visibility,created_at,updated_at)
VALUES
 (${sqlText(displayId)},${sqlText(item.owner_user_id)},${sqlText(item.task_id)},
  'member-checkin',${sqlText(item.id)},${sqlText(keys.display)},'image/webp',
  ${display.data.byteLength},${display.width},${display.height},NULL,'private',${sqlText(now)},${sqlText(now)});
INSERT OR IGNORE INTO media_objects
 (id,owner_user_id,task_id,business_type,business_id,object_key,mime_type,file_size,
  width,height,etag,visibility,created_at,updated_at)
VALUES
 (${sqlText(thumbId)},${sqlText(item.owner_user_id)},${sqlText(item.task_id)},
  'member-checkin:thumb',${sqlText(displayId)},${sqlText(keys.thumb)},'image/webp',
  ${thumb.data.byteLength},${thumb.width},${thumb.height},NULL,'private',${sqlText(now)},${sqlText(now)});
INSERT OR IGNORE INTO image_variants
 (source_type,source_id,variant,object_key,content_type,bytes,created_at)
VALUES ('member_checkin',${sqlText(item.id)},'display',${sqlText(keys.display)},
        'image/webp',${display.data.byteLength},${sqlText(now)});
INSERT OR IGNORE INTO image_variants
 (source_type,source_id,variant,object_key,content_type,bytes,created_at)
VALUES ('member_checkin',${sqlText(item.id)},'thumb',${sqlText(keys.thumb)},
        'image/webp',${thumb.data.byteLength},${sqlText(now)});
`.trim();
};

export const runPrivateCheckinBackfill = async (options) => {
  validatePrivateBackfillTarget(options);
  const inventory = queryD1(options, inventorySql).results || [];
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: options.environment,
    before: { legacyRecords: inventory.length },
    candidates: inventory.map((item) => ({
      id: item.id,
      originalKey: item.original_key,
      originalBytes: Number(item.original_bytes || 0)
    })),
    completed: 0,
    failed: 0,
    r2ObjectsAdded: 0,
    d1DisplayRecordsAdded: 0,
    d1ThumbRecordsAdded: 0,
    originalObjectsModified: 0,
    rollback: { r2ObjectKeysToDelete: [], d1Statements: [] }
  };
  if (!options.apply || !inventory.length) return report;

  const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan20-private-backfill-'));
  try {
    for (const item of inventory) {
      const row = report.candidates.find((entry) => entry.id === item.id);
      const source = path.join(workDir, `${item.id}-source`);
      const displayFile = path.join(workDir, `${item.id}-display.webp`);
      const thumbFile = path.join(workDir, `${item.id}-thumb.webp`);
      try {
        if (!await getObject(options, item.original_key, source, true)) {
          throw new Error('历史原图对象不存在');
        }
        const keys = privateVariantKeys(options.environment, item.id);
        let display;
        if (await getObject(options, keys.display, displayFile, true)) {
          display = await verifyVariant(displayFile, 960, 300 * 1024);
        } else {
          display = await createPrivateDisplay(await readFile(source));
          await writeFile(displayFile, display.data);
          putObject(options, keys.display, displayFile);
          report.r2ObjectsAdded += 1;
          report.rollback.r2ObjectKeysToDelete.push(keys.display);
        }
        let thumb;
        if (await getObject(options, keys.thumb, thumbFile, true)) {
          thumb = await verifyVariant(thumbFile, 360, 120 * 1024);
        } else {
          const generated = await createThumbnail(await readFile(source));
          thumb = {
            data: generated.data,
            width: generated.info.width,
            height: generated.info.height
          };
          await writeFile(thumbFile, thumb.data);
          putObject(options, keys.thumb, thumbFile);
          report.r2ObjectsAdded += 1;
          report.rollback.r2ObjectKeysToDelete.push(keys.thumb);
        }
        const now = new Date().toISOString();
        queryD1(options, insertRecordsSql(item, keys, display, thumb, now));
        const saved = queryD1(options, `
SELECT business_type
  FROM media_objects
 WHERE id IN (${sqlText(`backfill-display-${item.id}`)},${sqlText(`backfill-thumb-${item.id}`)})
 ORDER BY business_type
`.trim()).results || [];
        if (!saved.some((entry) => entry.business_type === 'member-checkin')
            || !saved.some((entry) => entry.business_type === 'member-checkin:thumb')) {
          throw new Error('D1图片变体记录校验失败');
        }
        report.d1DisplayRecordsAdded += 1;
        report.d1ThumbRecordsAdded += 1;
        report.rollback.d1Statements.push(
          `DELETE FROM image_variants WHERE source_type='member_checkin' AND source_id=${sqlText(item.id)};`,
          `DELETE FROM media_objects WHERE id IN (${sqlText(`backfill-display-${item.id}`)},`
            + `${sqlText(`backfill-thumb-${item.id}`)});`
        );
        row.displayBytes = display.data.byteLength;
        row.thumbBytes = thumb.data.byteLength;
        row.result = 'completed';
        report.completed += 1;
      } catch (error) {
        row.result = 'failed';
        row.error = error instanceof Error ? error.message : String(error);
        report.failed += 1;
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  report.after = {
    legacyRecords: Number(queryD1(options, `SELECT COUNT(*) AS count
      FROM member_checkins mc LEFT JOIN media_objects m
        ON m.business_id=mc.id AND m.business_type='member-checkin'
      WHERE m.id IS NULL`).results?.[0]?.count || 0)
  };
  return report;
};

const main = async () => {
  const options = parsePrivateBackfillArgs(process.argv.slice(2));
  const report = await runPrivateCheckinBackfill(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed) process.exitCode = 1;
};

if (process.argv[1] && path.basename(process.argv[1]) === 'backfill-private-checkin-images.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
