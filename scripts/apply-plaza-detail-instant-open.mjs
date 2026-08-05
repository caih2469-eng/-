import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'public/app.js');
const routePath = path.join(root, 'cloudflare/routes/plaza.js');
const marker = '/* PLAZA_DETAIL_INSTANT_OPEN_V2 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes(marker)) {
  const helpers = [
    marker,
    'const readPlazaPostPreview = (postId) => {',
    '  for (const entry of plazaViewCache.values()) {',
    '    const post = entry?.data?.posts?.find((item) => item.id === postId);',
    '    if (post) return post;',
    '  }',
    '  return null;',
    '};',
    'const warmVisiblePlazaDetails = () => {',
    "  if (document.body.dataset.view !== 'plaza') return;",
    '  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};',
    "  if (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')) return;",
    "  const postIds = [...document.querySelectorAll('[data-post]')]",
    '    .slice(0, 4)',
    '    .map((card) => card.dataset.post)',
    '    .filter(Boolean);',
    '  const run = () => postIds.forEach((postId, index) => {',
    '    setTimeout(() => { void loadPlazaPost(postId).catch(() => null); }, index * 90);',
    '  });',
    "  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 900 });",
    '  else setTimeout(run, 120);',
    '};',
    'const installPlazaDetailIntentPrefetch = () => {',
    "  if (document.documentElement.dataset.plazaDetailPrefetch === 'v2') return;",
    "  document.documentElement.dataset.plazaDetailPrefetch = 'v2';",
    '  const prefetch = (event) => {',
    "    if (document.body.dataset.view !== 'plaza') return;",
    "    const card = event.target?.closest?.('[data-post]');",
    '    const postId = card?.dataset?.post;',
    '    if (postId) void loadPlazaPost(postId).catch(() => null);',
    '  };',
    "  document.addEventListener('pointerdown', prefetch, { passive: true, capture: true });",
    "  document.addEventListener('pointerover', prefetch, { passive: true });",
    "  document.addEventListener('focusin', prefetch);",
    '};',
    'installPlazaDetailIntentPrefetch();',
    ''
  ].join('\n');

  app = replaceOnce(
    app,
    'const clearUserViewCaches = () => {',
    `${helpers}const clearUserViewCaches = () => {`,
    '活动广场详情即时打开辅助函数位置'
  );

  app = replaceOnce(
    app,
    '  const cachedEntry = plazaPostCache.get(cacheKey);\n  const detailCacheHit = Boolean(',
    '  const cachedEntry = plazaPostCache.get(cacheKey);\n  const previewPost = readPlazaPostPreview(postId);\n  const detailCacheHit = Boolean(',
    '活动广场详情预览读取位置'
  );

  app = replaceOnce(
    app,
    `  root.innerHTML = \`<div class="modal-backdrop"><section class="card modal plaza-detail" aria-busy="true">\n    <div class="row"><h2>正在读取作品…</h2><button class="secondary right" id="closePost">关闭</button></div>\n    <div class="plaza-detail-placeholder"></div>\n  </section></div>\`;`,
    `  const previewImage = previewPost?.images?.[0];\n  root.innerHTML = previewPost ? \`<div class="modal-backdrop"><section class="card modal plaza-detail" aria-busy="true">\n    <div class="row"><div><span class="eyebrow dark">\${escapeHtml(previewPost.taskName || '')}</span><h2>\${escapeHtml(previewPost.teamName || '')}</h2></div><button class="secondary right" id="closePost">关闭</button></div>\n    <p class="muted">正在补齐成员与全部图片…</p>\n    <div class="plaza-photos">\${previewImage ? \`<button class="image-viewer-trigger" data-image-viewer="\${escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" data-image-thumb="\${escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" data-image-display="\${escapeHtml(previewImage.displayUrl || previewImage.imageUrl)}" data-image-alt="活动图片"><div class="image-shell"><img data-perf-image="plaza-detail-thumb" data-priority="high" loading="eager" decoding="async" fetchpriority="high" width="640" height="480" src="\${escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" alt="活动图片" onload="this.parentElement.classList.add('loaded')" onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败</span></div></button>\` : ''}</div>\n    <p>\${escapeHtml(previewPost.copy || '')}</p>\n    <div class="row"><span class="muted">\${formatDate(previewPost.publishedAt)} · 浏览 \${Number(previewPost.viewCount || 0)} · 评论 \${Number(previewPost.commentCount || 0)}</span><button class="secondary right" disabled>点赞 \${Number(previewPost.likeCount || 0)}</button></div>\n    <section class="comments-panel"><h3>评论</h3><div><p class="muted comments-loading">详情与评论加载中…</p></div></section>\n  </section></div>\` : \`<div class="modal-backdrop"><section class="card modal plaza-detail" aria-busy="true">\n    <div class="row"><h2>正在读取作品…</h2><button class="secondary right" id="closePost">关闭</button></div>\n    <div class="plaza-detail-placeholder"></div>\n  </section></div>\`;`,
    '活动广场详情即时预览界面'
  );

  app = replaceOnce(
    app,
    "  root.querySelector('#closePost').onclick = closePost;\n\n  const commentsPromise = api(`/api/plaza/${postId}/comments?page=1&limit=10`)\n    .then((result) => ({ result, error: null }))\n    .catch((error) => ({ result: null, error }));",
    "  prepareDynamicContent(root);\n  root.querySelector('#closePost').onclick = closePost;\n  if (previewPost) recordPerf('plaza-detail-preview-visible', { duration: roundedDuration(detailStartedAt), postId });\n\n  let commentsPromise = null;",
    '活动广场评论请求让出详情关键路径'
  );

  app = replaceOnce(
    app,
    '            data-src="${escapeHtml(image.thumbUrl || image.imageUrl)}" alt="活动图片"',
    '            ${imageIndex === 0 ? \'src\' : \'data-src\'}="${escapeHtml(image.thumbUrl || image.imageUrl)}" alt="活动图片"',
    '活动广场详情首图立即请求'
  );

  app = replaceOnce(
    app,
    `  recordPerf('plaza-detail-visible', {\n    duration: roundedDuration(detailStartedAt),\n    cacheHit: detailCacheHit,\n    postId\n  });`,
    `  recordPerf('plaza-detail-visible', {\n    duration: roundedDuration(detailStartedAt),\n    cacheHit: detailCacheHit,\n    previewHit: Boolean(previewPost),\n    postId\n  });\n  commentsPromise = api(\`/api/plaza/\${postId}/comments?page=1&limit=10\`)\n    .then((result) => ({ result, error: null }))\n    .catch((error) => ({ result: null, error }));`,
    '活动广场详情显示后加载评论'
  );

  app = replaceOnce(
    app,
    '  prepareDynamicContent(app);\n  requestAnimationFrame(rebalancePlazaColumns);',
    '  prepareDynamicContent(app);\n  requestAnimationFrame(() => { rebalancePlazaColumns(); warmVisiblePlazaDetails(); });',
    '活动广场首屏详情空闲预取'
  );

  fs.writeFileSync(appPath, app, 'utf8');
}

