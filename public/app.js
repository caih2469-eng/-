const app = document.querySelector('#app');
let token = '';
let user = window.__BOOTSTRAP_USER__ || null;
try {
  token = localStorage.getItem('token') || '';
  if (!user) user = JSON.parse(localStorage.getItem('user') || 'null');
} catch {
  // Restricted WebViews can deny localStorage; the HttpOnly session cookie remains authoritative.
}
let config;
let tracks = [];
let materialAdminPage = 1;
let materialAdminCampus = '';
let adminUserPage = Number(sessionStorage.adminUserPage || 1);
let adminUserFilter = sessionStorage.adminUserFilter || 'all';
let adminUserQuery = sessionStorage.adminUserQuery || '';
let adminCompletionTrack = sessionStorage.adminCompletionTrack || 'all';
let scrollSaveTimer;
let navigationEpoch = 0;
let midnightRefreshTimer = null;
let studentDashboardDirty = false;
const inflightGetRequests = new Map();
let imageCompressionLibraryPromise = null;
const studentViewState = {
  userId: null,
  data: null,
  renderedAt: 0,
  scrollY: 0,
  dirty: true,
  refreshPromise: null,
  refreshError: null
};
const VIEW_CACHE_TTL_MS = 20_000;
const plazaViewCache = new Map();
const rankingViewCache = new Map();
const countedPlazaViews = new Set();
let plazaModalEpoch = 0;
const recordPerf = (type, details = {}) => {
  window.__RECORD_PERF__?.(type, details);
};
const metricPath = (value) => {
  try {
    const parsed = new URL(value, location.origin);
    return parsed.origin === location.origin ? parsed.pathname : 'r2-presigned-put';
  } catch {
    return 'unknown';
  }
};
const roundedDuration = (startedAt) => Math.round((performance.now() - startedAt) * 10) / 10;

const scopedCacheKey = (...parts) => [
  user?.id || user?.studentId || 'anonymous',
  ...parts.map((part) => String(part ?? ''))
].join('|');
const readViewCache = (cache, key) => cache.get(key) || null;
const writeViewCache = (cache, key, data) => {
  cache.set(key, { data, savedAt: Date.now() });
  return data;
};
const cacheIsFresh = (entry) => Boolean(
  entry && Date.now() - entry.savedAt <= VIEW_CACHE_TTL_MS
);
const clearUserViewCaches = () => {
  plazaViewCache.clear();
  rankingViewCache.clear();
  countedPlazaViews.clear();
};

const beginNavigation = () => {
  if (document.body.dataset.view === 'student') studentViewState.scrollY = window.scrollY;
  navigationEpoch += 1;
  return navigationEpoch;
};
const isCurrentNavigation = (epoch) => epoch === navigationEpoch;

window.addEventListener('scroll', () => {
  if (document.body.dataset.view !== 'admin') return;
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => { sessionStorage.adminScrollY = String(window.scrollY); }, 80);
}, { passive: true });

const lazyImageObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const image = entry.target;
      if (image.dataset.src) {
        image.src = buildMediaUrl(image.dataset.src);
        image.removeAttribute('data-src');
      }
      observer.unobserve(image);
    });
  }, { rootMargin: '240px 0px' })
  : null;

const prepareDynamicContent = (container = app) => {
  container.querySelectorAll('table').forEach((table) => {
    if (table.dataset.mobileReady) return;
    const labels = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName === 'TD') cell.dataset.label = labels[index] || '';
      });
    });
    table.dataset.mobileReady = 'true';
  });
  container.querySelectorAll('img').forEach((image) => {
    if (image.dataset.dynamicReady) return;
    image.dataset.dynamicReady = 'true';
    image.loading = image.dataset.priority === 'high' ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.fetchPriority = image.dataset.priority === 'high' ? 'high' : 'low';
    if (image.dataset.src) {
      if (image.dataset.priority === 'high' || !lazyImageObserver) {
        image.src = buildMediaUrl(image.dataset.src);
        image.removeAttribute('data-src');
      } else {
        lazyImageObserver.observe(image);
      }
    }
  });
};

let activeImageViewer = null;
let imageViewerCloseTimer = null;
const closeImageViewer = (fromHistory = false) => {
  if (!activeImageViewer) return;
  activeImageViewer.remove();
  activeImageViewer = null;
  clearTimeout(imageViewerCloseTimer);
  if (!fromHistory && history.state?.imageViewer) history.back();
};
window.addEventListener('popstate', () => {
  if (activeImageViewer) closeImageViewer(true);
});

const openImageViewer = (thumbSrc, displaySrc, alt = '查看图片', renderedImage = null) => {
  if (activeImageViewer) closeImageViewer(true);
  const renderedThumb = renderedImage?.complete && renderedImage.naturalWidth
    ? (renderedImage.currentSrc || renderedImage.src)
    : '';
  const thumb = renderedThumb || buildMediaUrl(thumbSrc || displaySrc);
  const display = buildMediaUrl(displaySrc || thumbSrc);
  const viewer = document.createElement('div');
  viewer.className = 'image-viewer';
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.innerHTML = `
    <div class="image-viewer-stage" aria-label="单击返回上一层"><div class="image-shell"><img decoding="async" src="${escapeHtml(thumb)}" alt="${escapeHtml(alt)}"><button type="button" class="image-error" hidden>图片加载失败，点击重试</button></div></div>`;
  document.body.appendChild(viewer);
  activeImageViewer = viewer;
  history.pushState({ ...(history.state || {}), imageViewer: true }, '');
  const stage = viewer.querySelector('.image-viewer-stage');
  const image = viewer.querySelector('img');
  const retry = viewer.querySelector('.image-error');
  let manualRetryUsed = false;
  const markLoaded = () => {
    image.parentElement.classList.add('loaded');
    image.parentElement.classList.remove('failed');
    retry.hidden = true;
  };
  const markFailed = () => {
    image.parentElement.classList.add('failed');
    retry.hidden = false;
  };
  image.addEventListener('load', markLoaded);
  image.addEventListener('error', markFailed);
  if (image.complete && image.naturalWidth) markLoaded();
  if (display && display !== thumb) {
    const displayImage = new Image();
    displayImage.decoding = 'async';
    displayImage.fetchPriority = 'high';
    displayImage.onload = async () => {
      try { await displayImage.decode(); } catch {}
      if (!activeImageViewer || !viewer.isConnected) return;
      image.src = displayImage.currentSrc || display;
      image.dataset.displayLoaded = 'true';
    };
    displayImage.onerror = markFailed;
    displayImage.src = display;
  }
  retry.addEventListener('click', (event) => {
    event.stopPropagation();
    if (manualRetryUsed) return;
    manualRetryUsed = true;
    retry.hidden = true;
    image.src = `${display}${display.includes('?') ? '&' : '?'}retry=1`;
  });
  let pointerStart = null;
  let moved = false;
  stage.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.clientX, y: event.clientY };
    moved = false;
  }, { passive: true });
  stage.addEventListener('pointermove', (event) => {
    if (!pointerStart) return;
    moved ||= Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8;
  }, { passive: true });
  stage.addEventListener('pointerup', () => {
    pointerStart = null;
    if (moved) return;
    clearTimeout(imageViewerCloseTimer);
    imageViewerCloseTimer = setTimeout(() => closeImageViewer(), 220);
  }, { passive: true });
  stage.addEventListener('dblclick', (event) => {
    clearTimeout(imageViewerCloseTimer);
    event.preventDefault();
  });
};

app.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-image-viewer]');
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  openImageViewer(
    trigger.dataset.imageThumb || trigger.dataset.imageViewer,
    trigger.dataset.imageDisplay || trigger.dataset.imageViewer,
    trigger.dataset.imageAlt || '查看图片',
    trigger.querySelector('img')
  );
});

const openDialog = ({ title, message = '', input = false, inputLabel = '', value = '', danger = false,
  cancelText = '取消', confirmText = '确定', notice = false }) => new Promise((resolve) => {
  const shell = document.createElement('div');
  shell.className = 'app-dialog-backdrop';
  shell.innerHTML = `<section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle">
    <h2 id="appDialogTitle">${escapeHtml(title)}</h2>
    ${message ? `<p>${escapeHtml(message)}</p>` : ''}
    ${input ? `<label>${escapeHtml(inputLabel)}</label><input id="appDialogInput" value="${escapeHtml(value)}">` : ''}
    <div class="app-dialog-actions">
      ${notice ? '' : `<button class="secondary" data-dialog-cancel>${escapeHtml(cancelText)}</button>`}
      <button class="${danger ? 'danger' : ''}" data-dialog-confirm>${escapeHtml(confirmText)}</button>
    </div>
  </section>`;
  document.body.append(shell);
  const close = (result) => {
    shell.classList.add('closing');
    setTimeout(() => shell.remove(), 180);
    resolve(result);
  };
  shell.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
  shell.querySelector('[data-dialog-confirm]').addEventListener('click', () => {
    close(input ? shell.querySelector('#appDialogInput').value.trim() : true);
  });
  shell.addEventListener('click', (event) => { if (event.target === shell && !notice) close(false); });
  shell.querySelector('input')?.focus();
});

const alert = (message) => { void openDialog({ title: '提示', message: String(message), notice: true, confirmText: '知道了' }); };
const askConfirm = (title, message, options = {}) => openDialog({ title, message, danger: true, ...options });
const askText = (title, message, inputLabel) => openDialog({
  title, message, input: true, inputLabel, cancelText: '取消', confirmText: '确定'
});
const showToast = (message, tone = 'success', duration = 3000) => {
  let region = document.querySelector('#appToastRegion');
  if (!region) {
    region = document.createElement('div');
    region.id = 'appToastRegion';
    region.className = 'toast-region';
    region.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
  }
  const toast = document.createElement('div');
  toast.className = `app-toast ${tone}`;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.textContent = String(message);
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 180);
  }, Math.min(4000, Math.max(2000, duration)));
};
const beginButtonLoading = (button, text = '处理中…') => {
  if (!button || button.dataset.loading === 'true') return () => {};
  const originalText = button.textContent;
  button.dataset.loading = 'true';
  button.disabled = true;
  button.textContent = text;
  return () => {
    button.dataset.loading = 'false';
    button.disabled = false;
    button.textContent = originalText;
  };
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isJsonString = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

const parseApiResponse = async (response) => {
  if (response.status === 204 || response.status === 205) return {};
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!text) return {};
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('服务器暂时无法响应，请稍后重试。');
    }
  }
  if (!response.ok || contentType.includes('text/html')) {
    throw new Error('服务器暂时无法响应，请稍后重试。');
  }
  return text;
};

const apiRequest = async (url, options, method) => {
  const { timeoutMs: requestedTimeout, ...fetchOptions } = options;
  const headers = new Headers(options.headers || {});
  const body = options.body;
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  if (body != null && !headers.has('content-type') && isJsonString(body)) {
    headers.set('content-type', 'application/json');
  }

  const timeoutMs = Number(requestedTimeout)
    || (method === 'GET' || method === 'HEAD' ? 12_000 : 30_000);
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      method,
      headers,
      credentials: 'same-origin',
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (timedOut) throw new Error('网络响应超时，请稍后重试。');
    if (options.signal?.aborted) throw new Error('操作已取消，请重试。');
    throw new Error('网络连接失败，请检查网络后重试。');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener?.('abort', forwardAbort);
  }
};

