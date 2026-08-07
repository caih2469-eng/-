import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const entranceMarker = '/* STRICT_P95_LOGIN_READY_V4 */';
const appMarker = '/* STRICT_P95_APP_PREFETCH_V4 */';
const bootstrapMarker = '/* STRICT_P95_BOOTSTRAP_V4 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const { file, source } = read('public/entrance.js');
  if (!source.includes(entranceMarker)) {
    const oldReveal = `            setTimeout(() => {\n                intro.style.opacity = '0';\n                intro.style.pointerEvents = 'none';\n                \n                ambient.style.opacity = '1';\n                vignette.style.opacity = '1';\n                bgStars.style.opacity = '1';\n                glow.style.opacity = '1';\n                \n                uiLayer.style.opacity = '1';\n                uiLayer.style.transform = 'translateY(0)';\n            }, 800);`;
    const newReveal = `            ${entranceMarker}\n            // Login controls are part of the critical path. Keep the cinematic layer decorative, never blocking input.\n            intro.style.pointerEvents = 'none';\n            intro.style.zIndex = '5';\n            uiLayer.style.transition = 'none';\n            uiLayer.style.opacity = '1';\n            uiLayer.style.transform = 'translateY(0)';\n            requestAnimationFrame(() => {\n                ambient.style.opacity = '1';\n                vignette.style.opacity = '1';\n                bgStars.style.opacity = '1';\n                glow.style.opacity = '1';\n                setTimeout(() => { intro.style.opacity = '0'; }, 250);\n            });`;
    write(file, replaceOnce(source, oldReveal, newReveal, '登录界面延迟显示区块'));
  }
}

{
  const { file, source } = read('public/bootstrap.js');
  if (!source.includes(bootstrapMarker)) {
    const pattern = /\s*\/\* PLAZA_PERFORMANCE_QUALITY_V3 \*\/\n\s*window\.__BOOTSTRAP_PLAZA_PROMISE__ = window\.__BOOTSTRAP_USER__\?\.role === 'student'[\s\S]*?\n\s*: Promise\.resolve\(null\);/;
    if (!pattern.test(source)) throw new Error('未找到启动阶段活动广场预取区块');
    const replacement = `\n      /* PLAZA_PERFORMANCE_QUALITY_V3 */\n      ${bootstrapMarker}\n      // Do not compete with the authenticated home critical path. The app starts this prefetch when the main thread is idle.\n      window.__BOOTSTRAP_PLAZA_PROMISE__ = Promise.resolve(null);\n      window.__BOOTSTRAP_PLAZA_IMAGES__ = [];`;
    write(file, source.replace(pattern, replacement));
  }
}

{
  const { file, source } = read('public/app.js');
  if (!source.includes(appMarker)) {
    let next = source;
    const eagerCall = '  void prefetchStudentPlaza();';
    const deferredCall = `  ${appMarker}\n  const startPlazaPrefetch = () => { void prefetchStudentPlaza(); };\n  if ('requestIdleCallback' in window) requestIdleCallback(startPlazaPrefetch, { timeout: 900 });\n  else setTimeout(startPlazaPrefetch, 500);`;
    next = replaceOnce(next, eagerCall, deferredCall, '学生首页立即广场预取调用');

    const eagerImages = `      const preloadImages = (result.posts || []).slice(0, 4)\n        .map((post) => post.images?.[0])\n        .filter(Boolean);\n      preloadImages.forEach((image, index) => {\n        const thumbUrl = buildMediaUrl(image.thumbUrl || image.imageUrl || image.displayUrl);\n        const displayUrl = buildMediaUrl(image.displayUrl || image.imageUrl || image.thumbUrl);\n        if (!thumbUrl) return;\n        const preload = new Image();\n        preload.decoding = 'async';\n        preload.fetchPriority = index < 2 ? 'high' : 'auto';\n        preload.sizes = '(max-width: 720px) calc(50vw - 18px), 360px';\n        if (displayUrl && displayUrl !== thumbUrl) preload.srcset = \`${'${'}thumbUrl} 960w, ${'${'}displayUrl} 2048w\`;\n        preload.src = thumbUrl;\n      });`;
    const lowPriorityFirstThumb = `      const firstImage = result.posts?.[0]?.images?.[0];\n      const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';\n      if (firstUrl) {\n        void fetch(buildMediaUrl(firstUrl), {\n          credentials: 'same-origin',\n          cache: 'force-cache',\n          priority: 'low'\n        }).catch(() => null);\n      }`;
    if (next.includes(eagerImages)) next = next.replace(eagerImages, lowPriorityFirstThumb);
    next = next.replace('        hasFirstImage: Boolean(preloadImages.length),', '        hasFirstImage: Boolean(firstUrl),');

    const returnLine = '  return studentPlazaPrefetchPromise;';
    next = replaceOnce(
      next,
      returnLine,
      `  window.__BOOTSTRAP_PLAZA_PROMISE__ = studentPlazaPrefetchPromise;\n${returnLine}`,
      '广场预取Promise复用位置'
    );
    write(file, next);
  }
}

const entrance = fs.readFileSync(path.join(root, 'public/entrance.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'public/bootstrap.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
if (!entrance.includes(entranceMarker)
    || !bootstrap.includes(bootstrapMarker)
    || !app.includes(appMarker)
    || /setTimeout\(\(\) => \{[\s\S]*?uiLayer\.style\.opacity = '1'[\s\S]*?\}, 800\)/.test(entrance)
    || bootstrap.includes("fetch('/api/plaza?sort=latest&page=1&limit=20'")
    || !app.includes("requestIdleCallback(startPlazaPrefetch, { timeout: 900 })")
    || !app.includes("priority: 'low'")
    || !app.includes('window.__BOOTSTRAP_PLAZA_PROMISE__ = studentPlazaPrefetchPromise;')) {
  throw new Error('严格p95关键路径V4生成不完整');
}

console.log('Applied strict p95 critical-path V4: immediate login UI and deferred Plaza prefetch.');
