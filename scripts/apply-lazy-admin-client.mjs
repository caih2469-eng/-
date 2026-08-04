import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'public/app.js');
const modulePath = path.join(root, 'public/admin-client.js');
const headersPath = path.join(root, 'public/_headers');
const loaderMarker = '/* LAZY_ADMIN_CLIENT_MODULE_V1 */';
const moduleMarker = '/* ADMIN_CLIENT_MODULE_V1 */';
const startAnchor = 'async function adminComments(page = 1) {';
const startupAnchor = 'if (window.__BOOTSTRAP_AUTHENTICATED__)';
const restoreRequested = process.argv.includes('--restore');

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

const buildLoader = (preservedMarkers = []) => [
  loaderMarker,
  ...preservedMarkers,
  'let adminClientModulePromise = null;',
  'const loadAdminClient = (selectedDate, pageEpoch = beginNavigation()) => {',
  "  if (user?.role !== 'admin') return Promise.resolve(false);",
  "  if (typeof window.__ADMIN_CLIENT_ENTRY__ === 'function') {",
  '    return Promise.resolve(window.__ADMIN_CLIENT_ENTRY__(selectedDate, pageEpoch));',
  '  }',
  '  if (!adminClientModulePromise) {',
  "    const appScript = [...document.scripts].find((script) => /\\/app\\.js(?:\\?|$)/.test(script.src));",
  "    const version = appScript ? new URL(appScript.src, location.href).searchParams.get('v') : '';",
  "    const moduleUrl = new URL('/admin-client.js', location.origin);",
  "    if (version) moduleUrl.searchParams.set('v', version);",
  '    const startedAt = performance.now();',
  '    adminClientModulePromise = new Promise((resolve, reject) => {',
  "      const existing = document.querySelector('script[data-admin-client-module]');",
  "      if (existing?.dataset.loaded === 'true') { resolve(true); return; }",
  "      const script = existing || document.createElement('script');",
  "      script.dataset.adminClientModule = 'true';",
  '      script.async = true;',
  '      script.src = moduleUrl.href;',
  "      script.onload = () => { script.dataset.loaded = 'true'; resolve(true); };",
  "      script.onerror = () => { script.remove(); reject(new Error('管理后台模块加载失败')); };",
  '      if (!existing) document.head.appendChild(script);',
  '    })',
  '      .then(() => {',
  "        if (typeof window.__ADMIN_CLIENT_ENTRY__ !== 'function') throw new Error('管理后台模块初始化失败');",
  "        recordPerf('module-load', { module: 'admin-client', status: 'ready', duration: roundedDuration(startedAt) });",
  '        return true;',
  '      })',
  '      .catch((error) => {',
  "        recordPerf('module-load', { module: 'admin-client', status: 'failed', duration: roundedDuration(startedAt), message: error.message });",
  '        adminClientModulePromise = null;',
  "        app.innerHTML = '<section class=\"boot-shell\"><div class=\"boot-error\">管理后台加载失败，请检查网络后重试。<br><button type=\"button\" id=\"retryAdminClient\">重新加载</button></div></section>';",
  "        document.querySelector('#retryAdminClient').onclick = () => { void home({ showShell: false }); };",
  '        return false;',
  '      });',
  '  }',
  '  return adminClientModulePromise.then((loaded) => {',
  '    if (!loaded) return false;',
  '    return window.__ADMIN_CLIENT_ENTRY__(selectedDate, pageEpoch);',
  '  });',
  '};'
].join('\n');

let app = fs.readFileSync(appPath, 'utf8');

