import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const version = '20260730-adminphoto2';
const markerV1 = '/* MOBILE_ADMIN_PHOTO_FIX_V1 */';
const markerV2 = '/* MOBILE_ADMIN_PHOTO_FIX_V2 */';
const privateCacheMarker = '/* PRIVATE_MEDIA_EDGE_CACHE_V2 */';

const readRequired = (relative) => {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`${relative}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};

const writeIfChanged = (file, before, after) => {
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
};

const replaceRequired = (source, pattern, replacement, label) => {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const { file, source } = readRequired('public/app.js');
  let next = source
    .replace(/const MEDIA_THUMB_MAX_SIZE_MB = (?:0\.12|0\.18);/, 'const MEDIA_THUMB_MAX_SIZE_MB = 0.12;')
    .replace(/const MEDIA_THUMB_QUALITY = (?:0\.72|0\.80|0\.82);/, 'const MEDIA_THUMB_QUALITY = 0.80;')
    .replace('点击姓名查看当天记录或进行补卡', '点击姓名查看当天打卡照片');

  const clickBlock = /  document\.querySelectorAll\('\.admin-user-tile'\)\.forEach\(\(button\) => \{\n    button\.onclick = \(\) => \{\n      const studentUser = adminDashboardState\.users\.find\(\(item\) => item\.id === button\.dataset\.id\);\n      if \(studentUser\) openAdminUserDrawer\(studentUser, date\);\n    \};\n  \}\);/;
  const clickReplacement = `  document.querySelectorAll('.admin-user-tile').forEach((button) => {
    const studentUser = adminDashboardState.users.find((item) => item.id === button.dataset.id);
    const warm = () => {
      if (studentUser) void prefetchAdminCheckinForUser(studentUser, date);
    };
    button.addEventListener('touchstart', warm, { passive: true });
    button.addEventListener('pointerdown', warm, { passive: true });
    button.onclick = () => {
      if (studentUser) openAdminUserDrawer(studentUser, date);
    };
  });
  void prefetchAdminCheckinsForUsers(result.users, date);`;
  if (!next.includes('prefetchAdminCheckinsForUsers(result.users, date)')) {
    next = replaceRequired(next, clickBlock, clickReplacement, '管理员用户卡片预取逻辑');
  }

  const drawerV2 = `${markerV2}
const ADMIN_CHECKIN_CACHE_TTL_MS = 300_000;
const ADMIN_CHECKIN_PREFETCH_LIMIT = 8;
const ADMIN_CHECKIN_PREFETCH_CONCURRENCY = 2;
const adminCheckinViewCache = new Map();
const adminCheckinInflight = new Map();
const adminCheckinImageWarmups = new Map();

const adminCheckinKey = (studentUser, date) => \`\${studentUser.id}|\${date}\`;

const adminCheckinThumbUrls = (result) => {
  const urls = [];
  (Array.isArray(result?.records) ? result.records : []).forEach((record) => {
    (Array.isArray(record.images) ? record.images : []).forEach((media) => {
      const url = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl || media.displayUrl;
      if (url) urls.push(url);
    });
  });
  return [...new Set(urls)];
};

const warmAdminThumbnail = (url) => {
  if (!url) return Promise.resolve();
  const cached = adminCheckinImageWarmups.get(url);
  if (cached && Date.now() - cached.savedAt < 900_000) return cached.promise;
  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = 'low';
  const promise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
    if (image.complete) setTimeout(finish, 0);
  });
  adminCheckinImageWarmups.set(url, { image, promise, savedAt: Date.now() });
  while (adminCheckinImageWarmups.size > 80) {
    adminCheckinImageWarmups.delete(adminCheckinImageWarmups.keys().next().value);
  }
  return promise;
};

const loadAdminCheckins = (studentUser, date) => {
  const cacheKey = adminCheckinKey(studentUser, date);
  const cached = adminCheckinViewCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < ADMIN_CHECKIN_CACHE_TTL_MS) {
    adminCheckinThumbUrls(cached.data).forEach((url) => void warmAdminThumbnail(url));
    return Promise.resolve(cached.data);
  }
  let promise = adminCheckinInflight.get(cacheKey);
  if (!promise) {
    promise = api(\`/api/admin/users/\${encodeURIComponent(studentUser.id)}/checkins?date=\${encodeURIComponent(date)}\`, { timeoutMs: 6_000 })
      .then((result) => {
        adminCheckinViewCache.set(cacheKey, { data: result, savedAt: Date.now() });
        adminCheckinThumbUrls(result).forEach((url) => void warmAdminThumbnail(url));
        return result;
      })
      .finally(() => adminCheckinInflight.delete(cacheKey));
    adminCheckinInflight.set(cacheKey, promise);
  }
  return promise;
};

function prefetchAdminCheckinForUser(studentUser, date) {
  if (!studentUser?.id) return Promise.resolve();
  return loadAdminCheckins(studentUser, date).catch(() => null);
}

function prefetchAdminCheckinsForUsers(users, date) {
  const candidates = (Array.isArray(users) ? users : [])
    .filter((item) => item?.completed)
    .slice(0, ADMIN_CHECKIN_PREFETCH_LIMIT);
  if (!candidates.length) return;
  const run = async () => {
    for (let index = 0; index < candidates.length; index += ADMIN_CHECKIN_PREFETCH_CONCURRENCY) {
      await Promise.allSettled(
        candidates.slice(index, index + ADMIN_CHECKIN_PREFETCH_CONCURRENCY)
          .map((studentUser) => prefetchAdminCheckinForUser(studentUser, date))
      );
    }
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => void run(), { timeout: 350 });
  } else {
    setTimeout(() => void run(), 80);
  }
}

function openAdminUserDrawer(studentUser, date) {
  let root = document.querySelector('#modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    app.append(root);
  }
  const cacheKey = adminCheckinKey(studentUser, date);
  const openedAt = performance.now();
  root.innerHTML = \`<div class="drawer-backdrop" id="userDrawerBackdrop">
    <section class="bottom-drawer admin-checkin-drawer" role="dialog" aria-modal="true" aria-labelledby="userDrawerTitle" data-checkin-key="\${escapeHtml(cacheKey)}">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">打卡情况</small><h2 id="userDrawerTitle">\${escapeHtml(studentUser.name)}</h2></div>
        <button class="secondary right" id="closeUserDrawer">关闭</button>
      </div>
      <div class="admin-checkin-date">\${escapeHtml(date)}</div>
      <div id="adminCheckinRecords" class="admin-checkin-records" aria-busy="true">
        <div class="admin-checkin-skeleton" aria-label="正在读取打卡照片"></div>
      </div>
    </section>
  </div>\`;

  const backdrop = root.querySelector('#userDrawerBackdrop');
  const drawer = root.querySelector('.admin-checkin-drawer');
  const recordsRoot = root.querySelector('#adminCheckinRecords');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeUserDrawer').onclick = close;
  backdrop.onclick = (event) => { if (event.target === backdrop) close(); };

  let touchStartY = null;
  drawer.addEventListener('touchstart', (event) => {
    if (event.target.closest('.drawer-handle')) touchStartY = event.touches[0].clientY;
  }, { passive: true });
  drawer.addEventListener('touchend', (event) => {
    if (touchStartY !== null && event.changedTouches[0].clientY - touchStartY > 80) close();
    touchStartY = null;
  }, { passive: true });

  const render = (result, sourceType = 'network') => {
    if (!drawer.isConnected || drawer.dataset.checkinKey !== cacheKey) return;
    const records = Array.isArray(result?.records) ? result.records : [];
    let photoIndex = 0;
    recordsRoot.setAttribute('aria-busy', 'false');
    recordsRoot.innerHTML = records.length ? records.map((record) => {
      const images = Array.isArray(record.images) ? record.images : [];
      const photos = images.map((media) => {
        const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl || media.displayUrl;
        const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
        if (!thumbUrl) return '';
        const first = photoIndex++ === 0;
        const sourceAttribute = first
          ? \`src="\${escapeHtml(thumbUrl)}"\`
          : \`data-src="\${escapeHtml(thumbUrl)}"\`;
        return \`<button type="button" class="image-viewer-trigger admin-checkin-photo"
          data-image-viewer="\${escapeHtml(thumbUrl)}" data-image-thumb="\${escapeHtml(thumbUrl)}"
          data-image-display="\${escapeHtml(displayUrl)}" data-image-alt="打卡照片">
          <span class="image-shell"><img \${sourceAttribute} loading="\${first ? 'eager' : 'lazy'}"
            fetchpriority="\${first ? 'high' : 'low'}" decoding="async" width="540" height="405"
            data-first-admin-thumb="\${first ? '1' : '0'}" alt="打卡照片"
            onload="this.parentElement.classList.add('loaded')"
            onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败，点击重试</span></span>
        </button>\`;
      }).join('');
      return \`<article class="admin-checkin-record">
        <div class="admin-checkin-record-head"><strong>\${escapeHtml(record.taskName || record.slotId || '打卡')}</strong><span class="pill done">\${escapeHtml(record.status || '已提交')}</span></div>
        \${photos ? \`<div class="admin-checkin-photo-grid">\${photos}</div>\` : '<p class="muted">暂无照片</p>'}
      </article>\`;
    }).join('') : '<p class="admin-checkin-empty">当日暂无打卡</p>';
    prepareDynamicContent(recordsRoot);
    const firstPhoto = recordsRoot.querySelector('img[data-first-admin-thumb="1"]');
    if (firstPhoto) {
      let measured = false;
      const report = () => {
        if (measured) return;
        measured = true;
        recordPerf('admin-thumb-visible', {
          duration: Math.round((performance.now() - openedAt) * 10) / 10,
          source: sourceType
        });
      };
      if (firstPhoto.complete && firstPhoto.naturalWidth) setTimeout(report, 0);
      else firstPhoto.addEventListener('load', report, { once: true });
    }
  };

  const cached = adminCheckinViewCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < ADMIN_CHECKIN_CACHE_TTL_MS) {
    render(cached.data, 'memory-cache');
    adminCheckinThumbUrls(cached.data).forEach((url) => void warmAdminThumbnail(url));
    return;
  }

  loadAdminCheckins(studentUser, date)
    .then((result) => render(result, 'network'))
    .catch((error) => {
      if (!drawer.isConnected) return;
      recordsRoot.setAttribute('aria-busy', 'false');
      recordsRoot.innerHTML = \`<div class="admin-inline-error"><p>\${escapeHtml(error.message)}</p><button type="button" id="retryAdminCheckins">重新加载</button></div>\`;
      recordsRoot.querySelector('#retryAdminCheckins').onclick = () => {
        adminCheckinViewCache.delete(cacheKey);
        openAdminUserDrawer(studentUser, date);
      };
    });
}`;

  if (next.includes(markerV1)) {
    next = replaceRequired(
      next,
      /\/\* MOBILE_ADMIN_PHOTO_FIX_V1 \*\/[\s\S]*?\n\}\n\nfunction taskFormFields/,
      `${drawerV2}\n\nfunction taskFormFields`,
      'V1管理员打卡抽屉'
    );
  } else if (!next.includes(markerV2)) {
    throw new Error('未找到管理员照片修复标记，已停止');
  }
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('cloudflare/routes/media.js');
  let next = source;
  if (!next.includes(privateCacheMarker)) {
    const privateMediaV2 = `${privateCacheMarker}
const privateMedia = async (request, env, ctx, url, mediaId) => {
  const signed = await verifyPrivateMediaRequest(env, mediaId, url.searchParams);
  if (!signed) return noLeak(403);
  const auth = await requireUser(request, env);
  if (auth.error) return noLeak(403);
  if (auth.user.id !== signed.scope
      || (signed.aud === 'admin' && auth.user.role !== 'admin')
      || (signed.aud === 'owner' && auth.user.role === 'admin')) return noLeak(403);

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('cache-control', 'private, max-age=900, immutable');
      headers.set('x-media-cache', 'HIT');
      return new Response(request.method === 'HEAD' ? null : cached.body, {
        status: cached.status,
        headers
      });
    }
  }

  const object = await env.UPLOADS.get(signed.objectKey);
  if (!object) return noLeak(404);
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, {
      status: 304,
      headers: { etag: object.httpEtag, 'cache-control': 'private, max-age=900, immutable' }
    });
  }
  const response = new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      ...mediaHeaders(object, object.httpMetadata?.contentType, 'private, max-age=900, immutable'),
      'x-media-cache': 'MISS'
    }
  });
  if (cache && request.method === 'GET') {
    const cacheCopy = response.clone();
    const cacheHeaders = new Headers(cacheCopy.headers);
    cacheHeaders.set('cache-control', 'public, max-age=900, immutable');
    cacheHeaders.set('cdn-cache-control', 'public, max-age=900');
    const cacheWrite = cache.put(cacheKey, new Response(cacheCopy.body, {
      status: cacheCopy.status,
      headers: cacheHeaders
    }));
    if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
    else await cacheWrite;
  }
  return response;
};`;
    next = replaceRequired(
      next,
      /const privateMedia = async \(request, env, url, mediaId\) => \{[\s\S]*?\n\};\n\nconst publicMedia/,
      `${privateMediaV2}\n\nconst publicMedia`,
      '私密媒体读取函数'
    );
    next = replaceRequired(
      next,
      'return privateMedia(request, env, url, decodeURIComponent(privateMatch[1]));',
      'return privateMedia(request, env, ctx, url, decodeURIComponent(privateMatch[1]));',
      '私密媒体路由调用'
    );
  }
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('scripts/backfill-admin-thumbnails-540.mjs');
  const next = source
    .replaceAll('admin-thumbs-540-v1', 'admin-thumbs-540-v2')
    .replace(/let output = await encode\(540, 84\);\n  if \(output\.data\.byteLength > 220 \* 1024\) output = await encode\(540, 76\);\n  if \(output\.data\.byteLength > 220 \* 1024\) output = await encode\(480, 72\);\n  if \(output\.data\.byteLength > 260 \* 1024\) throw new Error\('缩略图压缩后仍超过260KB'\);/,
      "let output = await encode(540, 80);\n  if (output.data.byteLength > 140 * 1024) output = await encode(540, 72);\n  if (output.data.byteLength > 140 * 1024) output = await encode(480, 68);\n  if (output.data.byteLength > 180 * 1024) throw new Error('缩略图压缩后仍超过180KB');")
    .replace("AND (t.id IS NULL OR COALESCE(t.width,0)<500 OR COALESCE(t.mime_type,'')<>'image/webp')",
      "AND (t.id IS NULL OR COALESCE(t.width,0)<500 OR COALESCE(t.mime_type,'')<>'image/webp'\n     OR COALESCE(t.object_key,'') NOT LIKE '%/admin-thumbs-540-v2/%')");
  writeIfChanged(file, source, next);
}