let route = fs.readFileSync(routePath, 'utf8');
if (!route.includes(marker)) {
  route = replaceOnce(
    route,
    '  const [members, images, counts, liked] = await Promise.all([',
    `  ${marker}\n  const [members, images, counts] = await Promise.all([`,
    '活动广场详情查询并发声明'
  );
  route = replaceOnce(
    route,
    `       (SELECT COUNT(*) FROM plaza_comments WHERE post_id=?1 AND status='visible') AS comments,\n       (SELECT COUNT(*) FROM plaza_likes\n         WHERE user_id=?2 AND date(liked_at,'+8 hours')=?3) AS userLikesToday`,
    `       (SELECT COUNT(*) FROM plaza_comments WHERE post_id=?1 AND status='visible') AS comments,\n       EXISTS(SELECT 1 FROM plaza_likes WHERE post_id=?1 AND user_id=?2) AS liked,\n       (SELECT COUNT(*) FROM plaza_likes\n         WHERE user_id=?2 AND date(liked_at,'+8 hours')=?3) AS userLikesToday`,
    '活动广场详情点赞状态合并查询'
  );
  route = replaceOnce(
    route,
    `    ).bind(post.id, userId || '', shanghaiDate()).first(),\n    userId ? env.DB.prepare(\n    'SELECT 1 AS liked FROM plaza_likes WHERE post_id=?1 AND user_id=?2'\n    ).bind(post.id, userId).first() : Promise.resolve(null)`,
    `    ).bind(post.id, userId || '', shanghaiDate()).first()`,
    '活动广场详情独立点赞查询移除'
  );
  route = replaceOnce(
    route,
    '    liked: Boolean(liked)',
    '    liked: Boolean(counts.liked)',
    '活动广场详情点赞状态读取'
  );
  fs.writeFileSync(routePath, route, 'utf8');
}

app = fs.readFileSync(appPath, 'utf8');
route = fs.readFileSync(routePath, 'utf8');
if (!app.includes(marker)
    || !app.includes('readPlazaPostPreview')
    || !app.includes("recordPerf('plaza-detail-preview-visible'")
    || !app.includes('warmVisiblePlazaDetails')
    || !app.includes("document.addEventListener('pointerdown', prefetch")
    || !app.includes("imageIndex === 0 ? 'src' : 'data-src'")
    || !route.includes(marker)
    || !route.includes('AS liked')
    || route.includes('const [members, images, counts, liked]')) {
  throw new Error('活动广场详情即时打开优化生成不完整');
}

console.log('Applied instant plaza detail preview, intent prefetch, critical-path comment deferral and merged detail counts.');