const executeApi = async (url, options, method) => {
  const retryableMethod = method === 'GET' || method === 'HEAD';
  const startedAt = performance.now();
  let retryCount = 0;
  let status = 0;
  let requestId = '';
  try {
    for (let attempt = 0; attempt < (retryableMethod ? 2 : 1); attempt += 1) {
      retryCount = attempt;
      let response;
      try {
        response = await apiRequest(url, options, method);
      } catch (error) {
        if (!retryableMethod || attempt > 0 || !/网络连接失败/.test(error.message)) throw error;
        await wait(300 + Math.floor(Math.random() * 301));
        continue;
      }
      status = response.status;
      requestId = response.headers.get('x-request-id') || '';
      if (attempt === 0 && retryableMethod && [502, 503, 504].includes(response.status)) {
        await wait(300 + Math.floor(Math.random() * 301));
        continue;
      }
      const result = await parseApiResponse(response);
      if (!response.ok) {
        const fallback = [502, 503, 504].includes(response.status)
          ? '服务器暂时无法响应，请稍后重试。'
          : '操作失败，请稍后重试。';
        throw new Error(result?.error || fallback);
      }
      return result;
    }
    throw new Error('服务器暂时无法响应，请稍后重试。');
  } finally {
    recordPerf('request', {
      requestId,
      method,
      path: metricPath(url),
      status,
      retryCount,
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};

const api = (path, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const url = normalizeSitePath(path);
  const requestOptions = { ...options };
  delete requestOptions.timeoutMs;
  if (method !== 'GET' && method !== 'HEAD') {
    return executeApi(url, { ...requestOptions, timeoutMs: options.timeoutMs }, method);
  }

  const requestKey = `${user?.id || user?.studentId || 'anonymous'}|${method}|${url}`;
  const existing = inflightGetRequests.get(requestKey);
  if (existing) return existing;
  const request = executeApi(url, { ...requestOptions, timeoutMs: options.timeoutMs }, method)
    .finally(() => inflightGetRequests.delete(requestKey));
  inflightGetRequests.set(requestKey, request);
  return request;
};

const loadImageCompressionLibrary = () => {
  if (typeof window.imageCompression === 'function') return Promise.resolve(window.imageCompression);
  if (imageCompressionLibraryPromise) return imageCompressionLibraryPromise;
  imageCompressionLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-image-compression-library]');
    const script = existing || document.createElement('script');
    const handleLoad = () => {
      if (typeof window.imageCompression === 'function') resolve(window.imageCompression);
      else reject(new Error('图片处理组件加载失败，请刷新后重试。'));
    };
    const handleError = () => reject(new Error('图片处理组件加载失败，请刷新后重试。'));
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.src = '/vendor/browser-image-compression-2.0.2.js';
      script.async = true;
      script.dataset.imageCompressionLibrary = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    imageCompressionLibraryPromise = null;
    throw error;
  });
  return imageCompressionLibraryPromise;
};