if (restoreRequested) {
  const loaderStart = app.indexOf(loaderMarker);
  if (loaderStart < 0) {
    process.stdout.write('Admin client source is already restored.\n');
    process.exit(0);
  }
  if (!fs.existsSync(modulePath)) throw new Error('无法恢复管理端源码：模块文件不存在');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const moduleBodyStart = moduleSource.indexOf(startAnchor);
  const moduleEntryStart = moduleSource.lastIndexOf('\n\nwindow.__ADMIN_CLIENT_ENTRY__');
  const startupStart = app.indexOf(startupAnchor, loaderStart);
  if (moduleBodyStart < 0 || moduleEntryStart <= moduleBodyStart || startupStart <= loaderStart) {
    throw new Error('无法恢复管理端源码：模块边界不完整');
  }
  const adminBlock = moduleSource.slice(moduleBodyStart, moduleEntryStart).trimEnd();
  app = `${app.slice(0, loaderStart).trimEnd()}\n\n${adminBlock}\n\n${app.slice(startupStart)}`;
  if (app.includes('return loadAdminClient(undefined, pageEpoch);')) {
    app = replaceOnce(
      app,
      '  return loadAdminClient(undefined, pageEpoch);',
      '  return admin(undefined, pageEpoch);',
      '管理端同步入口恢复'
    );
  }
  if (app.includes(loaderMarker) || !app.includes(startAnchor) || !app.includes('return admin(undefined, pageEpoch);')) {
    throw new Error('管理端源码恢复不完整');
  }
  new Function(app);
  fs.writeFileSync(appPath, app, 'utf8');
  process.stdout.write('Restored admin client source before runtime generators.\n');
  process.exit(0);
}

const blockStart = app.indexOf(startAnchor);
const startupStart = app.indexOf(startupAnchor);

if (blockStart >= 0) {
  if (startupStart < 0 || startupStart <= blockStart) {
    throw new Error('无法定位管理端代码结束位置，已停止以避免误删');
  }
  const adminBlock = app.slice(blockStart, startupStart).trimEnd();
  const preservedMarkers = [...new Set(
    adminBlock.match(/\/\*\s*[A-Z][A-Z0-9_-]*_V\d+\s*\*\//g) || []
  )];
  const moduleSource = `${moduleMarker}\n${adminBlock}\n\nwindow.__ADMIN_CLIENT_ENTRY__ = (selectedDate, pageEpoch) => admin(selectedDate, pageEpoch);\n`;
  new Function(moduleSource);
  fs.writeFileSync(modulePath, moduleSource, 'utf8');

  let before = app.slice(0, blockStart).trimEnd();
  const after = app.slice(startupStart);
  if (!before.includes(loaderMarker)) {
    before = `${before}\n\n${buildLoader(preservedMarkers)}`;
  }
  app = `${before}\n\n${after}`;
}

if (!app.includes(loaderMarker)) {
  throw new Error('主应用缺少管理端按需加载器');
}
if (app.includes(startAnchor)) {
  throw new Error('管理端函数仍残留在主应用');
}
if (app.includes('return admin(undefined, pageEpoch);')) {
  app = replaceOnce(
    app,
    '  return admin(undefined, pageEpoch);',
    '  return loadAdminClient(undefined, pageEpoch);',
    '管理端首页入口'
  );
}
if (!app.includes('return loadAdminClient(undefined, pageEpoch);')) {
  throw new Error('管理端首页未切换为按需加载');
}

if (!fs.existsSync(modulePath)) throw new Error('管理端模块文件未生成');
const moduleSource = fs.readFileSync(modulePath, 'utf8');
if (!moduleSource.includes(moduleMarker)
    || !moduleSource.includes(startAnchor)
    || !moduleSource.includes('async function admin(')
    || !moduleSource.includes('function openAdminUserDrawer(')
    || !moduleSource.includes('window.__ADMIN_CLIENT_ENTRY__')) {
  throw new Error('管理端模块生成不完整');
}
new Function(app);
new Function(moduleSource);
fs.writeFileSync(appPath, app, 'utf8');

let headers = fs.readFileSync(headersPath, 'utf8');
if (!headers.includes('/admin-client.js')) {
  const appHeader = '/app.js\n  Cache-Control: public, max-age=31536000, immutable\n';
  headers = replaceOnce(
    headers,
    appHeader,
    `${appHeader}\n/admin-client.js\n  Cache-Control: public, max-age=31536000, immutable\n`,
    '主应用缓存头'
  );
  fs.writeFileSync(headersPath, headers, 'utf8');
}

process.stdout.write('Generated an admin-only lazy-loaded client module.\n');
