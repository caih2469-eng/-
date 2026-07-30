import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content, 'utf8');

const replaceOnce = (source, search, replacement, label) => {
  const matches = typeof search === 'string'
    ? source.split(search).length - 1
    : [...source.matchAll(new RegExp(search.source, `${search.flags.includes('g') ? search.flags : `${search.flags}g`}`))].length;
  if (matches !== 1) throw new Error(`${label}: expected one match, got ${matches}`);
  return source.replace(search, replacement);
};

const insertBefore = (source, marker, addition, label) => replaceOnce(
  source,
  marker,
  `${addition}${marker}`,
  label
);

const VERSION = '20260730-perfv3';

const patchApp = () => {
  let source = read('public/app.js');

  if (!source.includes("const D1_BOOKMARK_STORAGE_KEY = 'd1Bookmark';")) {
    source = insertBefore(source, 'const apiRequest = async (url, options, method) => {', `const D1_BOOKMARK_STORAGE_KEY = 'd1Bookmark';
const readD1Bookmark = () => {
  try { return sessionStorage.getItem(D1_BOOKMARK_STORAGE_KEY) || ''; } catch { return ''; }
};
const rememberD1Bookmark = (value) => {
  if (!value) return;
  try { sessionStorage.setItem(D1_BOOKMARK_STORAGE_KEY, String(value).slice(0, 1024)); } catch {}
};

`, 'insert D1 bookmark helpers');
  }

  if (!source.includes("headers.set('x-d1-bookmark', bookmark);")) {
    source = replaceOnce(source,
      '  const body = options.body;\n  if (token && !headers.has(\'authorization\')) headers.set(\'authorization\', `Bearer ${token}`);',
      `  const body = options.body;
  const bookmark = readD1Bookmark();
  if (bookmark && !headers.has('x-d1-bookmark')) headers.set('x-d1-bookmark', bookmark);
  if (token && !headers.has('authorization')) headers.set('authorization', \`Bearer \${token}\`);`,
      'send D1 bookmark');
  }

  if (!source.includes("rememberD1Bookmark(response.headers.get('x-d1-bookmark'));")) {
    source = replaceOnce(source,
      '    return response;\n  } catch (error) {',
      `    rememberD1Bookmark(response.headers.get('x-d1-bookmark'));
    return response;
  } catch (error) {`,
      'store D1 bookmark');
  }

  source = replaceOnce(source,
    /  const webpRounds = \[[\s\S]*?\n  \];\n  let blob = null;/,
    `  const webpRounds = [
    { maxWidthOrHeight: 960, initialQuality: 0.72, maxSizeMB: 0.30 },
    { maxWidthOrHeight: 800, initialQuality: 0.66, maxSizeMB: 0.30 }
  ];
  let blob = null;`,
    'reduce member check-in compression rounds');

  const newProcessOne = `  const shouldCreateThumb = context.generateThumb !== false && context.businessType === 'task';

  const processOne = async (index) => {
    if (session.results[index]) return;
    const position = \`第 \${index + 1}/\${selected.length} 张\`;
    try {
      let display = session.partial[index]?.display;
      let thumbCompressed = session.partial[index]?.thumbCompressed;
      if (!display) {
        setStatus(\`\${position}：正在压缩 0%\`);
        const compressed = await compressImageMeasured(selected[index], {
          signal: controller.signal,
          variant: 'display',
          onProgress: (progress) => {
            const percent = Number(progress);
            if (Number.isFinite(percent)) {
              setStatus(\`\${position}：正在压缩 \${Math.max(0, Math.min(100, Math.round(percent)))}%\`);
            }
          }
        });
        const thumbCompressionPromise = shouldCreateThumb
          ? compressImageMeasured(compressed.file, {
              signal: controller.signal,
              variant: 'thumb',
              plazaThumb: true
            })
          : Promise.resolve(null);
        display = await uploadCompressedImage(compressed, {
          ...context,
          variant: 'display',
          onStage: (stage) => setStatus(\`\${position}：\${stage}\`)
        }, controller.signal);
        thumbCompressed = await thumbCompressionPromise;
        session.partial[index] = { display, thumbCompressed };
      }
      if (!shouldCreateThumb) {
        session.results[index] = display;
        session.errors.delete(index);
        return;
      }
      if (!thumbCompressed) {
        setStatus(\`\${position}：正在生成列表图片…\`);
        thumbCompressed = await compressImageMeasured(display.file, {
          signal: controller.signal,
          variant: 'thumb',
          plazaThumb: true
        });
        session.partial[index] = { display, thumbCompressed };
      }
      const thumb = await uploadCompressedImage(thumbCompressed, {
        ...context,
        variant: 'thumb',
        parentMediaId: display.mediaId,
        onStage: (stage) => setStatus(\`\${position}：\${stage}\`)
      }, controller.signal);
      session.results[index] = { ...display, thumbMediaId: thumb.mediaId };
      session.errors.delete(index);
    } catch (error) {
      if (!controller.signal.aborted) session.errors.set(index, error);
    }
  };

`;
  source = replaceOnce(source,
    /  const processOne = async \(index\) => \{[\s\S]*?\n  \};\n\n(?=  const runIndexes)/,
    newProcessOne,
    'optimize general image upload pipeline');

  if (!source.includes('const warmImageUploadRuntime = () => {')) {
    source = replaceOnce(source,
      "if (window.__BOOTSTRAP_AUTHENTICATED__) home().catch(logout);\nelse if (token) api('/api/session', { method: 'POST' }).catch(() => null).then(home).catch(logout);\nelse login();",
      `const warmImageUploadRuntime = () => {
  if (user?.role !== 'student') return;
  const warm = () => { void loadImageCompressionLibrary().catch(() => {}); };
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 1800 });
  else setTimeout(warm, 450);
};

if (window.__BOOTSTRAP_AUTHENTICATED__) home().then(warmImageUploadRuntime).catch(logout);
else if (token) api('/api/session', { method: 'POST' }).catch(() => null).then(home).then(warmImageUploadRuntime).catch(logout);
else login();`,
      'warm image compressor after student startup');
  }

  write('public/app.js', source);
};