for (const relative of ['public/bootstrap.js', 'public/index.html', 'public/entrance.html']) {
  const { file, source } = readRequired(relative);
  const next = source.replace(/20260730-(?:flow2|adminphoto1|adminphoto2|plaza640)/g, version);
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/admin-dashboard-refactor.test.js');
  const next = source.replace(/20260730-(?:flow2|adminphoto1|adminphoto2)/g, version);
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/stage-g-observability-assets.test.js');
  const next = source.replace(/const expectedVersion = '20260730-(?:flow2|adminphoto1|adminphoto2)';/, `const expectedVersion = '${version}';`);
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/production-media-login-performance.test.js');
  const next = source
    .replace(/MEDIA_THUMB_MAX_EDGE = (?:360|540)/g, 'MEDIA_THUMB_MAX_EDGE = 540')
    .replace(/MEDIA_THUMB_QUALITY = 0\\\.(?:72|80|82)/g, 'MEDIA_THUMB_QUALITY = 0\\.80')
    .replace(/THUMB_MAX_EDGE = (?:360|540)/g, 'THUMB_MAX_EDGE = 540');
  writeIfChanged(file, source, next);
}

{
  const { file, source } = readRequired('test/member-checkin-fast.test.js');
  const replacement = `test('单人打卡展示图使用fast接口并生成540px WebP缩略图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const memberBody = app.match(
    /function memberCheckinForm\\(task\\) \\{([\\s\\S]*?)\\r?\\n\\}\\r?\\n\\r?\\nfunction materialSubmissionForm/
  )?.[1] || '';
  assert.match(memberBody, /uploadMemberCheckinFast/);
  assert.match(memberBody, /uploadCompressedImage/);
  assert.match(memberBody, /variant:\\s*'thumb'/);
  assert.match(memberBody, /parentMediaId:\\s*displayMediaId/);
  assert.match(memberBody, /正在生成540px WebP缩略图/);
  assert.match(memberBody, /const mediaIds = session\\?\\.items/);
  assert.doesNotMatch(memberBody, /readFiles/);
  assert.match(app, /const MEMBER_FAST_MAX_BYTES = 307_200/);
  assert.match(app, /const MEDIA_THUMB_MAX_EDGE = 540/);
  assert.match(app, /const MEDIA_THUMB_QUALITY = 0\\.80/);
  assert.match(app, /\\{ maxWidthOrHeight: 960, initialQuality: 0\\.76, maxSizeMB: 0\\.25 \\}/);
  assert.match(app, /\\{ maxWidthOrHeight: 960, initialQuality: 0\\.70, maxSizeMB: 0\\.30 \\}/);
  assert.match(app, /\\{ maxWidthOrHeight: 800, initialQuality: 0\\.68, maxSizeMB: 0\\.30 \\}/);
  assert.match(app, /图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。/);
});`;
  const pattern = /test\('单人打卡前端只使用fast接口、最多三轮压缩且不生成缩略图',[\s\S]*?\n\}\);/;
  let next = source;
  if (pattern.test(next)) next = next.replace(pattern, replacement);
  if (!next.includes("test('单人打卡展示图使用fast接口并生成540px WebP缩略图'")) {
    throw new Error('单人打卡测试标准更新失败');
  }
  writeIfChanged(file, source, next);
}

{
  const deploymentPath = path.join(root, 'public', 'deployment.json');
  fs.writeFileSync(deploymentPath, `${JSON.stringify({
    version,
    commit: process.env.GITHUB_SHA || 'local',
    feature: 'mobile-admin-thumb-prefetch-v2'
  }, null, 2)}\n`, 'utf8');
}

{
  const { file, source } = readRequired('public/_headers');
  const block = '/deployment.json\n  Cache-Control: no-cache, no-store, must-revalidate';
  const next = source.includes('/deployment.json')
    ? source.replace(/\/deployment\.json\n(?:  [^\n]*\n?)*/g, `${block}\n`)
    : `${source.trimEnd()}\n\n${block}\n`;
  writeIfChanged(file, source, next);
}

console.log(`Finalized mobile admin photo V2 assets: ${version}.`);
