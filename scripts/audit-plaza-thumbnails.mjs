import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export const MAX_THUMB_EDGE = 360;
export const MAX_THUMB_BYTES = 120 * 1024;

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

export const thumbnailInventorySql = `
SELECT i.id AS media_id,
       i.object_key AS original_key,
       i.bytes AS original_bytes,
       i.content_type AS original_content_type,
       p.id AS post_id,
       p.status AS post_status,
       s.id AS submission_id,
       s.is_public,
       tv.object_key AS thumb_key,
       tv.bytes AS thumb_bytes,
       tv.content_type AS thumb_content_type,
       dv.object_key AS display_key,
       dv.bytes AS display_bytes,
       dv.content_type AS display_content_type
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
 ORDER BY p.published_at, i.sort_order, i.id
`.trim();

const stripAnsi = (value) => String(value || '').replace(
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*m/g,
  ''
);

export const parseAuditArgs = (argv) => {
  const values = { environment: 'test' };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--environment') values.environment = argv[++index];
    else if (item === '--database') values.database = argv[++index];
    else if (item === '--bucket') values.bucket = argv[++index];
    else if (item === '--config') values.config = argv[++index];
    else throw new Error(`未知参数：${item}`);
  }
  const target = TARGETS[values.environment];
  if (!target) throw new Error('environment 只能是 test 或 production');
  return { ...target, ...values };
};

export const validateReadOnlyTarget = (options) => {
  const target = TARGETS[options.environment];
  if (!target) throw new Error('只读审计仅支持 test 或 production');
  for (const field of ['database', 'bucket']) {
    if (options[field] !== target[field]) {
      throw new Error(`只读审计拒绝不匹配的 ${field}：${options[field]}`);
    }
  }
  const actualConfig = path.normalize(String(options.config || ''));
  const expectedConfig = path.normalize(target.config);
  if (!actualConfig.endsWith(expectedConfig)) {
    throw new Error(`只读审计必须使用 ${target.config}`);
  }
};

export const validateReadOnlySql = (sql) => {
  const normalized = String(sql || '').trim().replace(/^--.*$/gm, '').trim();
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error('只读审计拒绝执行非查询SQL');
  }
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA)\b/i.test(normalized)) {
    throw new Error('只读审计SQL包含写入或结构变更关键字');
  }
};

export const validateObjectKey = (key, environment, { thumbnail = false } = {}) => {
  const value = String(key || '');
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('..')
      || /^[a-z]+:\/\//i.test(value) || /[\u0000-\u001f]/.test(value)) return false;
  if (thumbnail && !value.toLowerCase().endsWith('.webp')) return false;
  const allowedPrefixes = [
    `media/${environment}/`,
    'task-submissions/'
  ];
  return allowedPrefixes.some((prefix) => value.startsWith(prefix));
};

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

