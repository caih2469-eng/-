import fs from 'node:fs';
import path from 'node:path';

const oldMarker = '/* HEALTH_CLIENT_CHECKIN_V1 */';
const loaderMarker = '/* LAZY_HEALTH_CLIENT_MODULE_V1 */';
const moduleMarker = '/* HEALTH_CLIENT_CHECKIN_MODULE_V1 */';
const appPath = path.resolve('public/app.js');
const modulePath = path.resolve('public/health-checkin.js');
const templatePath = path.resolve('templates/health-client-checkin-home.txt');

if (!fs.existsSync(appPath)) throw new Error('public/app.js不存在');
if (!fs.existsSync(templatePath)) throw new Error('健康自律客户端模板不存在');

const template = fs.readFileSync(templatePath, 'utf8').trim();
fs.writeFileSync(modulePath, `${moduleMarker}\n${template}\n`, 'utf8');

let source = fs.readFileSync(appPath, 'utf8');
if (source.includes(oldMarker)) {
  const exactBlock = `${template}\n\n${oldMarker}`;
  if (source.includes(exactBlock)) {
    source = source.replace(exactBlock, '');
  } else {
    const startAnchor = "(() => {\n  const healthClientVersion = 'health-client-checkin-v1';";
    const start = source.lastIndexOf(startAnchor, source.indexOf(oldMarker));
    const markerStart = source.indexOf(oldMarker, Math.max(0, start));
    if (start < 0 || markerStart < 0) {
      throw new Error('无法定位旧健康打卡内联代码，已停止以避免误删');
    }
    source = `${source.slice(0, start)}${source.slice(markerStart + oldMarker.length)}`;
  }
}

if (!source.includes(loaderMarker)) {
  const loader = [
    loaderMarker,
    'let healthClientModulePromise = null;',
    'const loadHealthClientModule = () => {',
    "  if (user?.role !== 'student' || user.trackId !== 'health') return Promise.resolve(false);",
    '  if (healthClientModulePromise) return healthClientModulePromise;',
    "  const appScript = [...document.scripts].find((script) => /\\/app\\.js(?:\\?|$)/.test(script.src));",
    "  const version = appScript ? new URL(appScript.src, location.href).searchParams.get('v') : '';",
    "  const moduleUrl = new URL('/health-checkin.js', location.origin);",
    "  if (version) moduleUrl.searchParams.set('v', version);",
    '  const startedAt = performance.now();',
    '  healthClientModulePromise = new Promise((resolve, reject) => {',
    "    const existing = document.querySelector('script[data-health-checkin-module]');",
    '    if (existing?.dataset.loaded === \'true\') { resolve(true); return; }',
    "    const script = existing || document.createElement('script');",
    "    script.dataset.healthCheckinModule = 'true';",
    '    script.async = true;',
    '    script.src = moduleUrl.href;',
    "    script.onload = () => { script.dataset.loaded = 'true'; resolve(true); };",
    "    script.onerror = () => reject(new Error('健康打卡模块加载失败'));",
    '    if (!existing) document.head.appendChild(script);',
    '  })',
    '    .then((loaded) => {',
    "      recordPerf('module-load', { module: 'health-checkin', status: 'ready', duration: roundedDuration(startedAt) });",
    '      return loaded;',
    '    })',
    '    .catch((error) => {',
    "      recordPerf('module-load', { module: 'health-checkin', status: 'failed', duration: roundedDuration(startedAt), message: error.message });",
    "      const section = document.querySelector('#activityTasks');",
    "      if (section && document.body.dataset.view === 'student') {",
    "        section.innerHTML = '<div class=\"row\"><h2>今日打卡</h2><span class=\"right muted\">加载失败</span></div><p class=\"bad\">健康打卡模块加载失败，请重新进入。</p>';",
    '      }',
    '      healthClientModulePromise = null;',
    '      return false;',
    '    });',
    '  return healthClientModulePromise;',
    '};',
    "if (user?.role === 'student' && user.trackId === 'health') void loadHealthClientModule();"
  ].join('\n');
  source = `${source.trimEnd()}\n\n${loader}\n`;
}

if (source.includes(oldMarker)
    || source.includes("const healthClientVersion = 'health-client-checkin-v1'")
    || !source.includes(loaderMarker)
    || !source.includes("user.trackId !== 'health'")
    || !source.includes("/health-checkin.js")) {
  throw new Error('健康打卡按需加载生成不完整');
}

fs.writeFileSync(appPath, source, 'utf8');

console.log('Generated a health-only lazy-loaded client module.');
