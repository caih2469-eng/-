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
  for (let attempt = 0; attempt < (retryableMethod ? 2 : 1); attempt += 1) {
    let response;
    try {
      response = await apiRequest(url, options, method);
    } catch (error) {
      if (!retryableMethod || attempt > 0 || !/网络连接失败/.test(error.message)) throw error;
      await wait(300 + Math.floor(Math.random() * 301));
      continue;
    }
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
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60_000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch {
    if (timedOut) throw new Error('图片上传超时，请检查网络后重试。');
    if (options.signal?.aborted) throw new Error('图片上传已取消，请重新选择图片。');
    throw new Error('网络连接失败，请检查网络后重试。');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener?.('abort', forwardAbort);
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
const MEDIA_DISPLAY_MAX_EDGE = 960;
const MEDIA_THUMB_MAX_SIZE_MB = 0.12;
const MEDIA_DISPLAY_MAX_SIZE_MB = 0.7;
const MEDIA_THUMB_QUALITY = 0.72;
const MEDIA_DISPLAY_QUALITY = 0.78;
const MEMBER_FAST_MAX_BYTES = 307_200;
const MEMBER_FAST_MAX_EDGE = 960;
const MEDIA_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const mediaPreviewUrls = new Set();
let activeMediaController = null;

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
  const common = {
    maxSizeMB: isThumb ? MEDIA_THUMB_MAX_SIZE_MB : MEDIA_DISPLAY_MAX_SIZE_MB,
    maxWidthOrHeight: isThumb ? MEDIA_THUMB_MAX_EDGE : MEDIA_DISPLAY_MAX_EDGE,
    initialQuality: isThumb ? MEDIA_THUMB_QUALITY : MEDIA_DISPLAY_QUALITY,
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
      initialQuality: isThumb ? MEDIA_THUMB_QUALITY : MEDIA_DISPLAY_QUALITY
    });
    header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (blob.type !== 'image/jpeg' || !bytesMatchMime(header, 'image/jpeg')) {
      throw new Error('当前浏览器无法稳定生成压缩图片，请改用JPG后重试。');
    }
  }
  if (!blob.size || blob.size > 1.5 * 1024 * 1024) throw new Error('压缩后图片仍然过大，请重新选择图片。');
  const dimensions = await imageDimensions(blob);
  if (!dimensions.width || !dimensions.height || Math.max(dimensions.width, dimensions.height) > (isThumb ? MEDIA_THUMB_MAX_EDGE : MEDIA_DISPLAY_MAX_EDGE)) {
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
  const uploaded = await uploadBinary(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: image.file,
    signal
  });
  if (!uploaded.ok) throw new Error(`图片直传失败（${uploaded.status}），请重新选择图片。`);
  const confirmed = await api(`/api/media/upload-intents/${encodeURIComponent(intent.intentId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ parentMediaId: context.parentMediaId || null })
  });
  return { ...image, mediaId: confirmed.media.id };
};

const readFiles = async (files, context = {}) => {
  const selected = [...files];
  if (!selected.length) throw new Error('请选择图片。');
  if (selected.length > Number(context.limit || selected.length)) throw new Error(`最多上传${context.limit}张图片。`);
  activeMediaController?.abort();
  activeMediaController = new AbortController();
  const results = [];
  const isIOS = /iP(?:hone|ad|od)/.test(navigator.userAgent);
  const lowMemory = Number(navigator.deviceMemory || 8) <= 4;
  const concurrency = isIOS || lowMemory ? 1 : 2;
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const index = cursor++;
      const compressed = await compressImage(selected[index], {
        signal: activeMediaController.signal,
        variant: 'display'
      });
      const display = await uploadCompressedImage(compressed, {
        ...context,
        variant: 'display'
      }, activeMediaController.signal);
      const thumbCompressed = await compressImage(compressed.file, {
        signal: activeMediaController.signal,
        variant: 'thumb'
      });
      const thumb = await uploadCompressedImage(thumbCompressed, {
        ...context,
        variant: 'thumb',
        parentMediaId: display.mediaId
      }, activeMediaController.signal);
      results[index] = { ...display, thumbMediaId: thumb.mediaId };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  return results;
};
const renderPreviews = (container, images) => {
  container.innerHTML = images.map((item, index) => {
    const src = typeof item === 'string' ? item : item.previewUrl || item.imageUrl;
    return `<figure><img loading="lazy" decoding="async" src="${src}" alt="待上传图片 ${index + 1}"><figcaption>第 ${index + 1} 张</figcaption></figure>`;
  }).join('');
};
window.addEventListener('pagehide', () => {
  activeMediaController?.abort();
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
  if (!studentViewState.data || user?.role !== 'student') {
    showToast(successMessage);
    void home({ forceRefresh: true });
    return;
  }
  studentViewState.refreshError = null;
  studentViewState.scrollY = Math.max(0, Number(options.scrollY || 0));
  const pageEpoch = beginNavigation();
  void student(studentViewState.data, pageEpoch, { restoreScroll: true });
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
  return admin(undefined, pageEpoch);
}

async function student(dashboard, pageEpoch = beginNavigation(), options = {}) {
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
      status.textContent = '正在压缩图片…';
      current.compressed = await compressMemberCheckinImage(sourceFile, {
        signal: current.controller.signal
      });
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
      returnToCachedStudentHome('个人打卡成功');
    } catch (error) {
      alert(error?.message || '打卡提交失败，请稍后重试。');
      restoreButton();
    } finally {
      if (session) submitButton.disabled = !session.mediaId;
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
      <label>文字总结${task.summaryRequired ? '（必填）' : '（选填）'}</label><textarea name="summary">${escapeHtml(current?.summary || '')}</textarea>
      <div class="row"><button type="button" class="secondary" id="backMaterial">返回</button><button>提交材料</button></div>
    </form></section>`;
  document.querySelector('#backMaterial').onclick = home;
  const materialForm = document.querySelector('#materialSend');
  materialForm.files.onchange = async () => {
    try {
      if (materialForm.files.files.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 张图片`);
      materialForm._images = await readFiles(materialForm.files.files, {
        taskId: task.id, businessType: 'material-image', limit: task.fileLimit
      });
      renderPreviews(document.querySelector('#materialPreview'), materialForm._images);
    } catch (error) { alert(error.message); materialForm.files.value = ''; }
  };
  document.querySelector('#materialSend').onsubmit = async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || event.target.querySelector('button:not([type="button"])');
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    try {
      const selected = [...event.target.files.files];
      if (selected.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 个文件`);
      const images = event.target._images || await readFiles(selected, {
        taskId: task.id, businessType: 'material-image', limit: task.fileLimit
      });
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
      ${user.trackId === 'health' ? `<label>餐次</label><select name="mealType" required><option value="">请选择</option><option value="breakfast" ${current?.mealType === 'breakfast' ? 'selected' : ''}>早餐</option><option value="lunch" ${current?.mealType === 'lunch' ? 'selected' : ''}>午餐</option><option value="dinner" ${current?.mealType === 'dinner' ? 'selected' : ''}>晚餐</option></select>` : ''}
      <label>活动文案${task.copyRequirement ? '（必填）' : '（选填）'}</label><textarea name="copy">${escapeHtml(current?.copy || '')}</textarea>
      ${user.trackId === 'interaction' ? `<label class="check-label"><input name="isPublic" type="checkbox" ${current?.isPublic ? 'checked' : ''}> 同意发布至活动广场</label>
      <div id="plazaCopyField" style="display:${current?.isPublic ? 'block' : 'none'}"><label>广场作品文案（发布时必填）</label><textarea name="plazaCopy">${escapeHtml(current?.plazaCopy || '')}</textarea></div>` : ''}
      <div class="row"><button type="button" class="secondary" id="back">返回</button><button type="button" class="secondary" data-intent="draft">保存草稿</button><button data-intent="submit">最终提交</button></div>
    </form></section>`;
  document.querySelector('#back').onclick = home;
  const form = document.querySelector('#taskSend');
  form.images.onchange = async () => {
    try {
      if (form.images.files.length > task.imageLimit) throw new Error(`最多上传 ${task.imageLimit} 张图片`);
      form._media = await readFiles(form.images.files, {
        taskId: task.id, businessType: 'task', limit: task.imageLimit
      });
      renderPreviews(document.querySelector('#taskPreview'), form._media);
    } catch (error) {
      await openDialog({ title: '图片处理失败', message: error.message, confirmText: '重新选择' });
      form.images.value = '';
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
        const media = form.images.files.length ? (form._media || await readFiles(form.images.files, {
          taskId: task.id, businessType: 'task', limit: task.imageLimit
        })) : [];
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

async function adminComments(page = 1) {
  const pageEpoch = beginNavigation();
  const result = await api(`/api/admin/comments?page=${page}&limit=20`);
  if (!isCurrentNavigation(pageEpoch)) return;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>评论管理</h1><p>管理员可查看并删除活动广场中的违规评论</p></div><button class="secondary right" id="backComments">返回后台</button></div></header>
    <section class="card"><div class="admin-comment-list">${result.comments.map((comment) => `
      <article class="comment-item" data-comment="${comment.id}" data-post="${comment.postId || ''}">
        <div class="row"><strong>${escapeHtml(comment.userName)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div>
        <p>${escapeHtml(comment.content)}</p>
        <div class="row"><span class="muted">所属队伍：${escapeHtml(comment.teamName)}</span><button class="danger right delete-admin-comment">删除评论</button></div>
      </article>`).join('') || '<p class="muted">暂无评论</p>'}</div>
      <div class="row plaza-pager"><button class="secondary" id="prevAdminComments" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button class="secondary" id="nextAdminComments" ${!result.hasMore ? 'disabled' : ''}>下一页</button></div>
    </section>`;
  document.querySelector('#backComments').onclick = () => admin();
  document.querySelector('#prevAdminComments').onclick = () => adminComments(page - 1);
  document.querySelector('#nextAdminComments').onclick = () => adminComments(page + 1);
  document.querySelectorAll('.delete-admin-comment').forEach((button) => {
    button.onclick = async (event) => {
      const item = button.closest('[data-comment]');
      if (!await askConfirm('是否删除该评论？', '删除后活动广场会立即同步，且无法恢复。')) return;
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
        await api(`/api/admin/comments/${item.dataset.comment}`, { method: 'DELETE' });
        plazaViewCache.clear();
        item.remove();
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
}

async function admin(selectedDate, pageEpoch = beginNavigation()) {
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'admin';
  app.innerHTML = '<main class="app-shell-placeholder" aria-busy="true"><header class="hero"></header><section class="metric-grid"></section><section class="card"></section></main>';
  const date = selectedDate || new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai'
  });
  const [completion, userResult, teamResult, taskAdminResult, plazaAdminResult, overview, materialAdmin, governance] = await Promise.all([
    api(`/api/admin/completion-summary?date=${date}`),
    api(`/api/admin/users?page=${adminUserPage}&limit=30&q=${encodeURIComponent(adminUserQuery)}&completion=${adminUserFilter}&date=${date}&track=${adminCompletionTrack === 'all' ? '' : adminCompletionTrack}`),
    api('/api/admin/teams'),
    api('/api/admin/tasks'),
    api('/api/admin/plaza?page=1&limit=30'),
    api('/api/admin/overview'),
    api(`/api/admin/material-tasks?page=${materialAdminPage}&limit=30&campus=${encodeURIComponent(materialAdminCampus)}`),
    api('/api/admin/governance')
  ]);
  if (!isCurrentNavigation(pageEpoch)) return;
  const users = userResult.users;
  const userTiles = users.map((studentUser, index) => `
    <button class="admin-user-tile ${studentUser.completed ? 'completed' : 'missing'}" data-id="${studentUser.id}">
      <span class="user-number">${(userResult.page - 1) * userResult.limit + index + 1}</span>
      <strong>${escapeHtml(studentUser.name)}</strong>
      ${studentUser.completed ? '<span class="user-completion" aria-label="已完成">✓</span>' : ''}
    </button>`).join('');
  const overallSummary = completion.overall;
  const interactionSummary = completion.tracks.find((item) => item.trackId === 'interaction')
    || { completed: 0, total: 0 };
  const healthSummary = completion.tracks.find((item) => item.trackId === 'health')
    || { completed: 0, total: 0 };
  const teamRows = teamResult.teams.map((team) => `
    <tr>
      <td>${escapeHtml(team.name)}<br><small>邀请码：<strong>${escapeHtml(team.inviteCode)}</strong></small></td>
      <td>${team.memberCount}/${team.memberLimit}</td>
      <td>
        <div><strong>队长：${team.captain ? `${escapeHtml(team.captain.name)}（${escapeHtml(team.captain.studentId)}）` : '未指定'}</strong></div>
        <div class="member-list compact">${team.members.length
          ? team.members.map((member) => `<span>${escapeHtml(member.name)} <button class="mini danger remove-member" data-team="${team.id}" data-user="${member.id}" title="移除成员">×</button></span>`).join('')
          : '<span class="muted">空队伍</span>'}
        </div>
      </td>
      <td class="actions">
        <button class="secondary edit-team" data-id="${team.id}">修改</button>
        <button class="secondary add-team-member" data-id="${team.id}" ${team.isFull ? 'disabled' : ''}>加入成员</button>
        <button class="secondary set-captain" data-id="${team.id}">${team.captain ? '更换队长' : '指定队长'}</button>
        ${team.captain ? `<button class="secondary clear-captain" data-id="${team.id}">取消队长</button>` : ''}
        <button class="danger dissolve-team" data-id="${team.id}">解散</button>
      </td>
    </tr>`).join('');
  const taskStatusNames = { draft: '草稿', published: '发布', closed: '关闭', archived: '归档' };
  const submissionStatusNames = { draft: '草稿', submitted: '已提交', returned: '退回', approved: '通过' };
  const taskRows = taskAdminResult.tasks.map((task) => {
    const submissions = taskAdminResult.submissions.filter((item) => item.taskId === task.id);
    return `<tr><td>${escapeHtml(task.name)}</td><td>${escapeHtml(trackName(task.trackId))}</td><td>${taskStatusNames[task.status]}</td><td>${formatDate(task.startAt)}<br>${formatDate(task.endAt)}</td><td>${submissions.length}</td><td><button class="secondary edit-task" data-id="${task.id}">编辑</button></td></tr>`;
  }).join('');
  const submissionRows = taskAdminResult.submissions.map((item) => {
    const task = taskAdminResult.tasks.find((entry) => entry.id === item.taskId);
    return `<tr><td>${escapeHtml(task?.name || '已归档任务')}</td><td>${item.ownerType === 'team' ? '队伍' : '个人'} ${escapeHtml(item.ownerId)}</td><td>${submissionStatusNames[item.status] || item.status}</td><td>${item.images.map((url) => `<a href="${escapeHtml(url)}" target="_blank">图片</a>`).join(' ')}</td><td>${escapeHtml(item.copy)}</td><td>${item.status === 'submitted' ? `<button class="approve-submission" data-id="${item.id}">通过</button><button class="danger return-submission" data-id="${item.id}">退回</button>` : ''}<button class="danger delete-submission" data-id="${item.id}">删除</button></td></tr>`;
  }).join('');
  const plazaRows = plazaAdminResult.posts.map((post) => `<tr>
    <td>${escapeHtml(post.teamName)}</td><td>${escapeHtml(post.taskName)}</td><td>${post.members.map((member) => escapeHtml(member.name)).join('、')}</td>
    <td>${post.status === 'visible' ? '公开' : '已隐藏'}</td><td>${post.viewCount}</td><td>${post.likeCount}</td>
    <td><button class="secondary toggle-post" data-id="${post.id}" data-status="${post.status === 'visible' ? 'hidden' : 'visible'}">${post.status === 'visible' ? '隐藏' : '恢复'}</button><button class="secondary exclude-post" data-id="${post.id}" data-excluded="${!post.excludedFromRanking}">${post.excludedFromRanking ? '恢复排名' : '排除排名'}</button><button class="danger delete-post" data-id="${post.id}">删除</button></td>
  </tr>`).join('');
  const materialTaskRows = materialAdmin.tasks.map((task) => {
    const submissions = materialAdmin.submissions.filter((item) => item.taskId === task.id);
    const progress = materialAdmin.campusProgress?.find((item) => item.taskId === task.id)?.campuses || [];
    return `<tr><td>${escapeHtml(task.title)}</td><td>个人</td><td>${formatDate(task.deadline)}</td><td>${task.fileTypes.map((type) => `.${escapeHtml(type)}`).join('、')}</td><td>${submissions.length}</td><td>${progress.map((item) => `${escapeHtml(item.campus)} ${item.completed}/${item.total}`).join('<br>')}</td><td><button class="secondary missing-material" data-id="${task.id}">导出未提交名单</button></td></tr>`;
  }).join('');
  const materialSubmissionRows = materialAdmin.submissions.map((item) => {
    const task = materialAdmin.tasks.find((entry) => entry.id === item.taskId);
    return `<tr><td>${escapeHtml(task?.title || '已删除任务')}</td><td>${escapeHtml(item.owner?.campus || '未设置')}</td><td>${escapeHtml(item.owner?.name || item.ownerId)}<br><small>${escapeHtml(item.owner?.studentId || '')}</small></td><td>${item.status === 'returned' ? '已退回' : '已提交'}</td><td>${item.files.map((file) => `<button class="secondary admin-material-download" data-url="${file.downloadUrl}" data-name="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</button>`).join(' ')}</td><td>${escapeHtml(item.summary)}</td><td>${item.status === 'submitted' ? `<button class="danger return-material" data-id="${item.id}">退回修改</button>` : escapeHtml(item.reviewNote || '等待重新提交')}</td></tr>`;
  }).join('');

  app.innerHTML = `
    <header class="hero">
      <div class="row"><div><h1>活动管理后台</h1><div>${escapeHtml(config.activityName)}</div></div><button class="secondary right" id="ranking">排行榜</button><button class="secondary" id="plaza">活动广场</button><button class="secondary" id="commentAdmin">评论管理</button><button class="secondary" id="out">退出</button></div>
    </header>
    <section class="metric-grid">
      ${[['用户数量',overview.userCount],['队伍数量',overview.teamCount],['今日提交',overview.todaySubmissions],['公开帖子',overview.publicPostCount],['点赞数量',overview.likeCount],['浏览数量',overview.viewCount]].map(([label,value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
    </section>
    <section class="card">
      <details>
        <summary>修改我的管理员密码</summary>
        <form id="changeAdminPassword" class="inline-form">
          <input name="currentPassword" type="password" autocomplete="current-password" placeholder="当前密码" required>
          <input name="newPassword" type="password" autocomplete="new-password" minlength="8" placeholder="新密码（至少8位）" required>
          <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="再次输入新密码" required>
          <button>修改密码</button>
        </form>
      </details>
    </section>
    ${governance.isPrimary ? `<section class="card">
      <div class="row"><div><h2>管理员账号与操作监督</h2><p class="muted">只有最高管理员可以创建管理员，并查看、驳回其他管理员的补卡和审核操作。</p></div><span class="pill done">最高管理员</span></div>
      <details>
        <summary>创建管理员账号</summary>
        <form id="createAdmin" class="inline-form">
          <input name="studentId" placeholder="管理员账号" required>
          <input name="name" placeholder="管理员姓名" required>
          <input name="campus" placeholder="校区" value="金山学院" required>
          <input name="password" type="password" minlength="8" placeholder="初始密码（至少8位）" required>
          <button>创建管理员</button>
        </form>
      </details>
      <h3>管理员列表</h3>
      <div class="member-list">${governance.admins.map((item) => `<span>${escapeHtml(item.name)} · ${escapeHtml(item.studentId)} · ${item.id === user.id ? '最高管理员' : '管理员'}</span>`).join('')}</div>
      <h3>其他管理员操作记录</h3>
      <div class="table-wrap"><table><thead><tr><th>管理员</th><th>操作</th><th>对象</th><th>时间</th><th>状态</th><th>处理</th></tr></thead><tbody>
        ${governance.logs.map((item) => `<tr><td>${escapeHtml(item.actorName)}<br><small>${escapeHtml(item.actorStudentId)}</small></td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entityType)}</td><td>${formatDate(item.createdAt)}</td><td>${item.reviewStatus === 'rejected' ? '<span class="pill pending">已驳回</span>' : '<span class="pill done">有效</span>'}</td><td>${item.reviewStatus !== 'rejected' && ['makeup','approved','returned'].includes(item.action) ? `<button class="danger reject-admin-action" data-id="${item.id}">驳回操作</button>` : '仅查看'}</td></tr>`).join('') || '<tr><td colspan="6">暂无其他管理员操作</td></tr>'}
      </tbody></table></div>
    </section>` : ''}
    <section class="card admin-user-section">
      <div class="row completion-heading">
        <div><h2>每日完成情况</h2><p class="muted">三餐全部提交才计为“食光有约”当日完成；点击姓名查看详情或补卡</p></div>
        <label class="right">日期 <input id="date" type="date" value="${date}"></label><button class="secondary" id="reload">查询</button>
      </div>
      <div class="completion-summary-grid">
        <button class="completion-summary ${adminCompletionTrack === 'all' ? 'active' : ''}" data-track="all"><span>总完成情况</span><strong>${overallSummary.completed}/${overallSummary.total}</strong></button>
        <button class="completion-summary ${adminCompletionTrack === 'interaction' ? 'active' : ''}" data-track="interaction"><span>廿载同心</span><strong>${interactionSummary.completed}/${interactionSummary.total}</strong></button>
        <button class="completion-summary ${adminCompletionTrack === 'health' ? 'active' : ''}" data-track="health"><span>食光有约</span><strong>${healthSummary.completed}/${healthSummary.total}</strong></button>
      </div>
      <div class="row completion-list-heading"><strong>${adminCompletionTrack === 'interaction' ? '廿载同心' : adminCompletionTrack === 'health' ? '食光有约' : '全部赛道'}用户</strong><span class="right muted">共 ${userResult.total} 人</span></div>
      <form id="adminUserSearch" class="user-list-toolbar">
        <input name="query" value="${escapeHtml(adminUserQuery)}" placeholder="搜索姓名或学号" aria-label="搜索姓名或学号">
        <button>搜索</button>
      </form>
      <div class="user-filter-tabs" role="group" aria-label="完成状态筛选">
        ${[['all','全部用户'],['completed','已完成'],['missing','未完成']].map(([value,label]) =>
          `<button class="secondary user-filter ${adminUserFilter === value ? 'active' : ''}" data-filter="${value}">${label}</button>`).join('')}
      </div>
      <div class="admin-user-grid">${userTiles || '<p class="muted">没有符合条件的用户</p>'}</div>
      <div class="user-pagination">
        <button class="secondary" id="adminUserPrev" ${userResult.page <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${userResult.page} / ${Math.max(1, Math.ceil(userResult.total / userResult.limit))} 页</span>
        <button class="secondary" id="adminUserNext" ${userResult.page * userResult.limit >= userResult.total ? 'disabled' : ''}>下一页</button>
      </div>
    </section>
    <section class="card">
      <div class="row"><h2>活动任务管理</h2><span class="right muted">所有时间由服务端校验</span></div>
      <form id="switches" class="inline-form">
        <label><input type="checkbox" name="activityEnabled" ${config.activityEnabled ? 'checked' : ''}> 活动总开关</label>
        <label><input type="checkbox" name="interaction" ${config.trackEnabled?.interaction ? 'checked' : ''}> 四校区赛道</label>
        <label><input type="checkbox" name="health" ${config.trackEnabled?.health ? 'checked' : ''}> 自律赛道</label>
        <button>保存开关</button>
      </form>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>赛道</th><th>状态</th><th>时间</th><th>提交数</th><th>操作</th></tr></thead><tbody>${taskRows || '<tr><td colspan="6">尚无任务</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <h2>任务材料审核</h2>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>提交主体</th><th>状态</th><th>图片</th><th>文案</th><th>审核</th></tr></thead><tbody>${submissionRows || '<tr><td colspan="6">尚无材料</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><h2>活动广场管理</h2><span class="right muted">帖子仅由公开任务提交自动生成</span></div>
      <div class="table-wrap"><table><thead><tr><th>队伍</th><th>任务</th><th>成员</th><th>状态</th><th>浏览</th><th>点赞</th><th>操作</th></tr></thead><tbody>${plazaRows || '<tr><td colspan="7">暂无广场帖子</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><h2>最终截图证明</h2><span class="right muted">最多 8 张 · 压缩后单张不超过 5MB</span></div>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>方式</th><th>截止时间</th><th>图片类型</th><th>已提交</th><th>各校区进度</th><th>操作</th></tr></thead><tbody>${materialTaskRows || '<tr><td colspan="7">暂无截图任务</td></tr>'}</tbody></table></div>
      <h3>材料提交记录</h3>
      <div class="row"><label>校区筛选 <select id="materialCampus"><option value="">全部校区</option>${(materialAdmin.campuses || []).map((campus) => `<option value="${escapeHtml(campus)}" ${campus === materialAdminCampus ? 'selected' : ''}>${escapeHtml(campus)}</option>`).join('')}</select></label><span class="right">第 ${materialAdmin.pagination?.page || 1}/${materialAdmin.pagination?.pages || 1} 页，共 ${materialAdmin.pagination?.total || 0} 人</span><button class="secondary" id="materialPrev" ${materialAdminPage <= 1 ? 'disabled' : ''}>上一页</button><button class="secondary" id="materialNext" ${materialAdminPage >= (materialAdmin.pagination?.pages || 1) ? 'disabled' : ''}>下一页</button></div>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>校区</th><th>学生</th><th>状态</th><th>截图</th><th>总结</th><th>管理</th></tr></thead><tbody>${materialSubmissionRows || '<tr><td colspan="7">暂无截图提交</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><div><h2>Excel 数据导出</h2><p class="muted">学号按文本格式导出，不会变成科学计数法。</p></div><label class="right">缺卡日期 <input id="exportDate" type="date" value="${date}"></label><label>排行榜月份 <input id="exportMonth" type="month" value="${date.slice(0, 7)}"></label></div>
      <div class="export-buttons">${[['users','用户名单'],['teams','队伍名单'],['checkins','打卡记录'],['missing','缺卡名单'],['rankings','排行榜'],['materials','材料清单']].map(([type,label]) => `<button class="secondary export-data" data-type="${type}">${label}</button>`).join('')}</div>
    </section>
    <section class="card">
      <div class="row">
        <div><h2>互动赛道队伍</h2><p class="muted">已创建 ${teamResult.teamCount}/${teamResult.maxTeams} 个队伍</p></div>
        <form id="teamCapacity" class="inline-form right">
          <button type="button" class="secondary" id="decreaseCapacity">−</button>
          <input name="maxTeams" type="number" min="${teamResult.teamCount}" max="500" value="${teamResult.maxTeams}" aria-label="最大队伍数量">
          <button type="button" class="secondary" id="increaseCapacity">＋</button>
          <button>保存名额</button>
        </form>
      </div>
      <div class="table-wrap"><table><thead><tr><th>队伍</th><th>人数</th><th>成员</th><th>操作</th></tr></thead><tbody>${teamRows || '<tr><td colspan="4">尚未创建队伍</td></tr>'}</tbody></table></div>
    </section>
    <section class="grid admin-tools">
      <div class="card">
        <h2>创建队伍</h2>
        <form id="createTeam">
          <label>队伍名称</label><input name="name" required>
          <label>人数限制</label><input name="memberLimit" type="number" min="1" max="20" value="4" required>
          <button ${teamResult.teamCount >= teamResult.maxTeams ? 'disabled' : ''}>创建队伍</button>
        </form>
      </div>
      <div class="card">
        <h2>Excel 统一导入队伍</h2>
        <p class="muted">支持每行“队伍名称、成员1学号～成员4学号、队长学号”。队长学号可选，也可导入后在队伍列表中指定。</p>
        <form id="importTeams">
          <input name="file" type="file" accept=".xlsx" required>
          <button>导入并自动编队</button>
        </form>
      </div>
      <div class="card">
        <h2>创建活动任务</h2>
        <p class="muted">先选择任务类型，两种设置流程完全分开。</p>
        <div class="task-type-choices">
          <button id="createSingleTask" class="task-type-card" type="button"><span>单次任务</span><small>指定一次开始和截止时间</small></button>
          <button id="createPeriodicTask" class="task-type-card secondary" type="button"><span>周期任务</span><small>按星期和每日时段自动生成</small></button>
        </div>
      </div>
      <div class="card">
        <h2>创建最终截图证明任务</h2>
        <form id="createMaterialTask">
          <label>标题</label><input name="title" required>
          <label>描述</label><textarea name="description"></textarea>
          <label>截止时间</label><input name="deadline" type="datetime-local" required>
          <label>允许图片类型</label><input name="fileTypes" value="jpg, jpeg, png, webp" readonly required>
          <label>图片数量限制</label><input name="fileLimit" type="number" min="1" max="8" value="8" required>
          <input name="submissionMode" type="hidden" value="individual">
          <label><input name="summaryRequired" type="checkbox"> 需要文字总结</label>
          <button>创建材料任务</button>
        </form>
      </div>
      <div class="card">
        <h2>添加用户</h2>
        <form id="addUser">
          <label>姓名</label><input name="name" required>
          <label>学号</label><input name="studentId" required>
          <label>校区</label><input name="campus" required>
          <label>所属赛道</label><select name="trackId" required>${tracks.map((track) => `<option value="${track.id}">${escapeHtml(track.name)}</option>`).join('')}</select>
          <label>初始密码</label><input name="password" required>
          <label>账号状态</label><select name="status"><option value="active">启用</option><option value="disabled">禁用</option></select>
          <button>创建账号</button>
        </form>
      </div>
      <div class="card">
        <h2>Excel 导入名单</h2>
        <p class="muted">第一行必须包含：姓名、学号、校区、所属赛道、初始密码；可选“账号状态”。仅支持 .xlsx。</p>
        <form id="importUsers">
          <input name="file" type="file" accept=".xlsx" required>
          <button>导入名单</button>
        </form>
      </div>
      <div class="card">
        <h2>打卡时段设置</h2>
        <form id="settings">
          <label>活动名称</label><input name="activityName" value="${escapeHtml(config.activityName)}">
          ${config.slots.map((slot) => `<div class="row"><label class="slot-label">${escapeHtml(slot.label)}</label><input name="${slot.id}Start" type="time" value="${slot.start}"><span>至</span><input name="${slot.id}End" type="time" value="${slot.end}"></div>`).join('')}
          <button>保存设置</button>
        </form>
      </div>
    </section>
    <div id="modalRoot"></div>`;

  enhanceAdminSections();
  prepareDynamicContent(app);
  document.querySelector('#out').onclick = logout;
  document.querySelector('#ranking').onclick = () => rankings();
  document.querySelector('#plaza').onclick = () => plaza();
  document.querySelector('#commentAdmin').onclick = () => adminComments();
  document.querySelector('#changeAdminPassword').onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    if (values.newPassword !== values.confirmPassword) {
      alert('两次输入的新密码不一致');
      return;
    }
    try {
      await api('/api/admin/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword
        })
      });
      event.target.reset();
      alert('管理员密码已修改');
    } catch (error) { alert(error.message); }
  };
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
  document.querySelector('#reload').onclick = () =>
    admin(document.querySelector('#date').value);
  document.querySelectorAll('.completion-summary').forEach((button) => {
    button.onclick = () => {
      adminCompletionTrack = button.dataset.track;
      adminUserPage = 1;
      sessionStorage.adminCompletionTrack = adminCompletionTrack;
      sessionStorage.adminUserPage = '1';
      admin(date);
    };
  });
  document.querySelector('#adminUserSearch').onsubmit = (event) => {
    event.preventDefault();
    adminUserQuery = new FormData(event.target).get('query').trim();
    adminUserPage = 1;
    sessionStorage.adminUserQuery = adminUserQuery;
    sessionStorage.adminUserPage = '1';
    admin(date);
  };
  document.querySelectorAll('.user-filter').forEach((button) => {
    button.onclick = () => {
      adminUserFilter = button.dataset.filter;
      adminUserPage = 1;
      sessionStorage.adminUserFilter = adminUserFilter;
      sessionStorage.adminUserPage = '1';
      admin(date);
    };
  });
  document.querySelector('#adminUserPrev').onclick = () => {
    adminUserPage = Math.max(1, adminUserPage - 1);
    sessionStorage.adminUserPage = String(adminUserPage);
    admin(date);
  };
  document.querySelector('#adminUserNext').onclick = () => {
    adminUserPage += 1;
    sessionStorage.adminUserPage = String(adminUserPage);
    admin(date);
  };
  document.querySelectorAll('.admin-user-tile').forEach((button) => {
    button.onclick = () => openAdminUserDrawer(
      users.find((item) => item.id === button.dataset.id),
      teamResult.teams,
      date,
      taskAdminResult.tasks
    );
  });
  document.querySelector('#materialCampus').onchange = (event) => {
    materialAdminCampus = event.target.value;
    materialAdminPage = 1;
    admin(date);
  };
  document.querySelector('#materialPrev').onclick = () => { materialAdminPage = Math.max(1, materialAdminPage - 1); admin(date); };
  document.querySelector('#materialNext').onclick = () => { materialAdminPage += 1; admin(date); };
  const capacityForm = document.querySelector('#teamCapacity');
  const capacityInput = capacityForm.maxTeams;
  document.querySelector('#decreaseCapacity').onclick = () => {
    capacityInput.value = Math.max(teamResult.teamCount, Number(capacityInput.value) - 1);
  };
  document.querySelector('#increaseCapacity').onclick = () => {
    capacityInput.value = Math.min(500, Number(capacityInput.value) + 1);
  };
  capacityForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/team-capacity', {
        method: 'PATCH',
        body: JSON.stringify({ maxTeams: Number(capacityInput.value) })
      });
      alert('队伍名额已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#createTeam').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/teams', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('队伍创建成功');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#importTeams').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const encoded = await readRawFile(event.target.file.files[0]);
      const result = await api('/api/admin/teams/import', { method: 'POST', body: JSON.stringify({ file: encoded }) });
      alert(`成功导入 ${result.importedTeams} 个队伍、${result.importedMembers} 名成员`);
      admin(date);
    } catch (error) { alert(error.message); }
  };
  document.querySelector('#addUser').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('账号创建成功');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#importUsers').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const file = event.target.file.files[0];
      const encoded = await readRawFile(file);
      const result = await api('/api/admin/users/import', {
        method: 'POST',
        body: JSON.stringify({ file: encoded })
      });
      alert(`成功导入 ${result.imported} 个用户`);
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#settings').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const slots = config.slots.map((slot) => ({
      ...slot,
      start: form.get(`${slot.id}Start`),
      end: form.get(`${slot.id}End`)
    }));
    try {
      await api('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ activityName: form.get('activityName'), slots })
      });
      alert('设置已保存');
      home();
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelectorAll('.edit-user').forEach((button) => {
    button.onclick = () => editUser(users.find((item) => item.id === button.dataset.id), date);
  });
  document.querySelectorAll('.edit-team').forEach((button) => {
    button.onclick = () =>
      editTeam(teamResult.teams.find((team) => team.id === button.dataset.id), date);
  });
  document.querySelectorAll('.remove-member').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm(
        '是否将该成员踢出队伍？',
        '踢出后，该成员将退出当前队伍。',
        { cancelText: '取消踢出队伍', confirmText: '确定踢出队伍' }
      )) return;
      try {
        await api(`/api/admin/teams/${button.dataset.team}/members/${button.dataset.user}`, {
          method: 'DELETE'
        });
        admin(date);
      } catch (error) {
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.add-team-member').forEach((button) => {
    button.onclick = async () => {
      const studentId = await askText('加入队伍成员', '请输入要加入该队伍的学生学号。', '学生学号');
      if (!studentId) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/members`, { method: 'POST', body: JSON.stringify({ studentId }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.set-captain').forEach((button) => {
    button.onclick = async () => {
      const studentId = await askText('指定队长', '该学生必须已经在当前队伍中。', '队长学号');
      if (!studentId) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: JSON.stringify({ studentId }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.clear-captain').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm('是否取消队长？', '取消后，该队伍将暂时没有队长。')) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: '{}' });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.dissolve-team').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm(
        '是否解散该队伍？',
        '确认后将解除全部成员关系并解散队伍，此操作不可恢复。',
        { cancelText: '取消解散', confirmText: '确定解散' }
      )) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}`, { method: 'DELETE' });
        await admin(date);
        alert('队伍已解散');
      } catch (error) {
        alert(`解散失败：${error.message}`);
      }
    };
  });
  document.querySelectorAll('.toggle-user').forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.status === 'disabled' ? '禁用' : '启用';
      if (!await askConfirm(`是否${action}该用户？`, `${action}后将立即影响该账号的登录状态。`)) return;
      try {
        await api(`/api/admin/users/${button.dataset.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: button.dataset.status })
        });
        admin(date);
      } catch (error) {
        alert(error.message);
      }
    };
  });
  document.querySelector('#switches').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    await api('/api/admin/activity-switches', { method: 'PATCH', body: JSON.stringify({ activityEnabled: form.activityEnabled.checked, trackEnabled: { interaction: form.interaction.checked, health: form.health.checked } }) });
    home();
  };
  document.querySelector('#createSingleTask').onclick = () => openTaskCreator('single', date);
  document.querySelector('#createPeriodicTask').onclick = () => openTaskCreator('periodic', date);
  document.querySelector('#createMaterialTask').onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    try {
      await api('/api/admin/material-tasks', { method: 'POST', body: JSON.stringify({ ...values, fileLimit: Number(values.fileLimit), summaryRequired: event.target.summaryRequired.checked }) });
      alert('材料任务创建成功');
      admin(date);
    } catch (error) { alert(error.message); }
  };
  document.querySelectorAll('.edit-task').forEach((button) => {
    button.onclick = () => editTask(taskAdminResult.tasks.find((task) => task.id === button.dataset.id), date);
  });
  document.querySelectorAll('.approve-submission,.return-submission').forEach((button) => {
    button.onclick = async () => {
      const returning = button.classList.contains('return-submission');
      const reviewNote = returning ? await askText('退回任务提交', '请填写退回原因。', '退回原因') : '';
      if (returning && !reviewNote) return;
      try {
        await api(`/api/admin/submissions/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: returning ? 'returned' : 'approved', reviewNote }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.delete-submission').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm('是否删除该提交？', '关联的广场帖子也会删除，此操作不可恢复。')) return;
      await api(`/api/admin/submissions/${button.dataset.id}`, { method: 'DELETE' });
      admin(date);
    };
  });
  document.querySelectorAll('.toggle-post').forEach((button) => {
    button.onclick = async (event) => {
      const restoreButton = beginButtonLoading(event.currentTarget, '处理中…');
      try {
        await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
        plazaViewCache.clear();
        rankingViewCache.clear();
        admin(date);
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.delete-post').forEach((button) => {
    button.onclick = async (event) => {
      if (!await askConfirm('是否永久删除该广场帖子？', '任务提交记录不会删除，此操作不可恢复。')) return;
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
        await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'DELETE' });
        plazaViewCache.clear();
        rankingViewCache.clear();
        admin(date);
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.exclude-post').forEach((button) => {
    button.onclick = async (event) => {
      const restoreButton = beginButtonLoading(event.currentTarget, '处理中…');
      try {
        await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ excludedFromRanking: button.dataset.excluded === 'true' }) });
        plazaViewCache.clear();
        rankingViewCache.clear();
        admin(date);
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.export-data').forEach((button) => {
    button.onclick = async () => {
      const exportDate = document.querySelector('#exportDate').value;
      const exportMonth = document.querySelector('#exportMonth').value;
      try {
        await downloadApiFile(`/api/admin/exports/${button.dataset.type}?date=${exportDate}&month=${exportMonth}`);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.admin-material-download').forEach((button) => {
    button.onclick = () => downloadProtectedFile(button.dataset.url, button.dataset.name).catch((error) => alert(error.message));
  });
  document.querySelectorAll('.return-material').forEach((button) => {
    button.onclick = async () => {
      const reviewNote = await askText('退回最终截图证明', '请填写需要修改的原因。', '退回原因');
      if (!reviewNote) return;
      await api(`/api/admin/material-submissions/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ reviewNote }) });
      admin(date);
    };
  });
  document.querySelectorAll('.missing-material').forEach((button) => {
    button.onclick = () => downloadApiFile(`/api/admin/material-tasks/${button.dataset.id}/missing-export`).catch((error) => alert(error.message));
  });
  requestAnimationFrame(() => window.scrollTo(0, Number(sessionStorage.adminScrollY || 0)));
}

function enhanceAdminSections() {
  const sections = [...document.querySelectorAll('#app > section.card, .admin-tools > .card')];
  sections.forEach((section, index) => {
    if (section.classList.contains('admin-user-section')) return;
    const title = section.querySelector('h2');
    if (!title) return;
    const key = `adminSection:${title.textContent.trim()}`;
    const primary = title.textContent.includes('每日提交');
    const expanded = sessionStorage.getItem(key) === null
      ? primary
      : sessionStorage.getItem(key) === 'open';
    const first = section.firstElementChild;
    const body = document.createElement('div');
    body.className = 'admin-collapsible-body';
    [...section.children].filter((child) => child !== first).forEach((child) => body.append(child));
    section.append(body);
    section.classList.add('admin-collapsible');
    section.classList.toggle('is-open', expanded);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-section-toggle secondary';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.innerHTML = `<span>${expanded ? '收起' : '展开'}</span><b aria-hidden="true">⌄</b>`;
    first.classList.add('admin-collapsible-heading');
    first.append(toggle);
    toggle.onclick = () => {
      const open = section.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('span').textContent = open ? '收起' : '展开';
      sessionStorage.setItem(key, open ? 'open' : 'closed');
    };
  });
}

function openAdminUserDrawer(studentUser, teams, date, tasks = []) {
  const root = document.querySelector('#modalRoot');
  const team = teams.find((item) => item.members.some((member) => member.id === studentUser.id));
  const isHealth = studentUser.trackId === 'health';
  const interactionTasks = tasks.filter((task) => task.trackId === 'interaction');
  const sectionState = new Map();
  root.innerHTML = `<div class="drawer-backdrop" id="userDrawerBackdrop">
    <section class="bottom-drawer" role="dialog" aria-modal="true" aria-labelledby="userDrawerTitle">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">用户详情</small><h2 id="userDrawerTitle">${escapeHtml(studentUser.name)}</h2></div>
        <button class="secondary right" id="closeUserDrawer">关闭</button>
      </div>
      <div class="drawer-summary">
        <div><span>学号</span><strong>${escapeHtml(studentUser.studentId)}</strong></div>
        <div><span>账号状态</span><strong>${studentUser.status === 'active' ? '启用' : '禁用'}</strong></div>
        <div><span>所属赛道</span><strong>${escapeHtml(trackName(studentUser.trackId))}</strong></div>
        <div><span>最近状态</span><strong>${studentUser.completed ? '已完成' : '未完成'}</strong></div>
      </div>
      <div class="drawer-accordions">
        ${[
          ['records', '最近打卡记录', studentUser.submittedAt ? formatDate(studentUser.submittedAt) : '暂无提交', true],
          ['profile', '基本资料', `${studentUser.campus || '未设置'} · 累计 ${Number(studentUser.totalCompletedDays || 0)} 天`, false],
          ['team', '所属队伍', team?.name || '未加入队伍', false],
          ['makeup', '补卡权限', '点击查看当前状态', false],
          ['adminMakeup', '管理员代为补卡', '按需展开', false],
          ['manage', '管理操作', '编辑或禁用账号', false]
        ].map(([key, label, summary, open]) => `
          <section class="drawer-accordion ${open ? 'is-open' : ''}" data-drawer-section="${key}">
            <button class="drawer-accordion-toggle" type="button" aria-expanded="${open}">
              <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(summary)}</small></span><b aria-hidden="true">›</b>
            </button>
            <div class="drawer-accordion-panel" ${open ? '' : 'hidden'}><div class="drawer-panel-inner" data-panel-content="${key}"></div></div>
          </section>`).join('')}
      </div>
    </section>
  </div>`;

  const backdrop = root.querySelector('#userDrawerBackdrop');
  const drawer = root.querySelector('.bottom-drawer');
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

  const renderImages = (images, label) => images.length
    ? `<div class="drawer-photo-grid compact">${images.map((media, index) => {
      const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl;
      const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
      return `
        <button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
          data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
          data-image-alt="${escapeHtml(label)}">
          <span class="image-shell"><img data-src="${escapeHtml(thumbUrl)}" data-priority="${index === 0 ? 'high' : ''}"
            loading="${index === 0 ? 'eager' : 'lazy'}" fetchpriority="${index === 0 ? 'high' : 'auto'}"
            width="480" height="360" decoding="async" alt="${escapeHtml(label)}"
            onload="this.parentElement.classList.add('loaded')"
            onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败，点击重试</span></span>
        </button>`;
    }).join('')}</div>` : '';

  const loadRecords = async (panel, force = false) => {
    if (sectionState.get('records') && !force) return;
    sectionState.set('records', 'loading');
    panel.innerHTML = '<p class="muted">正在读取最近打卡记录…</p>';
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/checkins?date=${encodeURIComponent(date)}`);
      const bySlot = new Map(result.records.map((item) => [item.slotId, item]));
      const records = isHealth ? config.slots.map((slot) => {
        const record = bySlot.get(slot.id);
        return record ? { ...record, taskName: slot.label } : null;
      }).filter(Boolean) : result.records;
      panel.innerHTML = records.length ? `<div class="meal-status-grid">${records.map((record) => `
        <article class="meal-status-card completed">
          <div class="row"><strong>${escapeHtml(record.taskName || record.slotId || '打卡')}</strong><span class="pill done">${escapeHtml(record.status || '已提交')}</span></div>
          <small>${escapeHtml(formatDate(record.submittedAt))}</small>
          ${renderImages(record.images || [], `${record.taskName || record.slotId || '打卡'}图片`)}
          ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ''}
        </article>`).join('')}</div>` : '<p class="muted">当日暂无提交</p>';
      prepareDynamicContent(panel);
      const firstImageMedia = result.records.flatMap((item) => item.images || [])[0];
      const firstImage = typeof firstImageMedia === 'string'
        ? firstImageMedia
        : firstImageMedia?.displayUrl || firstImageMedia?.thumbUrl;
      if (firstImage) {
        const preload = new Image();
        preload.decoding = 'async';
        preload.fetchPriority = 'low';
        preload.src = firstImage;
      }
      sectionState.set('records', 'loaded');
    } catch (error) {
      panel.innerHTML = `<button class="secondary retry-drawer-records">读取失败，点击重试</button>`;
      panel.querySelector('.retry-drawer-records').onclick = () => loadRecords(panel, true);
      sectionState.delete('records');
    }
  };

  const loadSection = async (key, panel) => {
    if (key === 'records') return loadRecords(panel);
    if (sectionState.get(key)) return;
    sectionState.set(key, 'loaded');
    if (key === 'profile') {
      panel.innerHTML = `<dl class="user-detail-list">
        <div><dt>姓名</dt><dd>${escapeHtml(studentUser.name)}</dd></div>
        <div><dt>学号</dt><dd>${escapeHtml(studentUser.studentId)}</dd></div>
        <div><dt>校区</dt><dd>${escapeHtml(studentUser.campus || '未设置')}</dd></div>
        <div><dt>创建时间</dt><dd>${escapeHtml(formatDate(studentUser.createdAt))}</dd></div>
        <div><dt>累计完成</dt><dd>${Number(studentUser.totalCompletedDays || 0)} 天</dd></div>
      </dl>`;
    } else if (key === 'team') {
      panel.innerHTML = team
        ? `<p><strong>${escapeHtml(team.name)}</strong></p><p class="muted">${team.memberCount}/${team.memberLimit} 人</p>`
        : '<p class="muted">该用户尚未加入队伍</p>';
    } else if (key === 'makeup') {
      panel.innerHTML = '<p class="muted">正在读取补卡权限…</p>';
      try {
        const permission = await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup-permission?date=${encodeURIComponent(date)}`);
        let enabled = Boolean(permission.enabled);
        panel.innerHTML = `<div class="row"><p class="muted">仅对 ${escapeHtml(date)} 生效；默认关闭。</p>
          <button class="${enabled ? 'danger' : 'secondary'} right" id="toggleMakeupPermission">${enabled ? '关闭用户补卡' : '允许用户补卡'}</button></div>`;
        panel.querySelector('#toggleMakeupPermission').onclick = async (event) => {
          event.currentTarget.disabled = true;
          try {
            await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup-permission?date=${encodeURIComponent(date)}`, {
              method: 'PUT', body: JSON.stringify({ enabled: !enabled })
            });
            enabled = !enabled;
            event.currentTarget.textContent = enabled ? '关闭用户补卡' : '允许用户补卡';
            event.currentTarget.className = enabled ? 'danger right' : 'secondary right';
          } catch (error) { alert(error.message); }
          finally { event.currentTarget.disabled = false; }
        };
      } catch (error) {
        panel.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
      }
    } else if (key === 'adminMakeup') {
      panel.innerHTML = `<form id="adminMakeupForm">
        ${isHealth
          ? `<label>餐次</label><select name="slotId">${config.slots.map((slot) => `<option value="${slot.id}">${escapeHtml(slot.label)}</option>`).join('')}</select>`
          : `<label>活动任务</label><select name="taskId" required>${interactionTasks.map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`).join('')}</select>`}
        <label>补卡图片</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" required>
        ${isHealth ? '<label>备注（可选）</label><textarea name="note"></textarea>' : ''}
        <button>确认管理员补卡</button>
      </form>`;
      panel.querySelector('#adminMakeupForm').onsubmit = async (event) => {
        event.preventDefault();
        const form = event.target;
        const submit = form.querySelector('button');
        submit.disabled = true;
        try {
          const photos = await readFiles(form.photos.files, {
            taskId: isHealth ? null : form.taskId.value,
            businessType: 'admin-makeup',
            limit: isHealth ? 3 : 1
          });
          await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup`, {
            method: 'POST',
            body: JSON.stringify(isHealth
              ? { date, slotId: form.slotId.value, mediaIds: photos.map((item) => item.mediaId), note: form.note.value }
              : { date, taskId: form.taskId.value, mediaIds: photos.map((item) => item.mediaId) })
          });
          const recordsPanel = root.querySelector('[data-panel-content="records"]');
          sectionState.delete('records');
          await loadRecords(recordsPanel, true);
          alert('补卡已完成');
        } catch (error) { alert(error.message); }
        finally { submit.disabled = false; }
      };
    } else if (key === 'manage') {
      panel.innerHTML = `<div class="drawer-actions">
        <button class="secondary" id="editDrawerUser">编辑用户</button>
        <button class="${studentUser.status === 'active' ? 'danger' : 'secondary'}" id="toggleDrawerUser">${studentUser.status === 'active' ? '禁用用户' : '启用用户'}</button>
      </div>`;
      panel.querySelector('#editDrawerUser').onclick = () => editUser(studentUser, date);
      panel.querySelector('#toggleDrawerUser').onclick = async (event) => {
        const next = studentUser.status === 'active' ? 'disabled' : 'active';
        const action = next === 'disabled' ? '禁用' : '启用';
        if (!await askConfirm(`是否${action}该用户？`, `${action}后将立即影响该账号的登录状态。`)) return;
        event.currentTarget.disabled = true;
        try {
          await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: next })
          });
          studentUser.status = next;
          event.currentTarget.textContent = next === 'active' ? '禁用用户' : '启用用户';
          event.currentTarget.className = next === 'active' ? 'danger' : 'secondary';
        } catch (error) { alert(error.message); }
        finally { event.currentTarget.disabled = false; }
      };
    }
  };

  root.querySelectorAll('.drawer-accordion-toggle').forEach((toggle) => {
    toggle.onclick = () => {
      const section = toggle.closest('.drawer-accordion');
      const key = section.dataset.drawerSection;
      const shouldOpen = !section.classList.contains('is-open');
      root.querySelectorAll('.drawer-accordion').forEach((item) => {
        item.classList.remove('is-open');
        item.querySelector('.drawer-accordion-toggle').setAttribute('aria-expanded', 'false');
        item.querySelector('.drawer-accordion-panel').hidden = true;
      });
      if (!shouldOpen) return;
      section.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      const panel = section.querySelector('.drawer-accordion-panel');
      panel.hidden = false;
      void loadSection(key, panel.querySelector('.drawer-panel-inner'));
    };
  });
  const initialRecords = root.querySelector('[data-panel-content="records"]');
  void loadRecords(initialRecords);
}

