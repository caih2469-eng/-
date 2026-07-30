(() => {
  const nativeFetch = window.fetch.bind(window);
  const BOOKMARK_KEY = 'd1Bookmark';
  const SKIPPED_THUMB_PREFIX = '/__local/performance-v3/thumb/';
  const SKIP_THUMB_BUSINESS_TYPES = new Set([
    'meal-checkin',
    'material-image',
    'member-checkin'
  ]);
  const skippedThumbIntents = new Set();
  const displayIntentBusiness = new Map();
  let pendingSkippedThumbCompression = 0;

  const readBookmark = () => {
    try { return sessionStorage.getItem(BOOKMARK_KEY) || ''; } catch { return ''; }
  };
  const rememberBookmark = (value) => {
    if (!value) return;
    try { sessionStorage.setItem(BOOKMARK_KEY, String(value).slice(0, 1024)); } catch {}
  };
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
  const requestUrl = (input) => {
    try { return new URL(input instanceof Request ? input.url : input, location.origin); }
    catch { return null; }
  };
  const requestMethod = (input, init) => String(
    init?.method || (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const requestBodyText = async (input, init) => {
    if (typeof init?.body === 'string') return init.body;
    if (input instanceof Request) {
      try { return await input.clone().text(); } catch { return ''; }
    }
    return '';
  };
  const readJsonBody = async (input, init) => {
    try { return JSON.parse(await requestBodyText(input, init)); } catch { return null; }
  };

  const installCompressionHook = () => {
    let original = window.imageCompression;
    let wrapped = null;
    const wrap = (compressor) => {
      if (typeof compressor !== 'function') return compressor;
      if (wrapped?.__originalCompressor === compressor) return wrapped;
      const next = async (file, options = {}) => {
        const maxEdge = Number(options.maxWidthOrHeight || 0);
        if (pendingSkippedThumbCompression > 0 && maxEdge > 0 && maxEdge <= 360) {
          pendingSkippedThumbCompression -= 1;
          try { options.onProgress?.(100); } catch {}
          return file;
        }
        return compressor(file, options);
      };
      Object.defineProperty(next, '__originalCompressor', { value: compressor });
      wrapped = next;
      return wrapped;
    };
    try {
      Object.defineProperty(window, 'imageCompression', {
        configurable: true,
        enumerable: true,
        get: () => wrap(original),
        set: (value) => {
          original = value;
          wrapped = null;
        }
      });
    } catch {
      if (typeof original === 'function') window.imageCompression = wrap(original);
    }
  };
  installCompressionHook();

  const localThumbResponse = async (input, init, url, method, payload = null) => {
    if (url.origin !== location.origin) return null;
    if (url.pathname === '/api/media/upload-intents' && method === 'POST') {
      const body = payload || await readJsonBody(input, init);
      const skip = body?.variant === 'thumb'
        && SKIP_THUMB_BUSINESS_TYPES.has(body?.businessType);
      if (!skip) return null;
      const intentId = `local-thumb-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
      skippedThumbIntents.add(intentId);
      return jsonResponse({
        intentId,
        uploadUrl: `${SKIPPED_THUMB_PREFIX}${encodeURIComponent(intentId)}`,
        headers: {}
      });
    }
    if (url.pathname.startsWith(SKIPPED_THUMB_PREFIX) && method === 'PUT') {
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    const confirm = url.pathname.match(/^\/api\/media\/upload-intents\/(local-thumb-[^/]+)\/confirm$/);
    if (confirm && method === 'POST' && skippedThumbIntents.has(decodeURIComponent(confirm[1]))) {
      const body = payload || await readJsonBody(input, init) || {};
      skippedThumbIntents.delete(decodeURIComponent(confirm[1]));
      if (!body.parentMediaId) return jsonResponse({ error: '缺少展示图编号' }, 400);
      return jsonResponse({ media: { id: body.parentMediaId }, skippedThumb: true });
    }
    return null;
  };

  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const isIntentRequest = url?.origin === location.origin
      && url.pathname === '/api/media/upload-intents'
      && method === 'POST';
    const isIntentConfirm = url?.origin === location.origin
      && /^\/api\/media\/upload-intents\/[^/]+\/confirm$/.test(url.pathname)
      && method === 'POST';
    const payload = isIntentRequest || isIntentConfirm
      ? await readJsonBody(input, init)
      : null;

    const local = url ? await localThumbResponse(input, init, url, method, payload) : null;
    if (local) return local;

    let requestInput = input;
    let requestInit = init;
    if (url?.origin === location.origin) {
      const headers = new Headers(
        init.headers || (input instanceof Request ? input.headers : undefined)
      );
      const bookmark = readBookmark();
      if (bookmark && !headers.has('x-d1-bookmark')) headers.set('x-d1-bookmark', bookmark);
      if (input instanceof Request) {
        requestInput = new Request(input, { ...init, headers });
        requestInit = undefined;
      } else {
        requestInit = { ...init, headers };
      }
    }

    const response = await nativeFetch(requestInput, requestInit);
    if (url?.origin === location.origin) rememberBookmark(response.headers.get('x-d1-bookmark'));

    if (response.ok && isIntentRequest && payload?.variant === 'display'
        && SKIP_THUMB_BUSINESS_TYPES.has(payload?.businessType)) {
      try {
        const result = await response.clone().json();
        if (result?.intentId) displayIntentBusiness.set(result.intentId, payload.businessType);
      } catch {}
    }
    if (response.ok && isIntentConfirm) {
      const intentId = decodeURIComponent(url.pathname.split('/').at(-2) || '');
      if (displayIntentBusiness.has(intentId)) {
        displayIntentBusiness.delete(intentId);
        pendingSkippedThumbCompression += 1;
      }
    }
    return response;
  };

  const preloadCompressor = () => {
    if (document.querySelector('link[data-compression-preload]')) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = '/vendor/browser-image-compression-2.0.2.js';
    link.dataset.compressionPreload = 'true';
    document.head.appendChild(link);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(preloadCompressor, { timeout: 1200 });
  else setTimeout(preloadCompressor, 250);
})();