const patchBootstrap = () => {
  const source = `(() => {
  const ASSET_VERSION = '${VERSION}';
  const D1_BOOKMARK_STORAGE_KEY = 'd1Bookmark';
  const perfEnabled = (() => {
    try {
      return new URLSearchParams(location.search).get('debugPerf') === '1'
        || localStorage.getItem('debugPerf') === '1';
    } catch {
      return false;
    }
  })();
  window.__PERF_METRICS__ = Array.isArray(window.__PERF_METRICS__) ? window.__PERF_METRICS__ : [];
  window.__RECORD_PERF__ = (type, details = {}) => {
    if (!perfEnabled) return;
    const metric = { type, at: Math.round(performance.now() * 10) / 10, ...details };
    window.__PERF_METRICS__.push(metric);
    if (window.__PERF_METRICS__.length > 500) window.__PERF_METRICS__.shift();
    console.debug('[perf]', metric);
  };
  const bootstrapStarted = performance.now();
  const assetUrl = (pathname) => \`\${pathname}?v=\${ASSET_VERSION}\`;
  const readBookmark = () => {
    try { return sessionStorage.getItem(D1_BOOKMARK_STORAGE_KEY) || ''; } catch { return ''; }
  };
  const rememberBookmark = (value) => {
    if (!value) return;
    try { sessionStorage.setItem(D1_BOOKMARK_STORAGE_KEY, String(value).slice(0, 1024)); } catch {}
  };
  const preloadScript = (pathname) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = assetUrl(pathname);
    document.head.appendChild(link);
  };
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = assetUrl('/style.css');
  document.head.appendChild(stylesheet);
  preloadScript('/site-path.js');
  preloadScript('/app.js');

  const loadScript = (pathname) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetUrl(pathname);
    script.async = false;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
  const showNetworkError = () => {
    document.querySelector('#app').innerHTML =
      '<section class="boot-shell"><div class="boot-error">网络连接失败，请检查网络后重试。<br><button type="button" id="bootRetry">重新加载</button></div></section>';
    document.querySelector('#bootRetry').onclick = () => location.reload();
  };
  const bootstrap = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let storedToken = '';
      try { storedToken = localStorage.getItem('token') || ''; } catch {}
      const bookmark = readBookmark();
      const response = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(storedToken ? { authorization: \`Bearer \${storedToken}\` } : {}),
          ...(bookmark ? { 'x-d1-bookmark': bookmark } : {})
        },
        signal: controller.signal
      });
      rememberBookmark(response.headers.get('x-d1-bookmark'));
      if (response.status === 401 || response.status === 403) {
        location.replace('/entrance');
        return;
      }
      if (!response.ok) throw new Error('session unavailable');
      const session = await response.json();
      window.__RECORD_PERF__('bootstrap-session', {
        requestId: response.headers.get('x-request-id') || '',
        status: response.status,
        duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10
      });
      window.__BOOTSTRAP_AUTHENTICATED__ = true;
      window.__BOOTSTRAP_SESSION__ = session;
      window.__BOOTSTRAP_USER__ = session.user || null;
      window.__BOOTSTRAP_DASHBOARD__ = session.dashboard || null;
      await loadScript('/site-path.js');
      await loadScript('/app.js');
      window.__RECORD_PERF__('bootstrap-complete', {
        duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10
      });
    } catch {
      showNetworkError();
    } finally {
      clearTimeout(timeout);
    }
  };
  bootstrap();
})();
`;
  write('public/bootstrap.js', source);

  let index = read('public/index.html');
  index = replaceOnce(index, /\/bootstrap\.js\?v=[^"']+/, `/bootstrap.js?v=${VERSION}`, 'bust bootstrap cache');
  write('public/index.html', index);
};

const patchWorker = () => {
  let source = read('cloudflare/worker.js');
  if (!source.includes('const createRequestDbSession = (request, env) => {')) {
    source = insertBefore(source, 'const routeRequest = async (request, env, ctx) => {', `const createRequestDbSession = (request, env) => {
  if (!env.DB || typeof env.DB.withSession !== 'function') return { requestEnv: env, session: null };
  const incoming = String(request.headers.get('x-d1-bookmark') || '').slice(0, 1024);
  const readOnly = request.method === 'GET' || request.method === 'HEAD';
  const fallback = readOnly ? 'first-unconstrained' : 'first-primary';
  let session;
  try { session = env.DB.withSession(incoming || fallback); }
  catch { session = env.DB.withSession(fallback); }
  return { requestEnv: { ...env, DB: session }, session };
};

`, 'insert D1 session wrapper');
  }
  source = replaceOnce(source,
    'const withRequestTelemetry = (response, request, id, totalDuration) => {',
    'const withRequestTelemetry = (response, request, id, totalDuration, session = null) => {',
    'extend telemetry with D1 session');
  if (!source.includes("headers.set('x-d1-bookmark', bookmark);")) {
    source = replaceOnce(source,
      "  headers.set('x-request-id', id);\n  const existingTiming",
      `  headers.set('x-request-id', id);
  const bookmark = session?.getBookmark?.();
  if (bookmark) headers.set('x-d1-bookmark', bookmark);
  const existingTiming`,
      'return D1 bookmark');
  }
  source = replaceOnce(source,
    `    beginRequestMetrics(request);
    const startedAt = performance.now();
    const id = requestId();
    const response = await routeRequest(request, env, ctx);
    return withRequestTelemetry(response, request, id, performance.now() - startedAt);`,
    `    beginRequestMetrics(request);
    const startedAt = performance.now();
    const id = requestId();
    const { requestEnv, session } = createRequestDbSession(request, env);
    const response = await routeRequest(request, requestEnv, ctx);
    return withRequestTelemetry(response, request, id, performance.now() - startedAt, session);`,
    'use request-scoped D1 session');
  write('cloudflare/worker.js', source);
};

const patchMedia = () => {
  let source = read('cloudflare/routes/media.js');

  const taskTeamPattern = /  const task = await env\.DB\.prepare\([\s\S]*?\n  const team = await teamForUser\(env, auth\.user\.id\);\n  if \(!team\) return json\(\{ error: '尚未分配队伍，不能上传队伍打卡图片' \}, 403\);/;
  const taskTeamReplacement = `  const [taskResult, teamResult] = await env.DB.batch([
    env.DB.prepare(
      \`SELECT id,track_id AS trackId,submission_type AS submissionType,
              starts_at AS startsAt,ends_at AS endsAt,schedule_json AS scheduleJson,status
         FROM tasks WHERE id=?1 LIMIT 1\`
    ).bind(taskId),
    env.DB.prepare(
      \`SELECT t.id,t.name,t.invite_code AS inviteCode,t.member_limit AS memberLimit,
              t.captain_user_id AS captainId,t.created_at AS createdAt
         FROM teams t JOIN team_members tm ON tm.team_id=t.id
        WHERE tm.user_id=?1 LIMIT 1\`
    ).bind(auth.user.id)
  ]);
  const task = taskResult.results?.[0] || null;
  if (!task || task.status !== 'published' || task.trackId !== 'interaction'
      || (task.submissionType && task.submissionType !== 'team')) {
    return json({ error: '任务不存在、已关闭或不支持队伍成员打卡' }, 404);
  }
  const team = teamResult.results?.[0] || null;
  if (!team) return json({ error: '尚未分配队伍，不能上传队伍打卡图片' }, 403);`;
  source = replaceOnce(source, taskTeamPattern, taskTeamReplacement, 'batch member fast task/team lookup');

  const intentPattern = /  await env\.DB\.prepare\(\n    `INSERT OR IGNORE INTO media_upload_intents[\s\S]*?\n  const existingMedia = await env\.DB\.prepare\([\s\S]*?\n  \)\.bind\(idempotencyKey\)\.first\(\);/;
  const intentReplacement = `  const [intentInsert, intentResult, existingMediaResult] = await env.DB.batch([
    env.DB.prepare(
      \`INSERT OR IGNORE INTO media_upload_intents
        (id,user_id,task_id,business_type,object_key,mime_type,expected_size,width,height,status,
         expires_at,created_at,updated_at)
       VALUES (?1,?2,?3,'member-checkin',?4,?5,?6,?7,?8,'pending',?9,?10,?10)\`
    ).bind(idempotencyKey, auth.user.id, task.id, objectKey, mimeType, buffer.byteLength,
      width, height, expiresAt, now),
    env.DB.prepare(
      \`SELECT id,user_id AS userId,task_id AS taskId,business_type AS businessType,
              object_key AS objectKey,mime_type AS mimeType,expected_size AS expectedSize,
              width,height,status
         FROM media_upload_intents WHERE id=?1 LIMIT 1\`
    ).bind(idempotencyKey),
    env.DB.prepare(
      \`SELECT id,owner_user_id AS ownerUserId,task_id AS taskId,business_type AS businessType,
              object_key AS objectKey,mime_type AS mimeType,file_size AS fileSize,width,height
         FROM media_objects WHERE id=?1 LIMIT 1\`
    ).bind(idempotencyKey)
  ]);
  void intentInsert;
  const intent = intentResult.results?.[0] || null;
  const existingMedia = existingMediaResult.results?.[0] || null;`;
  source = replaceOnce(source, intentPattern, intentReplacement, 'batch member fast intent/media lookup');

  const r2Pattern = /  const priorObject = await env\.UPLOADS\.head\(objectKey\);[\s\S]*?    const results = await env\.DB\.batch\(\[/;
  const r2Replacement = `  let wroteObject = false;
  try {
    const object = await env.UPLOADS.put(objectKey, buffer, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { sha256: digest, idempotencyKey }
    });
    wroteObject = true;
    if (!object || object.size !== buffer.byteLength
        || object.httpMetadata?.contentType !== mimeType
        || object.customMetadata?.sha256 !== digest) {
      throw Object.assign(new Error('R2图片校验失败，请重新上传'), { status: 409 });
    }
    const results = await env.DB.batch([`;
  source = replaceOnce(source, r2Pattern, r2Replacement, 'remove redundant member fast R2 HEAD calls');

  source = replaceOnce(source,
    "  } catch (error) {\n    if (wroteNewObject) await env.UPLOADS.delete(objectKey).catch(() => null);\n    throw error;\n  }\n};",
    `  } catch (error) {
    if (wroteObject) {
      const claimed = await env.DB.prepare(
        'SELECT 1 FROM media_objects WHERE id=?1 AND owner_user_id=?2 LIMIT 1'
      ).bind(idempotencyKey, auth.user.id).first().catch(() => null);
      if (!claimed) await env.UPLOADS.delete(objectKey).catch(() => null);
    }
    throw error;
  }
};`,
    'safe cleanup after fast upload failure');

  write('cloudflare/routes/media.js', source);
};

const patchClaims = () => {
  let materials = read('cloudflare/routes/materials.js');
  materials = replaceOnce(materials,
    `    const uploaded = await claimConfirmedMedia(
      env, mediaIds, user, task.id, 'material-image', Number(task.fileLimit)
    );`,
    `    const uploaded = await claimConfirmedMedia(
      env, mediaIds, user, task.id, 'material-image', Number(task.fileLimit), { loadThumb: false }
    );`,
    'skip material thumbnails');
  write('cloudflare/routes/materials.js', materials);

  let student = read('cloudflare/routes/student.js');
  student = replaceOnce(student,
    `    const photos = await claimConfirmedMedia(
      env, body.photoMediaIds, user, null, 'meal-checkin', 3
    );`,
    `    const photos = await claimConfirmedMedia(
      env, body.photoMediaIds, user, null, 'meal-checkin', 3, { loadThumb: false }
    );`,
    'skip meal photo thumbnails');
  student = replaceOnce(student,
    "      ? (await claimConfirmedMedia(env, [body.summaryMediaId], user, null, 'meal-checkin', 1))[0]",
    "      ? (await claimConfirmedMedia(env, [body.summaryMediaId], user, null, 'meal-checkin', 1, { loadThumb: false }))[0]",
    'skip meal summary thumbnail');
  write('cloudflare/routes/student.js', student);
};

const writeTests = () => {
  const test = `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('performance v3 propagates D1 bookmarks and preloads startup assets', () => {
  const app = source('public/app.js');
  const bootstrap = source('public/bootstrap.js');
  const worker = source('cloudflare/worker.js');
  assert.match(app, /x-d1-bookmark/);
  assert.match(bootstrap, /rel = 'preload'/);
  assert.match(bootstrap, /x-d1-bookmark/);
  assert.match(worker, /withSession/);
  assert.match(worker, /getBookmark/);
});

test('member fast upload removes redundant R2 HEAD round trips', () => {
  const media = source('cloudflare/routes/media.js');
  const section = media.slice(media.indexOf('const memberFastUpload'), media.indexOf('const rejectIntent'));
  assert.doesNotMatch(section, /UPLOADS\\.head\\(objectKey\\)/);
  assert.match(section, /UPLOADS\\.put\\(objectKey, buffer/);
  assert.match(section, /env\\.DB\\.batch/);
});

test('general uploads only create thumbs for task/plaza images', () => {
  const app = source('public/app.js');
  assert.match(app, /context\\.businessType === 'task'/);
  assert.match(app, /thumbCompressionPromise/);
  assert.match(source('cloudflare/routes/materials.js'), /material-image'[\\s\\S]*loadThumb: false/);
  assert.match(source('cloudflare/routes/student.js'), /meal-checkin'[\\s\\S]*loadThumb: false/);
});
`;
  write('test/full-performance-v3.test.js', test);
};

patchApp();
patchBootstrap();
patchWorker();
patchMedia();
patchClaims();
writeTests();

console.log('Full performance v3 patch applied.');