function taskFormFields(task = {}, requestedType = '') {
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const nextWeek = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const type = requestedType || (task.scheduleType === 'oneTime' ? 'single' : 'periodic');
  const formId = task.id ? 'editTask' : 'createTask';
  const commonStart = `<form id="${formId}" data-task-type="${type}">
    <input type="hidden" name="scheduleType" value="${type === 'single' ? 'oneTime' : 'weekly'}">
    <label>${type === 'single' ? '任务名称' : '任务模板名称'}</label><input name="name" value="${escapeHtml(task.name || '')}" required>
    <label>描述</label><textarea name="description">${escapeHtml(task.description || '')}</textarea>
    <label>所属赛道</label><select name="trackId">${tracks.map((track) => `<option value="${track.id}" ${track.id === task.trackId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select>`;
  const scheduleFields = type === 'single'
    ? `<label>开始日期和时间</label><input name="startAt" type="datetime-local" value="${escapeHtml((task.startAt || '').slice(0, 16))}" required>
       <label>截止日期和时间</label><input name="endAt" type="datetime-local" value="${escapeHtml((task.endAt || '').slice(0, 16))}" required>`
    : `<label>周期开始日期</label><input name="activeStartDate" type="date" value="${escapeHtml(task.activeStartDate || todayKey)}" required>
       <label>周期结束日期</label><input name="activeEndDate" type="date" value="${escapeHtml(task.activeEndDate || nextWeek)}" required>
       <fieldset class="weekday-picker"><legend>周一至周日多选</legend>${['一','二','三','四','五','六','日'].map((label, index) =>
         `<label><input type="checkbox" name="weekdays" value="${index + 1}" ${(task.weekdays || [1,3,5]).includes(index + 1) ? 'checked' : ''}><span>周${label}</span></label>`).join('')}</fieldset>
       <label>每日开放时间</label><input name="dailyStart" type="time" value="${task.dailyStart || '00:00'}" required>
       <label>每日截止时间</label><input name="dailyEnd" type="time" value="${task.dailyEnd || '23:59'}" required>`;
  return `${commonStart}${scheduleFields}
    <label>图片数量限制</label><input name="imageLimit" type="number" min="1" max="3" value="${Math.min(task.imageLimit || 3, 3)}" required>
    <label>文案要求</label><textarea name="copyRequirement">${escapeHtml(task.copyRequirement || '')}</textarea>
    ${task.id ? `<label>任务状态</label><select name="status">${[['draft','草稿'],['published','发布'],['closed','关闭'],['archived','归档']].map(([value,label]) => `<option value="${value}" ${task.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` : '<input type="hidden" name="status" value="published">'}
    <button>${task.id ? '保存修改' : type === 'single' ? '发布任务' : '保存周期任务'}</button>
  </form>`;
}

function taskPayload(form) {
  const values = Object.fromEntries(new FormData(form));
  const weekdays = [...form.querySelectorAll('input[name="weekdays"]:checked')].map((input) => Number(input.value));
  if (form.dataset.taskType === 'periodic' && !weekdays.length) throw new Error('周期任务至少选择一个星期');
  if (form.dataset.taskType === 'periodic' && values.dailyStart >= values.dailyEnd) {
    throw new Error('每日截止时间必须晚于每日开放时间');
  }
  return {
    ...values,
    allowLate: false,
    imageLimit: Number(values.imageLimit),
    weekdays,
    refreshDays: [],
    activeStartDate: values.activeStartDate || '',
    activeEndDate: values.activeEndDate || '',
    dailyStart: values.dailyStart || '',
    dailyEnd: values.dailyEnd || '',
    startAt: values.startAt || '',
    endAt: values.endAt || ''
  };
}

function openTaskCreator(type, date) {
  const root = document.querySelector('#modalRoot');
  const title = type === 'single' ? '创建单次任务' : '创建周期任务';
  root.innerHTML = `<div class="modal-backdrop task-page-backdrop"><section class="card modal task-editor">
    <div class="row"><div><small class="muted">活动任务</small><h2>${title}</h2></div><button id="closeTask" class="secondary right">关闭</button></div>
    ${taskFormFields({}, type)}
  </section></div>`;
  document.querySelector('#closeTask').onclick = () => { root.innerHTML = ''; };
  document.querySelector('#createTask').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify(taskPayload(event.target)) });
      root.innerHTML = '';
      await admin(date);
      alert(type === 'single' ? '单次任务已发布' : '周期任务已保存');
    } catch (error) { alert(error.message); }
  };
}