const queryD1ReadOnly = (options, sql) => {
  validateReadOnlySql(sql);
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

const fetchR2Object = (options, objectKey, destination) => runWrangler([
  'r2', 'object', 'get', `${options.bucket}/${objectKey}`,
  '--remote',
  '--config', options.config,
  '--file', destination
], { allowMissingObject: true }) !== null;

const pushIssue = (item, code, details = {}) => {
  if (!item.issues.some((issue) => issue.code === code)) item.issues.push({ code, ...details });
};

const inspectImage = async (filePath) => {
  const file = await readFile(filePath);
  const metadata = await sharp(file, { failOn: 'none' }).metadata();
  return {
    bytes: file.byteLength,
    format: metadata.format || null,
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
    longestEdge: Math.max(Number(metadata.width || 0), Number(metadata.height || 0))
  };
};

export const runThumbnailAudit = async (options, adapters = {}) => {
  validateReadOnlyTarget(options);
  const query = adapters.queryD1 || queryD1ReadOnly;
  const inventory = (await query(options, thumbnailInventorySql)).results || [];
  const report = {
    schemaVersion: 1,
    mode: 'read-only',
    environment: options.environment,
    database: options.database,
    bucket: options.bucket,
    generatedAt: new Date().toISOString(),
    totals: {
      plazaMedia: inventory.length,
      compliant: 0,
      affected: 0,
      issueCounts: {
        thumbRecordMissing: 0,
        thumbObjectMissing: 0,
        thumbNotWebP: 0,
        thumbTooLarge: 0,
        thumbEdgeTooLong: 0,
        originalObjectMissing: 0,
        displayObjectMissing: 0,
        invalidObjectKey: 0
      }
    },
    items: []
  };
  const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan20-thumb-audit-'));
  const objectCache = new Map();
  const fetchObject = adapters.fetchR2Object || fetchR2Object;
  try {
    const inspectObject = async (key) => {
      if (objectCache.has(key)) return objectCache.get(key);
      const filePath = path.join(workDir, `${objectCache.size}.bin`);
      const exists = await fetchObject(options, key, filePath);
      const result = exists ? { exists: true, ...(await inspectImage(filePath)) } : { exists: false };
      objectCache.set(key, result);
      return result;
    };

    for (const row of inventory) {
      const item = {
        mediaId: row.media_id,
        postId: row.post_id,
        submissionId: row.submission_id,
        postStatus: row.post_status,
        original: {
          key: row.original_key || null,
          bytes: Number(row.original_bytes || 0),
          contentType: row.original_content_type || null
        },
        display: {
          key: row.display_key || null,
          bytes: Number(row.display_bytes || 0),
          contentType: row.display_content_type || null
        },
        thumb: {
          key: row.thumb_key || null,
          bytes: Number(row.thumb_bytes || 0),
          contentType: row.thumb_content_type || null
        },
        issues: []
      };

      for (const [name, key] of [
        ['original', row.original_key],
        ['display', row.display_key],
        ['thumb', row.thumb_key]
      ]) {
        if (key && !validateObjectKey(key, options.environment, { thumbnail: name === 'thumb' })) {
          pushIssue(item, 'invalidObjectKey', { field: name, key });
        }
      }

      if (!row.original_key) {
        pushIssue(item, 'originalObjectMissing', { reason: 'missing-d1-key' });
      } else if (validateObjectKey(row.original_key, options.environment)) {
        const original = await inspectObject(row.original_key);
        item.original.exists = original.exists;
        if (!original.exists) pushIssue(item, 'originalObjectMissing', { key: row.original_key });
      }

      if (!row.display_key) {
        pushIssue(item, 'displayObjectMissing', { reason: 'missing-d1-record' });
      } else if (validateObjectKey(row.display_key, options.environment)) {
        const display = await inspectObject(row.display_key);
        item.display.exists = display.exists;
        if (!display.exists) pushIssue(item, 'displayObjectMissing', { key: row.display_key });
      }

      if (!row.thumb_key) {
        pushIssue(item, 'thumbRecordMissing');
      } else if (validateObjectKey(row.thumb_key, options.environment, { thumbnail: true })) {
        const thumb = await inspectObject(row.thumb_key);
        item.thumb = { ...item.thumb, ...thumb };
        if (!thumb.exists) {
          pushIssue(item, 'thumbObjectMissing', { key: row.thumb_key });
        } else {
          if (thumb.format !== 'webp' || row.thumb_content_type !== 'image/webp') {
            pushIssue(item, 'thumbNotWebP', {
              actualFormat: thumb.format,
              recordedContentType: row.thumb_content_type || null
            });
          }
          if (thumb.bytes > MAX_THUMB_BYTES) {
            pushIssue(item, 'thumbTooLarge', { actualBytes: thumb.bytes, maximumBytes: MAX_THUMB_BYTES });
          }
          if (thumb.longestEdge > MAX_THUMB_EDGE) {
            pushIssue(item, 'thumbEdgeTooLong', {
              actualLongestEdge: thumb.longestEdge,
              maximumEdge: MAX_THUMB_EDGE
            });
          }
        }
      }

      for (const issue of item.issues) {
        if (Object.hasOwn(report.totals.issueCounts, issue.code)) {
          report.totals.issueCounts[issue.code] += 1;
        }
      }
      if (item.issues.length) report.totals.affected += 1;
      else report.totals.compliant += 1;
      report.items.push(item);
    }
  } finally {
    const resolved = path.resolve(workDir);
    const safePrefix = path.resolve(tmpdir()) + path.sep;
    if (!resolved.startsWith(safePrefix)
        || !path.basename(resolved).startsWith('jinshan20-thumb-audit-')) {
      throw new Error(`拒绝清理非预期临时目录：${resolved}`);
    }
    await rm(resolved, { recursive: true, force: true });
  }
  return report;
};

const main = async () => {
  const options = parseAuditArgs(process.argv.slice(2));
  const report = await runThumbnailAudit(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.totals.affected) process.exitCode = 1;
};

if (process.argv[1] && path.basename(process.argv[1]) === 'audit-plaza-thumbnails.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
