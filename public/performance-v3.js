(() => {
  const nativeFetch = window.fetch.bind(window);
  const BOOKMARK_KEY = 'd1Bookmark';
  const SKIPPED_THUMB_PREFIX = '/__local/performance-v3/thumb/';
  const skippedThumbIntents = new Set();

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

  const localThumbResponse = async (input, init, url, method) => {
    if (url.origin !== location.origin) return null;
    if (url.pathname === '/api/media/upload-intents' && method === 'POST') {
      let payload;
      try { payload = JSON.parse(await requestBodyText(input, init)); } catch { return null; }
      const skip = payload?.variant === 'thumb'
        && ['meal-checkin', 'material-image', 'member-checkin'].includes(payload?.businessType);
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
      let payload = {};
      try { payload = JSON.parse(await requestBodyText(input, init)); } catch {}
      skippedThumbIntents.delete(decodeURIComponent(confirm[1]));
      if (!payload.parentMediaId) return jsonResponse({ error: '缺少展示图编号' }, 400);
      return jsonResponse({ media: { id: payload.parentMediaId }, skippedThumb: true });
    }
    return null;
  };

  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const local = url ? await localThumbResponse(input, init, url, method) : null;
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
