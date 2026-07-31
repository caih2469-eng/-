import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');
const mediaRoutePath = path.resolve('cloudflare/routes/media.js');
const vendorSource = path.resolve('node_modules/image-blob-reduce/dist/image-blob-reduce.browser.min.js');
const vendorTarget = path.resolve('public/vendor/image-blob-reduce-5.0.1.min.js');
const runtimeTemplatePath = path.resolve('templates/pica-image-pipeline-runtime.txt');
const genericFlowTemplatePath = path.resolve('templates/pica-generic-upload-flow.txt');
const memberFlowTemplatePath = path.resolve('templates/pica-member-upload-flow.txt');
const marker = '/* PICA_IMAGE_PIPELINE_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  if (!source.includes(search)) throw new Error(`${label}未找到`);
  return source.replace(search, replacement);
};

const replaceRegexOnce = (source, pattern, replacement, label) => {
  const match = source.match(pattern);
  if (!match) throw new Error(`${label}未找到`);
  return source.replace(pattern, replacement.trimEnd());
};

await mkdir(path.dirname(vendorTarget), { recursive: true });
await copyFile(vendorSource, vendorTarget);

const [runtimeTemplate, genericFlowTemplate, memberFlowTemplate] = await Promise.all([
  readFile(runtimeTemplatePath, 'utf8'),
  readFile(genericFlowTemplatePath, 'utf8'),
  readFile(memberFlowTemplatePath, 'utf8')
]);

let app = await readFile(appPath, 'utf8');
if (!app.includes(marker)) {
  app = replaceOnce(
    app,
    'let imageCompressionLibraryPromise = null;',
    'let imageCompressionLibraryPromise = null;\nlet imagePipelineLibraryPromise = null;\nlet imagePipelineInstance = null;',
    '图片处理状态变量'
  );

  app = replaceRegexOnce(
    app,
    /const compressImage = async \(file, options = \{\}\) => \{/,
    `${runtimeTemplate.trimEnd()}\n\nconst compressImage = async (file, options = {}) => {`,
    '图片运行时插入位置'
  );

  app = replaceOnce(
    app,
    '  void loadImageCompressionLibrary().catch(() => {});',
    '  void loadImagePipelineLibrary().catch(() => {});',
    '个人打卡图片组件预加载'
  );

  app = replaceRegexOnce(
    app,
    /      let display = session\.partial\[index\]\?\.display;[\s\S]*?      session\.results\[index\] = \{ \.\.\.display, thumbMediaId: thumb\.mediaId \};/,
    genericFlowTemplate,
    '通用图片双版本上传流程'
  );

  app = replaceRegexOnce(
    app,
    /      const sourceFile = await normalizeSourceImage\(item\.file\);[\s\S]*?      item\.mediaId = uploaded\.mediaId;/,
    memberFlowTemplate,
    '个人打卡高清图与缩略图上传流程'
  );

  await writeFile(appPath, app, 'utf8');
}

let mediaRoute = await readFile(mediaRoutePath, 'utf8');
mediaRoute = mediaRoute
  .replace('const THUMB_MAX_EDGE = 360;', 'const THUMB_MAX_EDGE = 960;')
  .replace('const PLAZA_THUMB_MAX_EDGE = 640;', 'const PLAZA_THUMB_MAX_EDGE = 960;')
  .replace('const DISPLAY_MAX_EDGE = 960;', 'const DISPLAY_MAX_EDGE = 2048;');
if (!mediaRoute.includes('const THUMB_MAX_EDGE = 960;')
    || !mediaRoute.includes('const PLAZA_THUMB_MAX_EDGE = 960;')
    || !mediaRoute.includes('const DISPLAY_MAX_EDGE = 2048;')) {
  throw new Error('媒体服务尺寸限制更新失败');
}
await writeFile(mediaRoutePath, mediaRoute, 'utf8');

process.stdout.write('Pica image pipeline applied.\n');
