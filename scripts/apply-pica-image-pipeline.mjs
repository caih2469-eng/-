import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');
const mediaRoutePath = path.resolve('cloudflare/routes/media.js');
const vendorSource = path.resolve('node_modules/image-blob-reduce/dist/image-blob-reduce.browser.min.js');
const vendorTarget = path.resolve('public/vendor/image-blob-reduce-5.0.1.min.js');
const marker = '/* PICA_IMAGE_PIPELINE_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  if (!source.includes(search)) throw new Error(`${label}未找到`);
  return source.replace(search, replacement);
};

await mkdir(path.dirname(vendorTarget), { recursive: true });
await copyFile(vendorSource, vendorTarget);

let app = await readFile(appPath, 'utf8');
if (!app.includes(marker)) {
  app = replaceOnce(
    app,
    'let imageCompressionLibraryPromise = null;',
    `let imageCompressionLibraryPromise = null;\nlet imagePipelineLibraryPromise = null;\nlet imagePipelineInstance = null;`,
    '图片处理状态变量'
  );

  const pipelineBlock = String.raw`${marker}
const IMAGE_PIPELINE_SCRIPT = '/vendor/image-blob-reduce-5.0.1.min.js';
const PICA_DISPLAY_MAX_EDGE = 2048;
const PICA_THUMB_MAX_EDGE = 960;
const PICA_DISPLAY_MAX_BYTES = 1_468_006;
const PICA_THUMB_MAX_BYTES = 491_520;

const loadImagePipelineLibrary = () => {
  if (typeof window.imageBlobReduce === 'function') return Promise.resolve(window.imageBlobReduce);
  if (imagePipelineLibraryPromise) return imagePipelineLibraryPromise;
  imagePipelineLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-image-pipeline-library]');
    const script = existing || document.createElement('script');
    const handleLoad = () => {
      if (typeof window.imageBlobReduce === 'function') resolve(window.imageBlobReduce);
      else reject(new Error('高清图片处理组件加载失败，请刷新后重试。'));
    };
    const handleError = () => reject(new Error('高清图片处理组件加载失败，请刷新后重试。'));
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.src = IMAGE_PIPELINE_SCRIPT;
      script.async = true;
      script.dataset.imagePipelineLibrary = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    imagePipelineLibraryPromise = null;
    throw error;
  });
  return imagePipelineLibraryPromise;
};

const getImagePipeline = async () => {
  if (imagePipelineInstance) return imagePipelineInstance;
  const factory = await loadImagePipelineLibrary();
  const pica = factory.pica({ tile: 1024, concurrency: 1 });
  const reducer = factory({ pica });
  imagePipelineInstance = { pica, reducer };
  return imagePipelineInstance;
};

const createPipelineCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const releasePipelineCanvas = (canvas) => {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
};

const browserSupportsWebp = (() => {
  try {
    const canvas = createPipelineCanvas(1, 1);
    const supported = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    releasePipelineCanvas(canvas);
    return supported;
  } catch {
    return false;
  }
})();

const encodePipelineCanvas = async (pica, canvas, profile) => {
  let mimeType = browserSupportsWebp ? 'image/webp' : 'image/jpeg';
  let blob = await pica.toBlob(canvas, mimeType, profile.quality);
  let header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!bytesMatchMime(header, mimeType)) {
    mimeType = 'image/jpeg';
    blob = await pica.toBlob(canvas, mimeType, profile.quality);
    header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  }
  if (!bytesMatchMime(header, mimeType)) throw new Error('当前浏览器无法稳定编码图片，请改用JPG后重试。');
  if (blob.size > profile.maxBytes) {
    blob = await pica.toBlob(canvas, mimeType, profile.fallbackQuality);
  }
  if (!blob?.size || blob.size > 1.5 * 1024 * 1024) {
    throw new Error('图片处理后仍然过大，请在相册中裁剪后重新上传。');
  }
  const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([blob], `${profile.baseName}-${profile.suffix}.${extension}`, {
    type: mimeType,
    lastModified: Date.now()
  });
  return {
    file,
    mimeType,
    width: canvas.width,
    height: canvas.height
  };
};

const prepareImageVariants = async (file, options = {}) => {
  const sourceFile = await normalizeSourceImage(file);
  if (options.signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
  options.onProgress?.(5);
  const { pica, reducer } = await getImagePipeline();
  const screenshotLike = sourceFile.type === 'image/png';
  let masterCanvas = null;
  let thumbCanvas = null;
  let smallerDisplayCanvas = null;
  try {
    masterCanvas = await reducer.toCanvas(sourceFile, {
      max: PICA_DISPLAY_MAX_EDGE,
      filter: 'mks2013'
    });
    if (options.signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
    options.onProgress?.(45);

    const thumbEdge = PICA_THUMB_MAX_EDGE;
    const thumbScale = Math.min(1, thumbEdge / Math.max(masterCanvas.width, masterCanvas.height));
    if (thumbScale < 1) {
      thumbCanvas = createPipelineCanvas(masterCanvas.width * thumbScale, masterCanvas.height * thumbScale);
      await pica.resize(masterCanvas, thumbCanvas, { filter: 'mks2013' });
    } else {
      thumbCanvas = masterCanvas;
    }
    options.onProgress?.(65);

    const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'image';
    let display = await encodePipelineCanvas(pica, masterCanvas, {
      baseName,
      suffix: 'display',
      quality: screenshotLike ? 0.94 : 0.90,
      fallbackQuality: screenshotLike ? 0.90 : 0.86,
      maxBytes: PICA_DISPLAY_MAX_BYTES
    });

    if (display.file.size > PICA_DISPLAY_MAX_BYTES
        && Math.max(masterCanvas.width, masterCanvas.height) > 1600) {
      const scale = 1600 / Math.max(masterCanvas.width, masterCanvas.height);
      smallerDisplayCanvas = createPipelineCanvas(masterCanvas.width * scale, masterCanvas.height * scale);
      await pica.resize(masterCanvas, smallerDisplayCanvas, { filter: 'mks2013' });
      display = await encodePipelineCanvas(pica, smallerDisplayCanvas, {
        baseName,
        suffix: 'display',
        quality: screenshotLike ? 0.91 : 0.87,
        fallbackQuality: screenshotLike ? 0.88 : 0.84,
        maxBytes: PICA_DISPLAY_MAX_BYTES
      });
    }

    const thumb = await encodePipelineCanvas(pica, thumbCanvas, {
      baseName,
      suffix: 'thumb',
      quality: screenshotLike ? 0.92 : 0.88,
      fallbackQuality: screenshotLike ? 0.89 : 0.84,
      maxBytes: PICA_THUMB_MAX_BYTES
    });
    const previewUrl = URL.createObjectURL(display.file);
    mediaPreviewUrls.add(previewUrl);
    display.previewUrl = previewUrl;
    options.onProgress?.(100);
    return { display, thumb };
  } finally {
    if (thumbCanvas && thumbCanvas !== masterCanvas) releasePipelineCanvas(thumbCanvas);
    if (smallerDisplayCanvas) releasePipelineCanvas(smallerDisplayCanvas);
    releasePipelineCanvas(masterCanvas);
  }
};

const prepareImageVariantsMeasured = async (file, options = {}) => {
  const startedAt = performance.now();
  let output = null;
  try {
    output = await prepareImageVariants(file, options);
    return output;
  } finally {
    recordPerf('compress', {
      variant: 'display+thumb',
      sourceBytes: Number(file?.size || 0),
      outputBytes: Number(output?.display?.file?.size || 0) + Number(output?.thumb?.file?.size || 0),
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};
`;

  app = app.replace(
    /const compressImage = async \(file, options = \{\}\) => \{/,
    `${pipelineBlock}\nconst compressImage = async (file, options = {}) => {`
  );

  app = replaceOnce(
    app,
    "  void loadImageCompressionLibrary().catch(() => {});",
    "  void loadImagePipelineLibrary().catch(() => {});",
    '个人打卡图片组件预加载'
  );

  const oldGenericFlow = `      let display = session.partial[index]?.display;
      if (!display) {
        setStatus(\`${'${position}'}：正在压缩 0%\`);
        const compressed = await compressImageMeasured(selected[index], {
          signal: controller.signal,
          variant: 'display',
          onProgress: (progress) => {
            const percent = Number(progress);
            if (Number.isFinite(percent)) {
              setStatus(\`${'${position}'}：正在压缩 ${'${Math.max(0, Math.min(100, Math.round(percent)))'}%\`);
            }
          }
        });
        display = await uploadCompressedImage(compressed, {
          ...context,
          variant: 'display',
          onStage: (stage) => setStatus(\`${'${position}'}：${'${stage}'}\`)
        }, controller.signal);
        session.partial[index] = { display };
      }
      setStatus(\`${'${position}'}：正在生成列表图片…\`);
      const thumbCompressed = await compressImageMeasured(display.file, {
        signal: controller.signal,
        variant: 'thumb',
        plazaThumb: context.businessType === 'task'
      });
      const thumb = await uploadCompressedImage(thumbCompressed, {
        ...context,
        variant: 'thumb',
        parentMediaId: display.mediaId,
        onStage: (stage) => setStatus(\`${'${position}'}：${'${stage}'}\`)
      }, controller.signal);
      session.results[index] = { ...display, thumbMediaId: thumb.mediaId };`;

  const newGenericFlow = `      let prepared = session.partial[index]?.prepared;
      if (!prepared) {
        setStatus(\`${'${position}'}：正在生成高清图和列表图 0%\`);
        prepared = await prepareImageVariantsMeasured(selected[index], {
          signal: controller.signal,
          onProgress: (progress) => setStatus(\`${'${position}'}：正在生成高清图和列表图 ${'${Math.round(Number(progress) || 0)'}%\`)
        });
        session.partial[index] = { prepared };
      }
      let display = session.partial[index]?.display;
      if (!display) {
        display = await uploadCompressedImage(prepared.display, {
          ...context,
          variant: 'display',
          onStage: (stage) => setStatus(\`${'${position}'}：${'${stage}'}\`)
        }, controller.signal);
        session.partial[index] = { prepared, display };
      }
      setStatus(\`${'${position}'}：正在上传列表图片…\`);
      const thumb = await uploadCompressedImage(prepared.thumb, {
        ...context,
        variant: 'thumb',
        parentMediaId: display.mediaId,
        onStage: (stage) => setStatus(\`${'${position}'}：${'${stage}'}\`)
      }, controller.signal);
      session.results[index] = { ...display, thumbMediaId: thumb.mediaId };`;

  app = replaceOnce(app, oldGenericFlow, newGenericFlow, '通用图片双版本上传流程');

  const oldMemberFlow = `      const sourceFile = await normalizeSourceImage(item.file);
      if (current !== session) return;
      item.compressed = await compressMemberCheckinImage(sourceFile, {
        signal: current.controller.signal,
        onProgress: (progress) => {
          if (current !== session) return;
          const percent = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
          status.textContent = \`第 ${'${index + 1}'}/${'${current.items.length}'} 张：正在压缩 ${'${percent}'}%\`;
        }
      });
      if (current !== session) return;
      status.textContent = \`第 ${'${index + 1}'}/${'${current.items.length}'} 张：正在上传…\`;
      item.uploadPromise = uploadMemberCheckinFast(
        item.compressed,
        task.id,
        item.idempotencyKey,
        current.controller.signal
      );
      updateReadyState();
      const uploaded = await item.uploadPromise;
      if (current !== session) return;
      item.mediaId = uploaded.mediaId;`;

  const newMemberFlow = `      const sourceFile = await normalizeSourceImage(item.file);
      if (current !== session) return;
      const prepared = await prepareImageVariantsMeasured(sourceFile, {
        signal: current.controller.signal,
        onProgress: (progress) => {
          if (current !== session) return;
          const percent = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
          status.textContent = \`第 ${'${index + 1}'}/${'${current.items.length}'} 张：正在生成高清图和列表图 ${'${percent}'}%\`;
        }
      });
      if (current !== session) return;
      status.textContent = \`第 ${'${index + 1}'}/${'${current.items.length}'} 张：正在上传高清图…\`;
      item.uploadPromise = uploadCompressedImage(prepared.display, {
        taskId: task.id,
        businessType: 'member-checkin',
        variant: 'display'
      }, current.controller.signal);
      updateReadyState();
      const display = await item.uploadPromise;
      if (current !== session) return;
      status.textContent = \`第 ${'${index + 1}'}/${'${current.items.length}'} 张：正在上传列表图…\`;
      const thumb = await uploadCompressedImage(prepared.thumb, {
        taskId: task.id,
        businessType: 'member-checkin',
        variant: 'thumb',
        parentMediaId: display.mediaId
      }, current.controller.signal);
      if (current !== session) return;
      item.compressed = prepared.display;
      item.mediaId = display.mediaId;
      item.thumbMediaId = thumb.mediaId;`;

  app = replaceOnce(app, oldMemberFlow, newMemberFlow, '个人打卡高清图与缩略图上传流程');
  await writeFile(appPath, app, 'utf8');
}

let mediaRoute = await readFile(mediaRoutePath, 'utf8');
mediaRoute = mediaRoute
  .replace('const THUMB_MAX_EDGE = 360;', 'const THUMB_MAX_EDGE = 960;')
  .replace('const PLAZA_THUMB_MAX_EDGE = 640;', 'const PLAZA_THUMB_MAX_EDGE = 960;')
  .replace('const DISPLAY_MAX_EDGE = 960;', 'const DISPLAY_MAX_EDGE = 2048;');
await writeFile(mediaRoutePath, mediaRoute, 'utf8');

process.stdout.write('Pica image pipeline applied.\n');