const uploadBinary = async (url, options = {}) => {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  let status = 0;
  let requestId = '';
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    status = response.status;
    requestId = response.headers.get('x-request-id') || '';
    return response;
  } catch {
    if (timedOut) throw new Error('图片上传超时，请检查网络后重试。');
    if (options.signal?.aborted) throw new Error('图片上传已取消，请重新选择图片。');
    throw new Error('网络连接失败，请检查网络后重试。');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener?.('abort', forwardAbort);
    recordPerf('upload', {
      requestId,
      method: String(options.method || 'GET').toUpperCase(),
      path: metricPath(url),
      status,
      retryCount: 0,
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};

const escapeHtml = (value) =>
  String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

const MEDIA_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MEDIA_THUMB_MAX_EDGE = 360;
const MEDIA_PLAZA_THUMB_MAX_EDGE = 640;
const MEDIA_DISPLAY_MAX_EDGE = 960;
const MEDIA_THUMB_MAX_SIZE_MB = 0.12;
const MEDIA_PLAZA_THUMB_MAX_SIZE_MB = 0.18;
const MEDIA_DISPLAY_MAX_SIZE_MB = 0.7;
const MEDIA_THUMB_QUALITY = 0.72;
const MEDIA_PLAZA_THUMB_QUALITY = 0.84;
const MEDIA_DISPLAY_QUALITY = 0.78;
const MEMBER_FAST_MAX_BYTES = 307_200;
const MEMBER_FAST_MAX_EDGE = 960;
const MEDIA_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const mediaPreviewUrls = new Set();
const mediaUploadSessions = new Set();

const detectImageMime = (bytes) => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  const pngSignature = [...bytes.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (pngSignature === '89504e470d0a1a0a') return 'image/png';

  const prefix = new TextDecoder().decode(bytes.slice(0, 4));
  const webp = new TextDecoder().decode(bytes.slice(8, 12));
  if (prefix === 'RIFF' && webp === 'WEBP') return 'image/webp';

  return '';
};

const bytesMatchMime = (bytes, type) => detectImageMime(bytes) === type;

const normalizeSourceImage = async (file) => {
  if (file.size > MEDIA_MAX_SOURCE_BYTES) {
    throw new Error('单张图片不能超过5MB，请压缩或重新选择图片。');
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedType = detectImageMime(header);
  if (!detectedType || !MEDIA_ALLOWED_TYPES.has(detectedType)) {
    const reportedType = String(file.type || '').toLowerCase();
    const heicLike = reportedType.includes('heic') || reportedType.includes('heif')
      || /\.(heic|heif)$/i.test(file.name);
    throw new Error(heicLike
      ? '当前设备无法稳定处理HEIC，请改用JPG、PNG或WebP。'
      : '无法识别图片真实格式，请重新截图或另存为JPG后上传。');
  }

  if (file.type === detectedType) return file;

  // 微信/QQ可能把PNG或WebP文件错误标记成JPG。按真实文件头修正MIME，
  // 后续压缩仍统一输出WebP或JPEG，服务端校验规则保持不变。
  return new File([file], file.name, {
    type: detectedType,
    lastModified: file.lastModified || Date.now()
  });
};

const imageDimensions = async (blob) => {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('图片处理失败，请重新选择图片。'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

const compressImage = async (file, options = {}) => {
  const sourceFile = await normalizeSourceImage(file);
  const imageCompression = await loadImageCompressionLibrary();
  const isThumb = options.variant === 'thumb';
  const isPlazaThumb = isThumb && options.plazaThumb === true;
  const maxSizeMB = isPlazaThumb
    ? MEDIA_PLAZA_THUMB_MAX_SIZE_MB
    : (isThumb ? MEDIA_THUMB_MAX_SIZE_MB : MEDIA_DISPLAY_MAX_SIZE_MB);
  const maxWidthOrHeight = isPlazaThumb
    ? MEDIA_PLAZA_THUMB_MAX_EDGE
    : (isThumb ? MEDIA_THUMB_MAX_EDGE : MEDIA_DISPLAY_MAX_EDGE);
  const initialQuality = isPlazaThumb
    ? MEDIA_PLAZA_THUMB_QUALITY
    : (isThumb ? MEDIA_THUMB_QUALITY : MEDIA_DISPLAY_QUALITY);
  const common = {
    maxSizeMB,
    maxWidthOrHeight,
    initialQuality,
    useWebWorker: true,
    libURL: `${location.origin}/vendor/browser-image-compression-2.0.2.js`,
    preserveExif: false,
    signal: options.signal,
    onProgress: options.onProgress
  };
  let blob = await imageCompression(sourceFile, { ...common, fileType: 'image/webp' });
  let header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (blob.type !== 'image/webp' || !bytesMatchMime(header, 'image/webp')) {
    blob = await imageCompression(sourceFile, {
      ...common,
      fileType: 'image/jpeg',
      initialQuality
    });
    header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (blob.type !== 'image/jpeg' || !bytesMatchMime(header, 'image/jpeg')) {
      throw new Error('当前浏览器无法稳定生成压缩图片，请改用JPG后重试。');
    }
  }
  if (!blob.size || blob.size > 1.5 * 1024 * 1024) throw new Error('压缩后图片仍然过大，请重新选择图片。');
  const dimensions = await imageDimensions(blob);
  if (!dimensions.width || !dimensions.height || Math.max(dimensions.width, dimensions.height) > maxWidthOrHeight) {
    throw new Error('压缩图片尺寸校验失败，请重新选择图片。');
  }
  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const finalFile = new File([blob], `${sourceFile.name.replace(/\.[^.]+$/, '')}.${extension}`, {
    type: blob.type,
    lastModified: Date.now()
  });
  const previewUrl = URL.createObjectURL(finalFile);
  mediaPreviewUrls.add(previewUrl);
  return { file: finalFile, mimeType: finalFile.type, width: dimensions.width, height: dimensions.height, previewUrl };
};

const compressImageMeasured = async (file, options = {}) => {
  const startedAt = performance.now();
  let output = null;
  try {
    output = await compressImage(file, options);
    return output;
  } finally {
    recordPerf('compress', {
      variant: options.variant || 'display',
      sourceBytes: Number(file?.size || 0),
      outputBytes: Number(output?.file?.size || 0),
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};

const compressMemberCheckinImage = async (file, options = {}) => {
  const sourceFile = await normalizeSourceImage(file);
  const imageCompression = await loadImageCompressionLibrary();
  const webpRounds = [
    { maxWidthOrHeight: 960, initialQuality: 0.76, maxSizeMB: 0.25 },
    { maxWidthOrHeight: 960, initialQuality: 0.70, maxSizeMB: 0.30 },
    { maxWidthOrHeight: 800, initialQuality: 0.68, maxSizeMB: 0.30 }
  ];
  let blob = null;
  let webpEncodingFailed = false;
  for (let index = 0; index < webpRounds.length; index += 1) {
    if (index > 0 && blob?.size <= MEMBER_FAST_MAX_BYTES) break;
    try {
      blob = await imageCompression(sourceFile, {
        ...webpRounds[index],
        maxIteration: 1,
        useWebWorker: true,
        libURL: `${location.origin}/vendor/browser-image-compression-2.0.2.js`,
        preserveExif: false,
        fileType: 'image/webp',
        signal: options.signal,
        onProgress: options.onProgress
      });
      const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      if (blob.type !== 'image/webp' || !bytesMatchMime(header, 'image/webp')) {
        webpEncodingFailed = true;
        break;
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      webpEncodingFailed = true;
      break;
    }
  }

  if (webpEncodingFailed) {
    if (sourceFile.type === 'image/png') {
      throw new Error('当前浏览器无法稳定生成WebP，请将图片另存为JPG或重新截图后上传。');
    }
    blob = await imageCompression(sourceFile, {
      maxWidthOrHeight: MEMBER_FAST_MAX_EDGE,
      initialQuality: 0.76,
      maxSizeMB: 0.30,
      maxIteration: 1,
      useWebWorker: true,
      libURL: `${location.origin}/vendor/browser-image-compression-2.0.2.js`,
      preserveExif: false,
      fileType: 'image/jpeg',
      signal: options.signal,
      onProgress: options.onProgress
    });
    const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (blob.type !== 'image/jpeg' || !bytesMatchMime(header, 'image/jpeg')) {
      throw new Error('当前浏览器无法稳定处理图片，请将图片另存为JPG或重新截图后上传。');
    }
  }

  if (!blob?.size || blob.size > MEMBER_FAST_MAX_BYTES) {
    throw new Error('图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。');
  }
  const dimensions = await imageDimensions(blob);
  if (!dimensions.width || !dimensions.height
      || Math.max(dimensions.width, dimensions.height) > MEMBER_FAST_MAX_EDGE) {
    throw new Error('压缩图片尺寸校验失败，请重新选择图片。');
  }
  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const finalFile = new File([blob], `${sourceFile.name.replace(/\.[^.]+$/, '')}.${extension}`, {
    type: blob.type,
    lastModified: Date.now()
  });
  return {
    file: finalFile,
    mimeType: finalFile.type,
    width: dimensions.width,
    height: dimensions.height
  };
};

const createIdempotencyKey = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const uploadMemberCheckinFast = async (image, taskId, idempotencyKey, signal) => {
  let response;
  try {
    response = await uploadBinary('/api/media/member-checkin-fast', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': image.mimeType,
        'X-Task-Id': taskId,
        'X-Image-Width': String(image.width),
        'X-Image-Height': String(image.height),
        'X-Idempotency-Key': idempotencyKey
      },
      body: image.file,
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('图片上传失败，请检查网络后点击重试。');
  }
  const payload = await parseApiResponse(response);
  if (!response.ok) {
    if ([500, 501, 502, 503, 504].includes(response.status)) {
      throw new Error('上传服务暂时不可用，请稍后重试。');
    }
    throw new Error(payload?.error || '图片上传失败，请点击重试。');
  }
  if (!payload?.media?.id) throw new Error('上传服务返回的数据无效，请点击重试。');
  return { ...image, mediaId: payload.media.id, repeated: Boolean(payload.repeated) };
};

const uploadCompressedImage = async (image, context, signal) => {
  context.onStage?.('正在申请上传地址…');
  const intent = await api('/api/media/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      taskId: context.taskId || null,
      businessType: context.businessType,
      mimeType: image.mimeType,
      fileSize: image.file.size,
      width: image.width,
      height: image.height,
      variant: context.variant || 'display'
    })
  });
  context.onStage?.('正在上传图片…');
  const uploaded = await uploadBinary(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: image.file,
    signal
  });
  if (!uploaded.ok) throw new Error(`图片直传失败（${uploaded.status}），请重新选择图片。`);
  context.onStage?.('正在确认图片…');
  const confirmed = await api(`/api/media/upload-intents/${encodeURIComponent(intent.intentId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ parentMediaId: context.parentMediaId || null })
  });
  return { ...image, mediaId: confirmed.media.id };
};

const uploadConcurrency = () => {
  const isIOS = /iP(?:hone|ad|od)/.test(navigator.userAgent);
  const embeddedBrowser = /MicroMessenger|QQ\//i.test(navigator.userAgent);
  const lowMemory = Number(navigator.deviceMemory || 8) <= 4;
  return isIOS || embeddedBrowser || lowMemory ? 1 : 2;
};

const createMediaUploadSession = (files, context = {}, ui = {}) => {
  const previewStartedAt = performance.now();
  const selected = [...files];
  if (!selected.length) throw new Error('请选择图片。');
  if (selected.length > Number(context.limit || selected.length)) throw new Error(`最多上传${context.limit}张图片。`);
  selected.forEach((file, index) => {
    if (file.size > MEDIA_MAX_SOURCE_BYTES) {
      throw new Error(`第 ${index + 1} 张图片超过5MB，请压缩或重新选择。`);
    }
  });
  const controller = new AbortController();
  const rawPreviewUrls = ui.previewContainer ? selected.map((file) => {
    const previewUrl = URL.createObjectURL(file);
    mediaPreviewUrls.add(previewUrl);
    return previewUrl;
  }) : [];
  if (ui.previewContainer) {
    renderPreviews(ui.previewContainer, rawPreviewUrls.map((previewUrl) => ({ previewUrl })));
    recordPerf('preview', {
      imageCount: selected.length,
      duration: roundedDuration(previewStartedAt),
      navigationEpoch
    });
  }
  const setStatus = (message) => {
    if (ui.statusElement) ui.statusElement.textContent = message;
    context.onStatus?.(message);
  };
  const session = {
    controller,
    selected,
    results: new Array(selected.length),
    partial: new Array(selected.length),
    errors: new Map(),
    promise: null,
    released: false,
    retryFailed: null,
    release: null
  };
  mediaUploadSessions.add(session);

  const processOne = async (index) => {
    if (session.results[index]) return;
    const position = `第 ${index + 1}/${selected.length} 张`;
    try {
      let display = session.partial[index]?.display;
      if (!display) {
        setStatus(`${position}：正在压缩 0%`);
        const compressed = await compressImageMeasured(selected[index], {
          signal: controller.signal,
          variant: 'display',
          onProgress: (progress) => {
            const percent = Number(progress);
            if (Number.isFinite(percent)) {
              setStatus(`${position}：正在压缩 ${Math.max(0, Math.min(100, Math.round(percent)))}%`);
            }
          }
        });
        display = await uploadCompressedImage(compressed, {
          ...context,
          variant: 'display',
          onStage: (stage) => setStatus(`${position}：${stage}`)
        }, controller.signal);
        session.partial[index] = { display };
      }
      setStatus(`${position}：正在生成列表图片…`);
      const thumbCompressed = await compressImageMeasured(display.file, {
        signal: controller.signal,
        variant: 'thumb',
        plazaThumb: context.businessType === 'task'
      });
      const thumb = await uploadCompressedImage(thumbCompressed, {
        ...context,
        variant: 'thumb',
        parentMediaId: display.mediaId,
        onStage: (stage) => setStatus(`${position}：${stage}`)
      }, controller.signal);
      session.results[index] = { ...display, thumbMediaId: thumb.mediaId };
      session.errors.delete(index);
    } catch (error) {
      if (!controller.signal.aborted) session.errors.set(index, error);
    }
  };

  const runIndexes = async (indexes) => {
    setStatus('正在读取图片…');
    let cursor = 0;
    const worker = async () => {
      while (cursor < indexes.length && !controller.signal.aborted) {
        const index = indexes[cursor++];
        await processOne(index);
      }
    };
    const workers = Array.from(
      { length: Math.min(uploadConcurrency(), indexes.length) },
      () => worker()
    );
    await Promise.all(workers);
    if (controller.signal.aborted) throw new Error('图片上传已取消，请重新选择图片。');
    if (session.errors.size) {
      const failed = [...session.errors.keys()].map((index) => index + 1).join('、');
      throw new Error(`第 ${failed} 张图片处理失败，可单独重试失败图片。`);
    }
    setStatus('图片已就绪');
    return session.results;
  };

  session.retryFailed = () => {
    if (!session.errors.size || session.released) return session.promise;
    const indexes = [...session.errors.keys()];
    session.errors.clear();
    session.promise = runIndexes(indexes);
    return session.promise;
  };
  session.release = () => {
    if (session.released) return;
    session.released = true;
    controller.abort();
    rawPreviewUrls.forEach((url) => {
      URL.revokeObjectURL(url);
      mediaPreviewUrls.delete(url);
    });
    mediaUploadSessions.delete(session);
  };
  session.promise = runIndexes(selected.map((_, index) => index));
  return session;
};

const readFiles = async (files, context = {}) => {
  const session = createMediaUploadSession(files, context);
  try {
    return await session.promise;
  } finally {
    mediaUploadSessions.delete(session);
  }
};
const renderPreviews = (container, images) => {
  container.innerHTML = images.map((item, index) => {
    const src = typeof item === 'string' ? item : item.previewUrl || item.imageUrl;
    return `<figure><img loading="lazy" decoding="async" src="${src}" alt="待上传图片 ${index + 1}"><figcaption>第 ${index + 1} 张</figcaption></figure>`;
  }).join('');
};
window.addEventListener('pagehide', () => {
  mediaUploadSessions.forEach((session) => session.release());
  mediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  mediaPreviewUrls.clear();
});
const readRawFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('文件读取失败'));
  reader.readAsDataURL(file);
});
const downloadApiFile = async (path) => {
  const file = await api(path);
  const bytes = Uint8Array.from(atob(file.file), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
};
const downloadProtectedFile = async (path, filename) => {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '文件下载失败');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const trackName = (trackId) =>
  tracks.find((track) => track.id === trackId)?.name || '未分配';

const statusLabel = (status) => (status === 'active' ? '启用' : '禁用');

const formatDate = (value) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';

function logout() {
  void fetch('/api/logout', { method: 'POST', keepalive: true });
  clearTimeout(midnightRefreshTimer);
  midnightRefreshTimer = null;
  inflightGetRequests.clear();
  studentViewState.userId = null;
  studentViewState.data = null;
  studentViewState.renderedAt = 0;
  studentViewState.scrollY = 0;
  studentViewState.dirty = true;
  studentViewState.refreshPromise = null;
  studentViewState.refreshError = null;
  clearUserViewCaches();
  localStorage.clear();
  token = null;
  user = null;
  login();
}

function login() {
  window.location.replace('/entrance.html');
}

const validStudentDashboard = (dashboard) =>
  dashboard?.version === 1
  && dashboard.user?.id
  && Array.isArray(dashboard.tasks)
  && Array.isArray(dashboard.materialTasks);

const rememberStudentDashboard = (dashboard) => {
  if (studentViewState.userId && studentViewState.userId !== dashboard.user.id) {
    studentViewState.data = null;
    studentViewState.scrollY = 0;
  }
  studentViewState.userId = dashboard.user.id;
  studentViewState.data = dashboard;
  studentViewState.renderedAt = Date.now();
  studentViewState.dirty = false;
  studentViewState.refreshError = null;
  studentDashboardDirty = false;
};

const patchStudentTask = (taskId, updater) => {
  if (!studentViewState.data?.tasks) return;
  studentViewState.data.tasks = studentViewState.data.tasks.map(
    (task) => (task.id === taskId ? updater({ ...task }) : task)
  );
  studentViewState.renderedAt = Date.now();
};

const patchStudentMaterialTask = (taskId, updater) => {
  if (!studentViewState.data?.materialTasks) return;
  studentViewState.data.materialTasks = studentViewState.data.materialTasks.map(
    (task) => (task.id === taskId ? updater({ ...task }) : task)
  );
  studentViewState.renderedAt = Date.now();
};

const returnToCachedStudentHome = (successMessage, options = {}) => {
  const restoreStartedAt = performance.now();
  if (!studentViewState.data || user?.role !== 'student') {
    showToast(successMessage);
    void home({ forceRefresh: true });
    return;
  }
  studentViewState.refreshError = null;
  studentViewState.scrollY = Math.max(0, Number(options.scrollY || 0));
  const pageEpoch = beginNavigation();
  void student(studentViewState.data, pageEpoch, { restoreScroll: true });
  recordPerf('home-restore', {
    cached: true,
    duration: roundedDuration(restoreStartedAt),
    navigationEpoch: pageEpoch
  });
  showToast(successMessage);
  void refreshStudentDashboard(pageEpoch, true).then(() => {
    if (studentViewState.refreshError && isCurrentNavigation(pageEpoch)) {
      showToast('提交成功，但最新数据刷新失败，可稍后重新进入查看。', 'warning', 4000);
    }
  });
};

const refreshStudentDashboard = (pageEpoch, restoreScroll = true) => {
  if (studentViewState.refreshPromise) {
    return studentViewState.refreshPromise.then((dashboard) => {
      if (isCurrentNavigation(pageEpoch)) student(dashboard, pageEpoch, { restoreScroll });
      return dashboard;
    });
  }
  const expectedUserId = user?.id;
  studentViewState.refreshPromise = api('/api/student-dashboard')
    .then((dashboard) => {
      if (!validStudentDashboard(dashboard) || dashboard.user.id !== expectedUserId) {
        throw new Error('首页数据版本不兼容，请刷新后重试。');
      }
      rememberStudentDashboard(dashboard);
      if (isCurrentNavigation(pageEpoch)) student(dashboard, pageEpoch, { restoreScroll });
      return dashboard;
    })
    .catch((error) => {
      studentViewState.refreshError = error;
      if (!studentViewState.data) throw error;
      return studentViewState.data;
    })
    .finally(() => {
      studentViewState.refreshPromise = null;
    });
  return studentViewState.refreshPromise;
};

async function home(options = {}) {
  const pageEpoch = beginNavigation();
  document.body.classList.remove('poster-mode');
  const forceRefresh = Boolean(options.forceRefresh);
  const restoreScroll = options.restoreScroll !== false;
  if (user?.role === 'student') {
    if (forceRefresh) studentViewState.dirty = true;
    if (studentViewState.userId && studentViewState.userId !== user.id) {
      studentViewState.userId = null;
      studentViewState.data = null;
      studentViewState.scrollY = 0;
      studentViewState.dirty = true;
    }
    const bootstrapDashboard = window.__BOOTSTRAP_DASHBOARD__;
    if (!studentViewState.data && validStudentDashboard(bootstrapDashboard)
        && bootstrapDashboard.user.id === user.id) {
      rememberStudentDashboard(bootstrapDashboard);
      window.__BOOTSTRAP_DASHBOARD__ = null;
      return student(bootstrapDashboard, pageEpoch, { restoreScroll: false });
    }
    if (studentViewState.data && studentViewState.userId === user.id) {
      student(studentViewState.data, pageEpoch, { restoreScroll });
      void refreshStudentDashboard(pageEpoch, restoreScroll);
      return;
    }
    if (options.showShell !== false) {
      app.innerHTML = '<main class="app-shell-placeholder" aria-busy="true"><header class="student-hero"></header><section class="student-user-card"></section><section class="card"></section></main>';
    }
    await refreshStudentDashboard(pageEpoch, restoreScroll);
    return;
  }

  if (options.showShell !== false) {
    app.innerHTML = '<main class="app-shell-placeholder" aria-busy="true"><header class="hero"></header><section class="card"></section><section class="card"></section></main>';
  }
  const result = await api('/api/me');
  if (!isCurrentNavigation(pageEpoch)) return;
  config = result.config;
  tracks = result.tracks;
  user = result.user;
  localStorage.user = JSON.stringify(user);
  return loadAdminClient(undefined, pageEpoch);
}

async function student(dashboard, pageEpoch = beginNavigation(), options = {}) {
  const renderStartedAt = performance.now();
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'student';
  config = dashboard.config;
  tracks = dashboard.tracks;
  user = dashboard.user;
  try { localStorage.user = JSON.stringify(user); } catch {}
  const isInteraction = user.trackId === 'interaction';
  const teamListResult = dashboard.teamSummary;
  const myTeam = dashboard.teamSummary?.team;
  const taskResult = { tasks: dashboard.tasks };
  const materialResult = { tasks: dashboard.materialTasks };
  const completedTasks = taskResult.tasks.filter((task) =>
    ['submitted', 'approved'].includes(task.submission?.status) || task.memberCheckin
  ).length;
  const taskProgress = taskResult.tasks.length
    ? Math.round((completedTasks / taskResult.tasks.length) * 100)
    : 0;
  const avatarText = [...String(user.name || '同学')].slice(-2).join('');
  app.innerHTML = `
    <header class="student-hero">
      <div class="student-hero-copy">
        <span>20TH ANNIVERSARY</span>
        <h1>廿载同心，青春同行</h1>
        <p>${escapeHtml(config.activityName)}</p>
      </div>
      <button class="student-logout" id="out">退出</button>
    </header>
    <section class="student-user-card">
      <div class="student-avatar" aria-hidden="true">${escapeHtml(avatarText)}</div>
      <div class="student-user-copy"><span>欢迎回来</span><h2>${escapeHtml(user.name)}</h2><p>${escapeHtml(trackName(user.trackId))} · ${escapeHtml(user.campus)}</p></div>
      <div class="student-progress" style="--progress:${taskProgress}%"><strong>${taskProgress}%</strong><span>任务进度</span></div>
    </section>
    <nav class="student-shortcuts" aria-label="常用功能">
      <button data-jump="activityTasks"><span>✦</span><strong>今日任务</strong><small>${taskResult.tasks.length} 项待查看</small></button>
      <button id="historyCheckins"><span>✓</span><strong>历史打卡</strong><small>查看以前的提交</small></button>
      <button id="plaza"><span>▦</span><strong>活动广场</strong><small>发现青春作品</small></button>
      <button data-jump="myTeam" ${isInteraction ? '' : 'disabled'}><span>♢</span><strong>我的队伍</strong><small>${isInteraction ? (myTeam ? escapeHtml(myTeam.name) : '等待编队') : '仅互动赛道'}</small></button>
      <button id="inbox"><span>✉</span><strong>信息箱</strong><small>评论与系统通知</small></button>
    </nav>
    <div class="student-top-actions">
      <button class="secondary" id="ranking">查看排行榜</button>
    </div>
    <section class="card profile-card">
      <h2>我的资料</h2>
      <details class="profile-details">
      <summary>查看完整身份资料</summary>
      <div class="profile-grid">
        <div><span>姓名</span><strong>${escapeHtml(user.name)}</strong></div>
        <div><span>学号</span><strong>${escapeHtml(user.studentId)}</strong></div>
        <div><span>校区</span><strong>${escapeHtml(user.campus)}</strong></div>
        <div><span>所属赛道</span><strong>${escapeHtml(trackName(user.trackId))}</strong></div>
        <div><span>账号状态</span><strong>${escapeHtml(statusLabel(user.status))}</strong></div>
        <div><span>创建时间</span><strong>${escapeHtml(formatDate(user.createdAt))}</strong></div>
      </div>
      <p class="muted">关键身份资料仅可由管理员维护，如有错误请联系活动工作人员。</p>
      </details>
    </section>
    ${isInteraction ? `
      <section class="card" id="myTeam">
        <div class="row"><h2>我的队伍</h2><span class="right muted">${teamListResult.teamCount}/${teamListResult.maxTeams} 个队伍</span></div>
        ${myTeam ? `
          <div class="team-summary">
            <div><span>队伍名称</span><strong>${escapeHtml(myTeam.name)}</strong></div>
            <div><span>邀请码</span><strong class="invite-code">${escapeHtml(myTeam.inviteCode)}</strong></div>
            <div><span>成员人数</span><strong>${myTeam.memberCount}/${myTeam.memberLimit}</strong></div>
          </div>
          <h3>队伍成员</h3>
          <div class="member-list">${myTeam.members.map((member) => `<span>${escapeHtml(member.name)}（${escapeHtml(member.campus)}）</span>`).join('')}</div>
        ` : `
          <p class="muted">你尚未被编入队伍。队伍由管理员统一导入和调整，请联系活动管理员。</p>`}
      </section>
      ` : ''}`;
  const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
  const submissionNames = { draft: '草稿', submitted: '已提交', returned: '退回', approved: '通过' };
  const taskCards = taskResult.tasks.map((task) => `
    <article class="slot activity-task-card">
      <span class="task-kicker">${isInteraction ? '团队活动' : '个人活动'}</span>
      <div class="row"><h2>${escapeHtml(task.name)}</h2><span class="pill ${task.submission?.status === 'approved' ? 'done' : 'pending'}">${submissionNames[task.submission?.status] || '未提交'}</span></div>
      <p>${escapeHtml(task.description)}</p>
      <p class="task-requirement">${task.scheduleType === 'activityDays' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 活动第 ${task.refreshDays.join('、')} 天自动刷新` : task.scheduleType === 'weekly' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 周${task.weekdays.join('、周')}自动刷新` : `${formatDate(task.startAt)} 至 ${formatDate(task.endAt)}`} · 最多 ${task.imageLimit} 张图 · ${task.allowLate ? '允许补交' : '不允许补交'}</p>
      ${task.copyRequirement ? `<div class="notice">文案要求：${escapeHtml(task.copyRequirement)}</div>` : ''}
      ${task.submission?.reviewNote ? `<p class="bad">审核意见：${escapeHtml(task.submission.reviewNote)}</p>` : ''}
      ${isInteraction ? `
        <div class="team-progress">
          <div class="row"><strong>队伍个人打卡</strong><span class="right">${task.teamProgress?.completed || 0}/${task.teamProgress?.total || 0}</span></div>
          <div class="member-list compact">${(task.teamProgress?.members || []).map((member) => `<span class="${member.checked ? 'checked-member' : ''}">${escapeHtml(member.name)} · ${escapeHtml(member.studentId)} ${member.checked ? '✓ 已打卡' : '未打卡'}</span>`).join('')}</div>
        </div>
        <button data-member-task="${task.id}" ${task.availabilityError ? 'disabled' : ''}>${task.memberCheckin ? '更新个人打卡' : '个人打卡'}</button>
        ${task.isCaptain ? `<button class="secondary" data-task="${task.id}" ${task.availabilityError || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑队伍作品' : '队长汇总提交'}</button>` : '<p class="muted">队伍作品由管理员指定的队长汇总提交。</p>'}
      ` : `<button data-task="${task.id}" ${task.availabilityError || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑' : '个人打卡'}</button>`}
      ${task.availabilityError ? `<p class="bad">${escapeHtml(task.availabilityError)}</p>` : ''}
    </article>`).join('');
  app.insertAdjacentHTML('beforeend', `
    <section class="card" id="activityTasks"><div class="row"><h2>今日打卡</h2><span class="right muted">${isInteraction ? '个人打卡后由队长汇总' : '个人提交'}</span></div>
      <div class="grid">${taskCards || '<p class="muted">当前没有已发布任务</p>'}</div>
    </section>
    `);
  const materialStatus = { submitted: '已提交', returned: '退回修改' };
  app.insertAdjacentHTML('beforeend', `<section class="card"><div class="row"><h2>最终截图证明</h2><span class="right muted">最多 8 张 · 压缩后单张不超过 5MB</span></div>
    <div class="grid">${materialResult.tasks.map((task) => `<article class="slot">
      <div class="row"><h2>${escapeHtml(task.title)}</h2><span class="pill ${task.submission?.status === 'submitted' ? 'done' : 'pending'}">${materialStatus[task.submission?.status] || '未提交'}</span></div>
      <p>${escapeHtml(task.description)}</p><p class="muted">截止：${formatDate(task.deadline)} · 个人提交 · ${task.fileTypes.map((type) => `.${escapeHtml(type)}`).join('、')} · 最多 ${task.fileLimit} 张</p>
      ${task.submission?.reviewNote ? `<p class="bad">退回原因：${escapeHtml(task.submission.reviewNote)}</p>` : ''}
      ${task.submission?.files?.length ? `<div>${task.submission.files.map((file) => `<button class="secondary material-download" data-url="${file.downloadUrl}" data-name="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</button>`).join(' ')}</div>` : ''}
      <button data-material="${task.id}" ${task.submission?.status === 'submitted' ? 'disabled' : ''}>${task.submission?.status === 'returned' ? '修改并重新提交' : '提交材料'}</button>
    </article>`).join('') || '<p class="muted">暂无材料任务</p>'}</div></section>`);
  prepareDynamicContent(app);
  recordPerf('page-render', {
    page: 'student-home',
    duration: roundedDuration(renderStartedAt),
    navigationEpoch: pageEpoch
  });
  document.querySelector('#out').onclick = logout;
  document.querySelector('#historyCheckins').onclick = () => openStudentCheckinHistory();
  document.querySelector('#ranking').onclick = () => rankings();
  document.querySelector('#plaza').onclick = () => plaza();
  document.querySelector('#inbox').onclick = () => inbox();
  if (document.querySelector('#createAdmin')) {
    document.querySelector('#createAdmin').onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      try {
        await api('/api/admin/admins', { method: 'POST', body: JSON.stringify(values) });
        alert('管理员账号已创建');
        admin(date);
      } catch (error) { alert(error.message); }
    };
  }
  document.querySelectorAll('.reject-admin-action').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm('是否驳回该管理员操作？', '补卡记录将被撤销；审核结果将恢复为待审核状态。')) return;
      try {
        await api(`/api/admin/governance/${button.dataset.id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ note: '最高管理员驳回' })
        });
        alert('该管理员操作已驳回');
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('[data-jump]').forEach((button) => {
    button.onclick = () => document.querySelector(`#${button.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelectorAll('[data-task]').forEach((button) => {
    button.onclick = () => taskSubmissionForm(taskResult.tasks.find((task) => task.id === button.dataset.task));
  });
  document.querySelectorAll('[data-member-task]').forEach((button) => {
    button.onclick = () => memberCheckinForm(taskResult.tasks.find((task) => task.id === button.dataset.memberTask));
  });
  document.querySelectorAll('[data-material]').forEach((button) => {
    button.onclick = () => materialSubmissionForm(materialResult.tasks.find((task) => task.id === button.dataset.material));
  });
  document.querySelectorAll('.material-download').forEach((button) => {
    button.onclick = () => downloadProtectedFile(button.dataset.url, button.dataset.name).catch((error) => alert(error.message));
  });
  clearTimeout(midnightRefreshTimer);
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 2, 0);
  midnightRefreshTimer = setTimeout(() => {
    studentDashboardDirty = true;
    studentViewState.dirty = true;
    if (document.querySelector('#activityTasks')) void home({ showShell: false });
  }, Math.max(1000, nextMidnight.getTime() - Date.now()));
  if (options.restoreScroll) {
    requestAnimationFrame(() => window.scrollTo(0, studentViewState.scrollY));
  }
}

function openStudentCheckinHistory() {
  const root = document.querySelector('#modalRoot');
  let page = 1;
  let loading = false;
  root.innerHTML = `<div class="drawer-backdrop" id="historyDrawerBackdrop">
    <section class="bottom-drawer history-drawer" role="dialog" aria-modal="true" aria-labelledby="historyDrawerTitle">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">我的记录</small><h2 id="historyDrawerTitle">历史打卡</h2></div>
        <button class="secondary right" id="closeHistoryDrawer">关闭</button>
      </div>
      <div id="studentHistoryList"><p class="muted">正在读取历史打卡…</p></div>
      <button class="secondary full-width" id="moreStudentHistory" hidden>加载更多</button>
    </section>
  </div>`;
  const list = root.querySelector('#studentHistoryList');
  const more = root.querySelector('#moreStudentHistory');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeHistoryDrawer').onclick = close;
  root.querySelector('#historyDrawerBackdrop').onclick = (event) => {
    if (event.target.id === 'historyDrawerBackdrop') close();
  };

  const renderRecord = (record) => {
    const title = record.taskName || config.slots.find((slot) => slot.id === record.slotId)?.label || '打卡';
    const status = {
      pending: '待审核',
      submitted: '已提交',
      approved: '已通过',
      rejected: '已退回',
      returned: '退回修改'
    }[record.status] || record.status;
    const images = (record.images || []).map((media, index) => {
      const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl;
      const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
      return `
      <button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
        data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
        data-image-alt="${escapeHtml(title)}图片">
        <span class="image-shell"><img data-src="${escapeHtml(thumbUrl)}" loading="${index ? 'lazy' : 'eager'}"
          width="480" height="360" fetchpriority="${index ? 'low' : 'high'}"
          decoding="async" alt="${escapeHtml(title)}图片"
          onload="this.parentElement.classList.add('loaded')"
          onerror="this.hidden=true;this.parentElement.classList.add('failed')">
          <span class="image-error">图片加载失败，点击重试</span></span>
      </button>`;
    }).join('');
    return `<article class="history-checkin-card">
      <div class="row"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(record.date)}</small></div>
        <span class="pill ${record.status === 'approved' ? 'done' : 'pending'}">${escapeHtml(status)}</span></div>
      <p class="muted">${escapeHtml(formatDate(record.submittedAt))}</p>
      ${images ? `<div class="drawer-photo-grid compact">${images}</div>` : ''}
      ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ''}
      ${record.reviewNote ? `<p class="bad">审核说明：${escapeHtml(record.reviewNote)}</p>` : ''}
    </article>`;
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const result = await api(`/api/checkins/history?page=${page}&limit=20`);
      if (page === 1) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', result.records.map(renderRecord).join(''));
      if (!result.records.length && page === 1) {
        list.innerHTML = '<p class="muted">暂无历史打卡记录</p>';
      }
      const loaded = Math.min(result.total, page * result.limit);
      prepareDynamicContent(list);
      more.hidden = loaded >= result.total;
      more.textContent = `加载更多（${loaded}/${result.total}）`;
      page += 1;
    } catch (error) {
      if (page === 1) list.innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
      more.hidden = false;
      more.textContent = '读取失败，点击重试';
    } finally {
      loading = false;
      more.disabled = false;
    }
  };
  more.onclick = load;
  void load();
}

function memberCheckinForm(task) {
  beginNavigation();
  void loadImageCompressionLibrary().catch(() => {});
  app.innerHTML = `<header class="hero"><h1>个人打卡</h1><p>${escapeHtml(task.name)}</p></header>
    <section class="card"><form id="memberSend">
      <div class="notice">姓名和学号由账号自动带入，请上传本人当天截图。</div>
      <label>姓名</label><input value="${escapeHtml(user.name)}" readonly>
      <label>学号</label><input value="${escapeHtml(user.studentId)}" readonly>
      <label>校区</label><input value="${escapeHtml(user.campus)}" readonly>
      <label>图片</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" required>
      <div class="image-preview" id="memberPreview"></div>
      <p class="muted" id="memberUploadStatus">选择图片后会立即压缩并上传，图片就绪后才能确定打卡。</p>
      <button type="button" class="secondary" id="retryMemberUpload" hidden>重试上传</button>
      <div class="row"><button type="button" class="secondary" id="backMember">返回</button><button>确定打卡</button></div>
    </form></section>`;
  const form = document.querySelector('#memberSend');
  const submitButton = form.querySelector('button:not([type="button"])');
  const retryButton = document.querySelector('#retryMemberUpload');
  const status = document.querySelector('#memberUploadStatus');
  const preview = document.querySelector('#memberPreview');
  let session = null;

  const releaseSession = () => {
    session?.controller?.abort();
    if (session?.previewUrl) {
      URL.revokeObjectURL(session.previewUrl);
      mediaPreviewUrls.delete(session.previewUrl);
    }
    session = null;
    form._media = null;
  };
  const updateReadyState = () => {
    submitButton.disabled = !session?.compressed && !session?.mediaId;
    submitButton.textContent = session?.uploadPromise ? '图片上传中' : '确定打卡';
    retryButton.hidden = !session?.compressed || Boolean(session?.mediaId) || Boolean(session?.uploadPromise);
  };
  const uploadCurrentSession = async (current) => {
    if (!current?.compressed || current !== session) return null;
    status.textContent = '正在上传图片…';
    retryButton.hidden = true;
    const uploadPromise = uploadMemberCheckinFast(
      current.compressed,
      task.id,
      current.idempotencyKey,
      current.controller.signal
    );
    current.uploadPromise = uploadPromise;
    updateReadyState();
    try {
      const uploaded = await uploadPromise;
      if (current !== session) return null;
      current.mediaId = uploaded.mediaId;
      form._media = uploaded;
      status.textContent = '图片已就绪';
      return uploaded;
    } catch (error) {
      if (current !== session || current.controller.signal.aborted) return null;
      current.error = error;
      status.textContent = error.message || '图片上传失败，请检查网络后点击重试。';
      return null;
    } finally {
      if (current === session) {
        current.uploadPromise = null;
        updateReadyState();
      }
    }
  };

  document.querySelector('#backMember').onclick = () => {
    releaseSession();
    home();
  };
  retryButton.onclick = () => {
    if (session?.compressed && !session.uploadPromise && !session.mediaId) {
      void uploadCurrentSession(session);
    }
  };
  form.images.onchange = async () => {
    const previewStartedAt = performance.now();
    releaseSession();
    submitButton.disabled = true;
    retryButton.hidden = true;
    preview.innerHTML = '';
    const file = form.images.files?.[0];
    if (!file) {
      status.textContent = '请选择图片。';
      return;
    }
    const current = {
      idempotencyKey: createIdempotencyKey(),
      controller: new AbortController(),
      compressed: null,
      mediaId: null,
      uploadPromise: null,
      previewUrl: null
    };
    session = current;
    try {
      const sourceFile = await normalizeSourceImage(file);
      if (current !== session) return;
      current.previewUrl = URL.createObjectURL(sourceFile);
      mediaPreviewUrls.add(current.previewUrl);
      renderPreviews(preview, [{ previewUrl: current.previewUrl }]);
      recordPerf('preview', {
        imageCount: 1,
        duration: roundedDuration(previewStartedAt),
        navigationEpoch
      });
      status.textContent = '正在压缩图片…';
      const compressStartedAt = performance.now();
      try {
        current.compressed = await compressMemberCheckinImage(sourceFile, {
          signal: current.controller.signal
        });
      } finally {
        recordPerf('compress', {
          variant: 'member-checkin-fast',
          sourceBytes: Number(sourceFile.size || 0),
          outputBytes: Number(current.compressed?.file?.size || 0),
          duration: roundedDuration(compressStartedAt),
          navigationEpoch
        });
      }
      if (current !== session) return;
      await uploadCurrentSession(current);
    } catch (error) {
      if (current !== session || current.controller.signal.aborted) return;
      current.error = error;
      status.textContent = error.message || '图片处理失败，请重新选择图片。';
      if (!current.compressed) {
        await openDialog({
          title: '图片处理失败',
          message: status.textContent,
          confirmText: '重新选择'
        });
      }
      updateReadyState();
    }
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const submitStartedAt = performance.now();
    let submitSucceeded = false;
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    if (session?.uploadPromise) {
      status.textContent = '图片上传中，请稍候…';
      await session.uploadPromise.catch(() => null);
    }
    if (!session?.mediaId) {
      status.textContent = '图片尚未就绪，请重新选择或点击重试上传。';
      restoreButton();
      updateReadyState();
      return;
    }
    try {
      const result = await api(`/api/tasks/${task.id}/member-checkin`, {
        method: 'PUT',
        body: JSON.stringify({
          occurrenceDate: task.occurrenceDate,
          mediaIds: [session.mediaId]
        })
      });
      patchStudentTask(task.id, (cachedTask) => {
        const memberAlreadyCompleted = Boolean(cachedTask.memberCheckin);
        const members = cachedTask.teamProgress?.members?.map((member) => (
          member.id === user.id ? { ...member, checked: true } : member
        )) || [];
        return {
          ...cachedTask,
          memberCheckin: {
            id: cachedTask.memberCheckin?.id || `confirmed:${session.mediaId}`,
            userId: user.id,
            occurrenceDate: result.occurrenceDate || task.occurrenceDate
          },
          teamProgress: cachedTask.teamProgress ? {
            ...cachedTask.teamProgress,
            completed: memberAlreadyCompleted
              ? cachedTask.teamProgress.completed
              : Math.min(cachedTask.teamProgress.total, cachedTask.teamProgress.completed + 1),
            members
          } : null
        };
      });
      releaseSession();
      submitSucceeded = true;
      returnToCachedStudentHome('个人打卡成功');
    } catch (error) {
      alert(error?.message || '打卡提交失败，请稍后重试。');
      restoreButton();
    } finally {
      if (session) submitButton.disabled = !session.mediaId;
      recordPerf('submit', {
        action: 'member-checkin',
        success: submitSucceeded,
        duration: roundedDuration(submitStartedAt),
        navigationEpoch
      });
    }
  };
}

function materialSubmissionForm(task) {
  beginNavigation();
  void loadImageCompressionLibrary().catch(() => {});
  const current = task.submission;
  app.innerHTML = `<header class="hero"><h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(task.description)}</p></header>
    <section class="card"><form id="materialSend">
      <div class="notice">浏览器会自动压缩图片，最多 ${task.fileLimit} 张，压缩后单张最大 5MB。</div>
      <label>上传最终截图</label><input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp">
      <div class="image-preview" id="materialPreview"></div>
      <div class="row"><p class="muted upload-status" id="materialUploadStatus" aria-live="polite">选择图片后会立即预览并在后台上传。</p>
        <button type="button" class="secondary" id="retryMaterialUpload" hidden>重试失败图片</button></div>
      <label>文字总结${task.summaryRequired ? '（必填）' : '（选填）'}</label><textarea name="summary">${escapeHtml(current?.summary || '')}</textarea>
      <div class="row"><button type="button" class="secondary" id="backMaterial">返回</button><button>提交材料</button></div>
    </form></section>`;
  const materialForm = document.querySelector('#materialSend');
  const materialStatus = document.querySelector('#materialUploadStatus');
  const materialRetry = document.querySelector('#retryMaterialUpload');
  let mediaSession = null;
  document.querySelector('#backMaterial').onclick = () => {
    mediaSession?.release();
    home();
  };
  materialRetry.onclick = () => {
    if (!mediaSession?.errors.size) return;
    materialRetry.hidden = true;
    void mediaSession.retryFailed().catch((error) => {
      materialStatus.textContent = error.message;
      materialRetry.hidden = false;
    });
  };
  materialForm.files.onchange = () => {
    mediaSession?.release();
    mediaSession = null;
    materialRetry.hidden = true;
    try {
      if (materialForm.files.files.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 张图片`);
      mediaSession = createMediaUploadSession(materialForm.files.files, {
        taskId: task.id, businessType: 'material-image', limit: task.fileLimit
      }, {
        previewContainer: document.querySelector('#materialPreview'),
        statusElement: materialStatus
      });
      const currentSession = mediaSession;
      void currentSession.promise.catch((error) => {
        if (currentSession !== mediaSession) return;
        materialStatus.textContent = error.message;
        materialRetry.hidden = !currentSession.errors.size;
      });
    } catch (error) {
      void openDialog({ title: '图片处理失败', message: error.message, confirmText: '重新选择' });
      materialForm.files.value = '';
      materialStatus.textContent = error.message;
    }
  };
  document.querySelector('#materialSend').onsubmit = async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || event.target.querySelector('button:not([type="button"])');
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    try {
      const selected = [...event.target.files.files];
      if (selected.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 个文件`);
      const images = selected.length ? await mediaSession?.promise : [];
      if (selected.length && (!images || images.length !== selected.length)) {
        throw new Error('图片尚未全部就绪，请重试失败图片。');
      }
      const files = images.map((item, index) => ({ name: selected[index].name, mediaId: item.mediaId }));
      const result = await api(`/api/material-tasks/${task.id}/submission`, {
        method: 'PUT',
        body: JSON.stringify({
          version: current?.version || 0,
          files,
          summary: event.target.summary.value
        })
      });
      patchStudentMaterialTask(task.id, (cachedTask) => ({
        ...cachedTask,
        submission: {
          ...(cachedTask.submission || {}),
          id: result.id,
          status: 'submitted',
          version: Number(cachedTask.submission?.version || 0) + 1,
          summary: event.target.summary.value,
          submittedAt: new Date().toISOString(),
          files: files.map((file) => ({
            id: file.mediaId,
            name: file.name,
            originalName: file.name,
            url: `/api/material-files/${file.mediaId}`,
            downloadUrl: `/api/material-files/${file.mediaId}`
          }))
        }
      }));
      mediaSession?.release();
      mediaSession = null;
      returnToCachedStudentHome('材料提交成功');
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
}

function taskSubmissionForm(task) {
  beginNavigation();
  void loadImageCompressionLibrary().catch(() => {});
  const current = task.submission;
  app.innerHTML = `
    <header class="hero"><h1>${escapeHtml(task.name)}</h1><p>${escapeHtml(task.description)}</p></header>
    <section class="card"><form id="taskSend">
      <div class="notice">上传前浏览器会自动压缩图片。支持 JPG、PNG、WebP，原图单张不超过 5MB，最多 ${task.imageLimit} 张。</div>
      <label>活动图片</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="image-preview" id="taskPreview"></div>
      <div class="row"><p class="muted upload-status" id="taskUploadStatus" aria-live="polite">选择图片后会立即预览并在后台上传。</p>
        <button type="button" class="secondary" id="retryTaskUpload" hidden>重试失败图片</button></div>
      ${user.trackId === 'health' ? `<label>餐次</label><select name="mealType" required><option value="">请选择</option><option value="breakfast" ${current?.mealType === 'breakfast' ? 'selected' : ''}>早餐</option><option value="lunch" ${current?.mealType === 'lunch' ? 'selected' : ''}>午餐</option><option value="dinner" ${current?.mealType === 'dinner' ? 'selected' : ''}>晚餐</option></select>` : ''}
      <label>活动文案${task.copyRequirement ? '（必填）' : '（选填）'}</label><textarea name="copy">${escapeHtml(current?.copy || '')}</textarea>
      ${user.trackId === 'interaction' ? `<label class="check-label"><input name="isPublic" type="checkbox" ${current?.isPublic ? 'checked' : ''}> 同意发布至活动广场</label>
      <div id="plazaCopyField" style="display:${current?.isPublic ? 'block' : 'none'}"><label>广场作品文案（发布时必填）</label><textarea name="plazaCopy">${escapeHtml(current?.plazaCopy || '')}</textarea></div>` : ''}
      <div class="row"><button type="button" class="secondary" id="back">返回</button><button type="button" class="secondary" data-intent="draft">保存草稿</button><button data-intent="submit">最终提交</button></div>
    </form></section>`;
  const form = document.querySelector('#taskSend');
  const taskStatus = document.querySelector('#taskUploadStatus');
  const taskRetry = document.querySelector('#retryTaskUpload');
  let mediaSession = null;
  document.querySelector('#back').onclick = () => {
    mediaSession?.release();
    home();
  };
  taskRetry.onclick = () => {
    if (!mediaSession?.errors.size) return;
    taskRetry.hidden = true;
    void mediaSession.retryFailed().catch((error) => {
      taskStatus.textContent = error.message;
      taskRetry.hidden = false;
    });
  };
  form.images.onchange = () => {
    mediaSession?.release();
    mediaSession = null;
    taskRetry.hidden = true;
    try {
      if (form.images.files.length > task.imageLimit) throw new Error(`最多上传 ${task.imageLimit} 张图片`);
      mediaSession = createMediaUploadSession(form.images.files, {
        taskId: task.id, businessType: 'task', limit: task.imageLimit
      }, {
        previewContainer: document.querySelector('#taskPreview'),
        statusElement: taskStatus
      });
      const currentSession = mediaSession;
      void currentSession.promise.catch((error) => {
        if (currentSession !== mediaSession) return;
        taskStatus.textContent = error.message;
        taskRetry.hidden = !currentSession.errors.size;
      });
    } catch (error) {
      void openDialog({ title: '图片处理失败', message: error.message, confirmText: '重新选择' });
      form.images.value = '';
      taskStatus.textContent = error.message;
    }
  };
  if (form.isPublic) form.isPublic.onchange = () => {
    document.querySelector('#plazaCopyField').style.display = form.isPublic.checked ? 'block' : 'none';
  };
  form.querySelectorAll('[data-intent]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === 'true') return;
      form.dataset.submitting = 'true';
      const restoreButton = beginButtonLoading(
        button,
        button.dataset.intent === 'draft' ? '正在保存…' : '正在提交…'
      );
      const siblingButtons = [...form.querySelectorAll('[data-intent]')].filter((item) => item !== button);
      siblingButtons.forEach((item) => { item.disabled = true; });
      try {
        if (form.images.files.length > task.imageLimit) throw new Error(`最多上传 ${task.imageLimit} 张图片`);
        const media = form.images.files.length ? await mediaSession?.promise : [];
        if (form.images.files.length && (!media || media.length !== form.images.files.length)) {
          throw new Error('图片尚未全部就绪，请重试失败图片。');
        }
        const result = await api(`/api/tasks/${task.id}/submission`, {
          method: 'PUT',
          body: JSON.stringify({
            intent: button.dataset.intent,
            version: current?.version || 0,
            occurrenceDate: task.occurrenceDate,
            mediaIds: media.map((item) => item.mediaId),
            copy: form.copy.value,
            plazaCopy: form.plazaCopy?.value || '',
            mealType: form.mealType?.value,
            isPublic: Boolean(form.isPublic?.checked)
          })
        });
        patchStudentTask(task.id, (cachedTask) => ({
          ...cachedTask,
          submission: {
            ...(cachedTask.submission || {}),
            ...result.submission,
            copy: form.copy.value,
            plazaCopy: form.plazaCopy?.value || '',
            mealType: form.mealType?.value || '',
            isPublic: Boolean(form.isPublic?.checked),
            occurrenceDate: task.occurrenceDate,
            submittedAt: result.submission.status === 'draft'
              ? cachedTask.submission?.submittedAt || null
              : new Date().toISOString()
          }
        }));
        if (result.submission.status !== 'draft' && form.isPublic?.checked) {
          plazaViewCache.clear();
          rankingViewCache.clear();
        }
        mediaSession?.release();
        mediaSession = null;
        returnToCachedStudentHome(
          result.submission.status === 'draft' ? '草稿已保存' : '最终提交成功'
        );
      } catch (error) {
        restoreButton();
        siblingButtons.forEach((item) => { item.disabled = false; });
        form.dataset.submitting = 'false';
        alert(error.message);
      }
    };
  });
}

async function inbox(page = 1) {
  const pageEpoch = beginNavigation();
  const result = await api(`/api/inbox?page=${page}&limit=20`);
  if (!isCurrentNavigation(pageEpoch)) return;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>个人信息箱</h1><p>评论提醒、系统通知和管理员通知</p></div><button class="secondary right" id="backInbox">返回</button></div></header>
    <section class="card"><div class="row"><h2>消息</h2><span class="pill ${result.unread ? 'pending' : 'done'}">未读 ${result.unread}</span><button class="secondary right" id="readAll">全部已读</button></div>
      <div class="notification-list">${result.notifications.map((notice) => `
        <button class="notification-item ${notice.isRead ? '' : 'unread'}" data-notice="${notice.id}" data-post="${notice.postId || ''}">
          <span class="notification-avatar">${escapeHtml((notice.actorName || '系统').slice(-1))}</span>
          <span><strong>${escapeHtml(notice.actorName || (notice.type === 'admin' ? '管理员' : '系统通知'))}</strong>
          <small>${formatDate(notice.createdAt)}</small><p>${escapeHtml(notice.content)}</p></span>
        </button>`).join('') || '<p class="muted">暂无消息</p>'}</div>
      <div class="row plaza-pager"><button class="secondary" id="prevInbox" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button class="secondary" id="nextInbox" ${!result.hasMore ? 'disabled' : ''}>下一页</button></div>
    </section><div id="modalRoot"></div>`;
  document.querySelector('#backInbox').onclick = home;
  document.querySelector('#readAll').onclick = async () => { await api('/api/inbox', { method: 'PATCH', body: '{}' }); inbox(page); };
  document.querySelector('#prevInbox').onclick = () => inbox(page - 1);
  document.querySelector('#nextInbox').onclick = () => inbox(page + 1);
  document.querySelectorAll('[data-notice]').forEach((item) => {
    item.onclick = async () => {
      await api('/api/inbox', { method: 'PATCH', body: JSON.stringify({ id: item.dataset.notice }) });
      if (item.dataset.post) {
        await plaza();
        openPlazaPost(item.dataset.post, 'latest', 1, '', true);
      } else inbox(page);
    };
  });
}

const updatePlazaCachePost = (postId, updates) => {
  for (const entry of plazaViewCache.values()) {
    if (!entry?.data?.posts) continue;
    const post = entry.data.posts.find((item) => item.id === postId);
    if (post) Object.assign(post, updates);
  }
};

const updateVisiblePlazaCard = (postId, updates) => {
  const card = [...app.querySelectorAll('[data-post]')].find(
    (item) => item.dataset.post === postId
  );
  if (!card) return;
  if (updates.viewCount != null) card.querySelector('[data-plaza-views]').textContent = updates.viewCount;
  if (updates.likeCount != null) card.querySelector('[data-plaza-likes]').textContent = updates.likeCount;
  if (updates.commentCount != null) card.querySelector('[data-plaza-comments]').textContent = updates.commentCount;
};

const renderPlazaPage = (result, sort, page, month, pageEpoch, options = {}) => {
  const renderStartedAt = performance.now();
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'plaza';
  const preservedScroll = options.preserveScroll ? window.scrollY : 0;
  const cards = result.posts.map((post) => `
    <article class="plaza-card" data-post="${post.id}">
      <div class="image-shell">
        ${post.images[0]
          ? `<img loading="lazy" decoding="async" fetchpriority="low" width="480" height="360"
              data-src="${escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"
              alt="${escapeHtml(post.teamName)}活动图片"
              onload="this.parentElement.classList.add('loaded')"
              onerror="this.hidden=true;this.parentElement.classList.add('failed')">`
          : '<span class="image-fallback">暂无图片</span>'}
        <span class="image-error">图片加载失败</span>
      </div>
      <div class="plaza-body">
        <span class="eyebrow dark">${escapeHtml(post.taskName)}</span>
        <h2>${escapeHtml(post.teamName)}</h2>
        <p class="muted">发布人：${escapeHtml(post.publisherName)}</p>
        <p class="muted">${post.members.map((member) => escapeHtml(member.name)).join('、')}</p>
        <p>${escapeHtml(post.copy)}</p>
        <div class="row muted"><span>${formatDate(post.publishedAt)}</span><span class="right">
          浏览 <span data-plaza-views>${post.viewCount}</span>　
          点赞 <span data-plaza-likes>${post.likeCount}</span>　
          评论 <span data-plaza-comments>${post.commentCount}</span>
        </span></div>
      </div>
    </article>`).join('');
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>四校区活动广场</h1><p>内容仅来自公开的四校区任务提交</p></div><button class="secondary right" id="backHome">返回</button></div></header>
    <section class="card plaza-toolbar">
      <div class="row">
        <button class="${sort === 'latest' ? '' : 'secondary'}" data-sort="latest">最新发布</button>
        <button class="${sort === 'hot' ? '' : 'secondary'}" data-sort="hot">热门排行</button>
        <button class="${sort === 'monthly' ? '' : 'secondary'}" data-sort="monthly">月度排行</button>
        <label class="right">月份 <input id="plazaMonth" type="month" value="${escapeHtml(result.month)}"></label>
      </div>
    </section>
    <section class="plaza-grid">${cards || '<div class="card muted">当前没有公开内容</div>'}</section>
    <div class="row plaza-pager">
      <button class="secondary" id="prevPage" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} 页 · 共 ${result.total} 条</span>
      <button class="secondary" id="nextPage" ${!result.hasMore ? 'disabled' : ''}>下一页</button>
    </div>
    <p class="view-cache-status muted" id="viewCacheStatus" hidden></p>
    <div id="modalRoot"></div>`;
  prepareDynamicContent(app);
  recordPerf('page-render', {
    page: 'plaza',
    duration: roundedDuration(renderStartedAt),
    navigationEpoch: pageEpoch
  });
  document.querySelector('#backHome').onclick = home;
  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.onclick = () => plaza(button.dataset.sort, 1, document.querySelector('#plazaMonth').value);
  });
  document.querySelector('#plazaMonth').onchange = (event) => plaza('monthly', 1, event.target.value);
  document.querySelector('#prevPage').onclick = () => plaza(sort, page - 1, result.month);
  document.querySelector('#nextPage').onclick = () => plaza(sort, page + 1, result.month);
  document.querySelectorAll('[data-post]').forEach((card) => {
    card.onclick = () => openPlazaPost(card.dataset.post, sort, page, result.month);
  });
  if (options.preserveScroll) requestAnimationFrame(() => window.scrollTo(0, preservedScroll));
};

async function plaza(sort = 'latest', page = 1, month = '') {
  const pageEpoch = beginNavigation();
  const cacheKey = scopedCacheKey('plaza', sort, page, month);
  const cached = readViewCache(plazaViewCache, cacheKey);
  const path = `/api/plaza?sort=${sort}&page=${page}&limit=20${month ? `&month=${month}` : ''}`;
  if (cached) {
    renderPlazaPage(cached.data, sort, page, month, pageEpoch);
    const refresh = async () => {
      try {
        const result = await api(path);
        writeViewCache(plazaViewCache, cacheKey, result);
        if (!isCurrentNavigation(pageEpoch) || document.body.dataset.view !== 'plaza') return;
        renderPlazaPage(result, sort, page, month, pageEpoch, { preserveScroll: true });
      } catch {
        if (!isCurrentNavigation(pageEpoch)) return;
        const status = document.querySelector('#viewCacheStatus');
        if (status) {
          status.hidden = false;
          status.textContent = '当前显示的是已缓存内容，最新数据刷新失败。';
        }
      }
    };
    if (cacheIsFresh(cached)) queueMicrotask(() => { void refresh(); });
    else void refresh();
    return;
  }
  const result = await api(path);
  writeViewCache(plazaViewCache, cacheKey, result);
  renderPlazaPage(result, sort, page, month, pageEpoch);
}

function rankingTable(items, metric, label) {
  return `<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>${label}</th></tr></thead><tbody>${items.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.teamName)}</td><td>${item[metric]}</td></tr>`).join('') || '<tr><td colspan="3">暂无数据</td></tr>'}</tbody></table></div>`;
}

const renderRankingsPage = (result, period, key, pageEpoch, options = {}) => {
  const renderStartedAt = performance.now();
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'ranking';
  const preservedScroll = options.preserveScroll ? window.scrollY : 0;
  const currentKey = key || (period === 'month' ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).slice(0, 7) : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));
  const teamTable = `<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>公开次数</th><th>点赞</th><th>浏览</th><th>综合热度</th></tr></thead><tbody>${result.teamRank.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.teamName)}</td><td>${item.publicCount}</td><td>${item.likeCount}</td><td>${item.viewCount}</td><td>${item.heatScore}</td></tr>`).join('') || '<tr><td colspan="6">暂无数据</td></tr>'}</tbody></table></div>`;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>活动排行榜</h1><p>${escapeHtml(result.formula)}</p></div><button class="secondary right" id="backRanking">返回</button></div></header>
    <section class="card"><div class="row">
      <button class="${period === 'day' ? '' : 'secondary'}" data-period="day">日榜</button>
      <button class="${period === 'week' ? '' : 'secondary'}" data-period="week">周榜</button>
      <button class="${period === 'month' ? '' : 'secondary'}" data-period="month">月榜</button>
      <label class="right">${period === 'month' ? '月份' : '日期'} <input id="rankingKey" type="${period === 'month' ? 'month' : 'date'}" value="${escapeHtml(currentKey)}"></label>
      ${result.frozen ? '<span class="pill done">最终排名已冻结</span>' : ''}
    </div></section>
    ${period === 'month' ? `<section class="card"><h2>队伍月榜</h2>${teamTable}</section>` : `
      <section class="grid ranking-grids">
        <div class="card"><h2>点赞榜</h2>${rankingTable(result.likeRank, 'likeCount', '点赞')}</div>
        <div class="card"><h2>浏览榜</h2>${rankingTable(result.viewRank, 'viewCount', '浏览')}</div>
        <div class="card"><h2>综合热度榜</h2>${rankingTable(result.heatRank, 'heatScore', '热度')}</div>
      </section>`}
    ${period === 'month' && user.role === 'admin' ? `<section class="card"><div class="row"><button id="freezeRanking" ${result.frozen ? 'disabled' : ''}>冻结最终排名</button><button class="secondary" id="exportRanking">导出 Excel</button></div></section>` : ''}
    <p class="view-cache-status muted" id="viewCacheStatus" hidden></p>`;
  prepareDynamicContent(app);
  recordPerf('page-render', {
    page: 'rankings',
    duration: roundedDuration(renderStartedAt),
    navigationEpoch: pageEpoch
  });
  document.querySelector('#backRanking').onclick = home;
  document.querySelectorAll('[data-period]').forEach((button) => { button.onclick = () => rankings(button.dataset.period); });
  document.querySelector('#rankingKey').onchange = (event) => rankings(period, event.target.value);
  const freeze = document.querySelector('#freezeRanking');
  if (freeze) freeze.onclick = async () => {
    if (!await askConfirm('是否冻结最终排名？', `冻结 ${currentKey} 最终排名后将不会随数据变化。`)) return;
    const restoreButton = beginButtonLoading(freeze, '正在冻结…');
    try {
      await api('/api/admin/rankings/freeze', { method: 'POST', body: JSON.stringify({ month: currentKey }) });
      rankingViewCache.clear();
      await rankings('month', currentKey);
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
  const exportButton = document.querySelector('#exportRanking');
  if (exportButton) exportButton.onclick = async () => {
    await downloadApiFile(`/api/admin/rankings/export?month=${currentKey}`);
  };
  if (options.preserveScroll) requestAnimationFrame(() => window.scrollTo(0, preservedScroll));
};

async function rankings(period = 'day', key = '') {
  const pageEpoch = beginNavigation();
  const currentKey = key || (period === 'month'
    ? new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit'
    }).slice(0, 7)
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));
  const cacheKey = scopedCacheKey('ranking', period, currentKey);
  const cached = readViewCache(rankingViewCache, cacheKey);
  const path = `/api/rankings?period=${period}&key=${encodeURIComponent(currentKey)}`;
  if (cached) {
    renderRankingsPage(cached.data, period, currentKey, pageEpoch);
    const refresh = async () => {
      try {
        const result = await api(path);
        writeViewCache(rankingViewCache, cacheKey, result);
        if (!isCurrentNavigation(pageEpoch) || document.body.dataset.view !== 'ranking') return;
        renderRankingsPage(result, period, currentKey, pageEpoch, { preserveScroll: true });
      } catch {
        if (!isCurrentNavigation(pageEpoch)) return;
        const status = document.querySelector('#viewCacheStatus');
        if (status) {
          status.hidden = false;
          status.textContent = '当前显示的是已缓存榜单，最新数据刷新失败。';
        }
      }
    };
    if (cacheIsFresh(cached)) queueMicrotask(() => { void refresh(); });
    else void refresh();
    return;
  }
  const result = await api(path);
  writeViewCache(rankingViewCache, cacheKey, result);
  renderRankingsPage(result, period, currentKey, pageEpoch);
}

