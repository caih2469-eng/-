import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');
const templatePath = path.resolve('templates/plaza-detail-fast-path.txt');
const marker = '/* PLAZA_DETAIL_FAST_PATH_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

const findTopLevelDeclaration = (source, fromIndex) => {
  const pattern = /^(?:async\s+function|function|const|let|class)\s+[A-Za-z_$][\w$]*/gm;
  pattern.lastIndex = Math.max(0, fromIndex);
  return pattern.exec(source)?.index ?? -1;
};

const replaceTopLevelDeclaration = (source, startAnchor, replacement, label) => {
  const start = source.indexOf(startAnchor);
  const end = start >= 0 ? findTopLevelDeclaration(source, start + 1) : -1;
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${label}顶层边界未找到，已停止以避免误改（start=${start}, end=${end}）`);
  }
  return `${source.slice(0, start)}${replacement.trimEnd()}\n\n${source.slice(end)}`;
};

const cacheHelpers = [
  "const plazaPostCacheKey = (postId) => scopedCacheKey('plaza-post', postId);",
  'const readPlazaPostCache = (postId) => {',
  '  const entry = plazaPostCache.get(plazaPostCacheKey(postId));',
  '  return entry && Date.now() - entry.savedAt <= PLAZA_POST_CACHE_TTL_MS ? entry.post : null;',
  '};',
  'const writePlazaPostCache = (postId, post) => {',
  '  plazaPostCache.set(plazaPostCacheKey(postId), { post, savedAt: Date.now() });',
  '  return post;',
  '};',
  'const patchPlazaPostCache = (postId, updates) => {',
  '  const entry = plazaPostCache.get(plazaPostCacheKey(postId));',
  '  if (entry?.post) Object.assign(entry.post, updates);',
  '};',
  'const loadPlazaPost = (postId) => {',
  '  const cached = readPlazaPostCache(postId);',
  '  if (cached) return Promise.resolve(cached);',
  '  const key = plazaPostCacheKey(postId);',
  '  if (plazaPostInflight.has(key)) return plazaPostInflight.get(key);',
  '  const generation = plazaPostCacheGeneration;',
  '  const request = api(`/api/plaza/${encodeURIComponent(postId)}`)',
  '    .then(({ post }) => {',
  '      if (generation === plazaPostCacheGeneration) writePlazaPostCache(postId, post);',
  '      return post;',
  '    })',
  '    .finally(() => {',
  '      if (plazaPostInflight.get(key) === request) plazaPostInflight.delete(key);',
  '    });',
  '  plazaPostInflight.set(key, request);',
  '  return request;',
  '};'
].join('\n');

const visibleCardUpdater = [
  'const updateVisiblePlazaCard = (postId, updates) => {',
  "  const card = [...app.querySelectorAll('[data-post]')].find(",
  '    (item) => item.dataset.post === postId',
  '  );',
  '  if (!card) return;',
  '  const updateText = (selector, value) => {',
  '    const target = card.querySelector(selector);',
  '    if (target && value != null) target.textContent = value;',
  '  };',
  "  updateText('[data-plaza-views]', updates.viewCount);",
  "  updateText('[data-plaza-comments]', updates.commentCount);",
  '  if (updates.likeCount != null) {',
  "    const likeTarget = card.querySelector('[data-plaza-likes]')",
  "      || card.querySelector('.plaza-like > span:last-child');",
  '    if (likeTarget) likeTarget.textContent = updates.likeCount;',
  '  }',
  '};'
].join('\n');

const detailTemplate = (await readFile(templatePath, 'utf8')).trim();
let app = await readFile(appPath, 'utf8');

if (!app.includes(marker)) {
  app = replaceOnce(
    app,
    'const plazaViewCache = new Map();',
    `${marker}\nconst PLAZA_POST_CACHE_TTL_MS = 30_000;\nconst plazaViewCache = new Map();\nconst plazaPostCache = new Map();\nconst plazaPostInflight = new Map();\nlet plazaPostCacheGeneration = 0;`,
    '活动广场缓存声明'
  );
  app = replaceOnce(
    app,
    'const clearUserViewCaches = () => {',
    `${cacheHelpers}\n\nconst clearUserViewCaches = () => {`,
    '活动广场详情缓存辅助函数位置'
  );
  app = replaceOnce(
    app,
    '  plazaViewCache.clear();',
    '  plazaViewCache.clear();\n  plazaPostCache.clear();\n  plazaPostInflight.clear();\n  plazaPostCacheGeneration += 1;',
    '用户缓存清理逻辑'
  );
  app = replaceTopLevelDeclaration(
    app,
    'const updateVisiblePlazaCard',
    visibleCardUpdater,
    '活动广场可见卡片同步函数'
  );
  app = replaceTopLevelDeclaration(
    app,
    'async function openPlazaPost',
    detailTemplate,
    '活动广场详情函数'
  );
  await writeFile(appPath, app, 'utf8');
}

app = await readFile(appPath, 'utf8');
if (!app.includes(marker)
    || !app.includes('const plazaPostCache = new Map();')
    || !app.includes('const plazaPostInflight = new Map();')
    || !app.includes("recordPerf('plaza-detail-visible'")
    || !app.includes('评论加载中…')
    || !app.includes("imageIndex === 0 ? 'high' : 'low'")
    || app.includes('await Promise.all([detailPromise, commentsPromise])')) {
  throw new Error('活动广场详情快速加载链路生成不完整');
}

await import('./apply-plaza-detail-instant-open.mjs');

process.stdout.write('Applied non-blocking plaza detail loading, detail cache, instant preview and deferred view counting.\n');