function editTask(task, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><section class="card modal"><div class="row"><h2>编辑任务</h2><button id="closeTask" class="secondary right">关闭</button></div>${taskFormFields(task)}</section></div>`;
  document.querySelector('#closeTask').onclick = () => { root.innerHTML = ''; };
  document.querySelector('#editTask').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(taskPayload(event.target)) });
      admin(date);
    } catch (error) { alert(error.message); }
  };
}

function editTeam(team, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>修改队伍</h2><button class="secondary right" id="closeTeamModal">关闭</button></div>
        <form id="editTeam">
          <label>队伍名称</label><input name="name" value="${escapeHtml(team.name)}" required>
          <label>人数限制</label><input name="memberLimit" type="number" min="${team.memberCount}" max="20" value="${team.memberLimit}" required>
          <p class="muted">当前 ${team.memberCount} 名成员，人数限制不能低于当前成员数。</p>
          <button>保存修改</button>
        </form>
      </section>
    </div>`;
  document.querySelector('#closeTeamModal').onclick = () => {
    root.innerHTML = '';
  };
  document.querySelector('#editTeam').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/teams/${team.id}`, {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('队伍已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
}

function editUser(studentUser, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>编辑用户</h2><button class="secondary right" id="closeModal">关闭</button></div>
        <form id="editUser">
          <label>姓名</label><input name="name" value="${escapeHtml(studentUser.name)}" required>
          <label>学号</label><input name="studentId" value="${escapeHtml(studentUser.studentId)}" required>
          <label>校区</label><input name="campus" value="${escapeHtml(studentUser.campus)}" required>
          <label>所属赛道</label><select name="trackId">${tracks.map((track) => `<option value="${track.id}" ${track.id === studentUser.trackId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select>
          <label>账号状态</label><select name="status"><option value="active" ${studentUser.status === 'active' ? 'selected' : ''}>启用</option><option value="disabled" ${studentUser.status === 'disabled' ? 'selected' : ''}>禁用</option></select>
          <label>新密码（不修改请留空）</label><input name="password" type="password">
          <button>保存修改</button>
        </form>
      </section>
    </div>`;
  document.querySelector('#closeModal').onclick = () => {
    root.innerHTML = '';
  };
  document.querySelector('#editUser').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/users/${studentUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('用户资料已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
}

function reviewCheckin(students, checkinId, date) {
  let checkin;
  for (const studentUser of students) {
    checkin = studentUser.slots.find((item) => item && item.id === checkinId);
    if (checkin) break;
  }
  const root = document.querySelector('#modalRoot');
  const reviewImage = (media, index, alt) => {
    const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl;
    const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
    return `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
      data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
      data-image-alt="${escapeHtml(alt)}"><span class="image-shell">
      <img data-src="${escapeHtml(thumbUrl)}" loading="${index === 0 ? 'eager' : 'lazy'}"
        data-priority="${index === 0 ? 'high' : ''}" fetchpriority="${index === 0 ? 'high' : 'low'}"
        decoding="async" width="480" height="360" alt="${escapeHtml(alt)}"
        onload="this.parentElement.classList.add('loaded')"
        onerror="this.hidden=true;this.parentElement.classList.add('failed')">
      <span class="image-error">图片加载失败</span></span></button>`;
  };
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>审核材料</h2><button class="secondary right" id="closeReview">关闭</button></div>
    <div class="photos">${checkin.photos.map((photo, index) => reviewImage(photo, index, '打卡截图')).join('')}${checkin.summary ? reviewImage(checkin.summary, checkin.photos.length, '汇总截图') : ''}</div>
        <p>${escapeHtml(checkin.note || '无备注')}</p>
        <button id="approve">通过</button> <button class="danger" id="reject">驳回</button>
      </section>
    </div>`;
  prepareDynamicContent(root);
  document.querySelector('#closeReview').onclick = () => {
    root.innerHTML = '';
  };
  const update = async (status) => {
    try {
      await api(`/api/admin/checkins/${checkinId}`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#approve').onclick = () => update('approved');
  document.querySelector('#reject').onclick = () => update('rejected');
}

if (window.__BOOTSTRAP_AUTHENTICATED__) home().catch(logout);
else if (token) api('/api/session', { method: 'POST' }).catch(() => null).then(home).catch(logout);
else login();