async function openPlazaPost(postId, sort, page, month, countView = true) {
  const root = document.querySelector('#modalRoot');
  if (!root) return;
  const modalEpoch = ++plazaModalEpoch;
  const plazaScrollY = window.scrollY;
  let post = null;
  let pendingViewIncrement = false;
  root.innerHTML = `<div class="modal-backdrop"><section class="card modal plaza-detail" aria-busy="true">
    <div class="row"><h2>正在读取作品…</h2><button class="secondary right" id="closePost">关闭</button></div>
    <div class="plaza-detail-placeholder"></div>
  </section></div>`;
  const closePost = () => {
    if (modalEpoch !== plazaModalEpoch) return;
    plazaModalEpoch += 1;
    root.innerHTML = '';
    requestAnimationFrame(() => window.scrollTo(0, plazaScrollY));
  };
  root.querySelector('#closePost').onclick = closePost;

  const detailPromise = api(`/api/plaza/${postId}`);
  const commentsPromise = api(`/api/plaza/${postId}/comments?page=1&limit=10`);
  const viewKey = scopedCacheKey('plaza-view', postId);
  if (countView && !countedPlazaViews.has(viewKey)) {
    countedPlazaViews.add(viewKey);
    void api(`/api/plaza/${postId}/view`, { method: 'POST' })
      .then((result) => {
        if (!result.counted) return;
        if (!post) {
          pendingViewIncrement = true;
          return;
        }
        const nextViewCount = Number(post?.viewCount || 0) + 1;
        if (post) post.viewCount = nextViewCount;
        updatePlazaCachePost(postId, { viewCount: nextViewCount });
        updateVisiblePlazaCard(postId, { viewCount: nextViewCount });
        const detailCount = root.querySelector('[data-detail-views]');
        if (detailCount) detailCount.textContent = nextViewCount;
        rankingViewCache.clear();
      })
      .catch(() => {});
  }

  let commentResult;
  try {
    [{ post }, commentResult] = await Promise.all([detailPromise, commentsPromise]);
  } catch (error) {
    if (modalEpoch !== plazaModalEpoch) return;
    root.innerHTML = `<div class="modal-backdrop"><section class="card modal plaza-detail">
      <div class="row"><h2>作品读取失败</h2><button class="secondary right" id="closePost">关闭</button></div>
      <p class="bad">${escapeHtml(error.message)}</p>
    </section></div>`;
    root.querySelector('#closePost').onclick = closePost;
    return;
  }
  if (modalEpoch !== plazaModalEpoch) return;
  if (pendingViewIncrement) {
    post.viewCount = Number(post.viewCount || 0) + 1;
    updatePlazaCachePost(postId, { viewCount: post.viewCount });
    updateVisiblePlazaCard(postId, { viewCount: post.viewCount });
    rankingViewCache.clear();
  }
  const commentsHtml = commentResult.comments.map((comment) => `
    <article class="comment-item" data-comment="${comment.id}">
      <div><strong>${escapeHtml(comment.name)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div>
      <p>${escapeHtml(comment.content)}</p>
      ${comment.canDelete ? '<button class="link-button delete-comment">删除</button>' : ''}
    </article>`).join('');
  root.innerHTML = `<div class="modal-backdrop"><section class="card modal plaza-detail">
    <div class="row"><div><span class="eyebrow dark">${escapeHtml(post.taskName)}</span><h2>${escapeHtml(post.teamName)}</h2></div><button class="secondary right" id="closePost">关闭</button></div>
    <p class="muted">成员：${post.members.map((member) => `${escapeHtml(member.name)}（${escapeHtml(member.campus)}）`).join('、')}</p>
    <div class="plaza-photos">${post.images.map((image) => `
        <button class="image-viewer-trigger" data-image-viewer="${escapeHtml(image.thumbUrl || image.imageUrl)}"
          data-image-thumb="${escapeHtml(image.thumbUrl || image.imageUrl)}"
          data-image-display="${escapeHtml(image.displayUrl || image.imageUrl)}" data-image-alt="活动图片">
        <div class="image-shell">
          <img loading="lazy" decoding="async" fetchpriority="low" width="480" height="360"
            data-src="${escapeHtml(image.thumbUrl || image.imageUrl)}" alt="活动图片"
            onload="this.parentElement.classList.add('loaded')"
            onerror="this.hidden=true;this.parentElement.classList.add('failed')">
          <span class="image-error">图片加载失败</span>
        </div>
      </button>`).join('')}</div>
    <p>${escapeHtml(post.copy)}</p>
    <div class="row"><span class="muted">${formatDate(post.publishedAt)} · 浏览 <span data-detail-views>${post.viewCount}</span> · 今日剩余 ${post.likeQuota.remaining}/5 个赞</span><button class="right ${post.liked ? '' : 'secondary'}" id="likePost">${post.liked ? '取消点赞' : '点赞'} <span id="likeCount">${post.likeCount}</span></button></div>
    <section class="comments-panel">
      <h3>评论 <span id="commentCount">${post.commentCount}</span></h3>
      <form id="commentForm"><textarea name="content" maxlength="500" required placeholder="写下你的评论（最多500字）"></textarea><button>发布评论</button></form>
      <div id="commentList">${commentsHtml || '<p class="muted empty-comments">还没有评论</p>'}</div>
      ${commentResult.hasMore ? '<button class="secondary" id="moreComments">加载更多评论</button>' : ''}
    </section>
  </section></div>`;
  prepareDynamicContent(root);
  root.querySelector('#closePost').onclick = closePost;
  root.querySelector('#likePost').onclick = async (event) => {
    const button = event.currentTarget;
    const restoreButton = beginButtonLoading(button, post.liked ? '正在取消…' : '正在点赞…');
    const previousLiked = post.liked;
    try {
      const result = await api(`/api/plaza/${postId}/like`, {
        method: 'POST',
        body: JSON.stringify({ liked: !post.liked })
      });
      post.liked = result.liked;
      if (post.liked !== previousLiked) post.likeCount += post.liked ? 1 : -1;
      button.dataset.loading = 'false';
      button.disabled = false;
      button.innerHTML = `${post.liked ? '取消点赞' : '点赞'} <span id="likeCount">${post.likeCount}</span>`;
      button.classList.toggle('secondary', !post.liked);
      updatePlazaCachePost(postId, { likeCount: post.likeCount, liked: post.liked });
      updateVisiblePlazaCard(postId, { likeCount: post.likeCount });
      rankingViewCache.clear();
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
  const bindDeleteComments = () => root.querySelectorAll('.delete-comment').forEach((button) => {
    button.onclick = async (event) => {
      const item = button.closest('[data-comment]');
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
        await api(`/api/plaza/${postId}/comments/${item.dataset.comment}`, { method: 'DELETE' });
        item.remove();
        post.commentCount = Math.max(0, post.commentCount - 1);
        root.querySelector('#commentCount').textContent = post.commentCount;
        updatePlazaCachePost(postId, { commentCount: post.commentCount });
        updateVisiblePlazaCard(postId, { commentCount: post.commentCount });
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  bindDeleteComments();
  root.querySelector('#commentForm').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const submitButton = event.submitter || form.querySelector('button');
    const restoreButton = beginButtonLoading(submitButton, '发布中…');
    try {
      const result = await api(`/api/plaza/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: form.content.value })
      });
      root.querySelector('.empty-comments')?.remove();
      root.querySelector('#commentList').insertAdjacentHTML('afterbegin', `
        <article class="comment-item" data-comment="${result.comment.id}">
          <div><strong>${escapeHtml(result.comment.name)}</strong><span class="muted">${formatDate(result.comment.createdAt)}</span></div>
          <p>${escapeHtml(result.comment.content)}</p><button class="link-button delete-comment">删除</button>
        </article>`);
      root.querySelector('#commentCount').textContent = result.commentCount;
      post.commentCount = result.commentCount;
      updatePlazaCachePost(postId, { commentCount: post.commentCount });
      updateVisiblePlazaCard(postId, { commentCount: post.commentCount });
      form.reset();
      restoreButton();
      bindDeleteComments();
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
  let commentPage = 1;
  const moreComments = root.querySelector('#moreComments');
  if (moreComments) moreComments.onclick = async (event) => {
    const restoreButton = beginButtonLoading(event.currentTarget, '加载中…');
    try {
      commentPage += 1;
      const next = await api(`/api/plaza/${postId}/comments?page=${commentPage}&limit=10`);
      root.querySelector('#commentList').insertAdjacentHTML('beforeend', next.comments.map((comment) => `
        <article class="comment-item" data-comment="${comment.id}">
          <div><strong>${escapeHtml(comment.name)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div>
          <p>${escapeHtml(comment.content)}</p>
          ${comment.canDelete ? '<button class="link-button delete-comment">删除</button>' : ''}
        </article>`).join(''));
      restoreButton();
      moreComments.hidden = !next.hasMore;
      bindDeleteComments();
    } catch (error) {
      commentPage = Math.max(1, commentPage - 1);
      restoreButton();
      alert(error.message);
    }
  };
}

function checkinForm(slotId) {
  beginNavigation();
  const slot = config.slots.find((item) => item.id === slotId);
  app.innerHTML = `
    <header class="hero"><h1>${escapeHtml(slot.label)}打卡</h1><p>${slot.start}–${slot.end}，请上传水印相机截图。</p></header>
    <section class="card">
      <form id="send">
        <label>餐食水印截图（可多选）</label><input required name="photos" type="file" accept="image/*" multiple>
        <label>Elavatine 当日汇总截图（可选）</label><input name="summary" type="file" accept="image/*">
        <label>备注（可选）</label><textarea name="note"></textarea>
        <div class="row"><button type="button" class="secondary" id="back">返回</button><button>上传并提交</button></div>
      </form>
    </section>`;
  document.querySelector('#back').onclick = home;
  document.querySelector('#send').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const submitButton = event.submitter || form.querySelector('button:not([type="button"])');
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    try {
      const photos = await readFiles(form.photos.files, { businessType: 'meal-checkin', limit: 3 });
      const summary = form.summary.files[0]
        ? (await readFiles(form.summary.files, { businessType: 'meal-checkin', limit: 1 }))[0]
        : null;
      const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
      await api('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({
          date,
          slotId,
          photoMediaIds: photos.map((item) => item.mediaId),
          summaryMediaId: summary?.mediaId || null,
          note: form.note.value
        })
      });
      returnToCachedStudentHome('个人打卡成功');
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
}

/* ADMIN_CLIENT_LAZY_LOADER_V1 */
let adminClientModulePromise = null;
const loadAdminClient = (selectedDate, pageEpoch) => {
  if (user?.role !== 'admin') return Promise.resolve(false);
  if (!adminClientModulePromise) {
    const appScript = [...document.scripts].find((script) => new URL(script.src || location.href, location.href).pathname === '/app.js');
    const version = appScript ? new URL(appScript.src, location.href).searchParams.get('v') : '';
    const url = new URL('/admin-client.js', location.origin);
    if (version) url.searchParams.set('v', version);
    adminClientModulePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-admin-client]');
      if (existing?.dataset.loaded === 'true') return resolve();
      const script = existing || document.createElement('script');
      script.dataset.adminClient = 'true'; script.async = true; script.src = url.href;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('管理后台模块加载失败，请检查网络后重试。')); };
      if (!existing) document.head.append(script);
    }).catch((error) => {
      adminClientModulePromise = null;
      app.innerHTML = '<main class="boot-shell"><section class="boot-error">管理后台模块加载失败，请检查网络后重试。<br><button type="button" id="retryAdminClient">重新加载</button></section></main>';
      document.querySelector('#retryAdminClient').onclick = () => { void home({ showShell: false }); };
      throw error;
    });
  }
  return adminClientModulePromise.then(() => window.__ADMIN_CLIENT_RENDER__(selectedDate, pageEpoch));
};

if (window.__BOOTSTRAP_AUTHENTICATED__) home().catch(logout);
else if (token) api('/api/session', { method: 'POST' }).catch(() => null).then(home).catch(logout);
else login();
