import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_PLAZA_PREFETCH_V1 */';
const file = path.join(root, 'public/app.js');
let source = fs.readFileSync(file, 'utf8');

if (!source.includes(marker)) {
  const replaceOnce = (input, search, replacement, label) => {
    const output = input.replace(search, replacement);
    if (output === input) throw new Error(`未找到${label}，已停止以避免误改`);
    return output;
  };

  source = replaceOnce(
    source,
    'const plazaViewCache = new Map();',
    `const plazaViewCache = new Map();\nlet studentPlazaPrefetchPromise = null;`,
    '活动广场缓存变量'
  );

  const prefetchFunction = [
    marker,
    "const prefetchStudentPlaza = () => {",
    "  if (user?.role !== 'student') return Promise.resolve(null);",
    "  const cacheKey = scopedCacheKey('plaza', 'latest', 1, '');",
    "  const cached = readViewCache(plazaViewCache, cacheKey);",
    "  if (cached) return Promise.resolve(cached.data);",
    "  if (studentPlazaPrefetchPromise) return studentPlazaPrefetchPromise;",
    "  const startedAt = performance.now();",
    "  const path = '/api/plaza?sort=latest&page=1&limit=20';",
    "  studentPlazaPrefetchPromise = api(path)",
    "    .then((result) => {",
    "      writeViewCache(plazaViewCache, cacheKey, result);",
    "      const firstImage = result.posts?.[0]?.images?.[0];",
    "      const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';",
    "      if (firstUrl) {",
    "        void fetch(buildMediaUrl(firstUrl), {",
    "          credentials: 'same-origin',",
    "          cache: 'force-cache',",
    "          priority: 'low'",
    "        }).catch(() => null);",
    "      }",
    "      recordPerf('plaza-prefetch', {",
    "        status: 'ready',",
    "        duration: roundedDuration(startedAt),",
    "        hasFirstImage: Boolean(firstUrl)",
    "      });",
    "      return result;",
    "    })",
    "    .catch((error) => {",
    "      recordPerf('plaza-prefetch', { status: 'failed', duration: roundedDuration(startedAt), message: error.message });",
    "      return null;",
    "    })",
    "    .finally(() => { studentPlazaPrefetchPromise = null; });",
    "  return studentPlazaPrefetchPromise;",
    "};",
    ''
  ].join('\n');

  source = replaceOnce(
    source,
    'const updatePlazaCachePost = (postId, updates) => {',
    `${prefetchFunction}const updatePlazaCachePost = (postId, updates) => {`,
    '活动广场预取函数位置'
  );

  source = replaceOnce(
    source,
    "  try { localStorage.user = JSON.stringify(user); } catch {}\n  const isInteraction = user.trackId === 'interaction';",
    "  try { localStorage.user = JSON.stringify(user); } catch {}\n  void prefetchStudentPlaza();\n  const isInteraction = user.trackId === 'interaction';",
    '学生首页预取启动位置'
  );

  fs.writeFileSync(file, source, 'utf8');
}

console.log('Applied student-home plaza list and first-thumbnail prefetch.');
