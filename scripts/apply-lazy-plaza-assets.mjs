import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const bootstrapPath = path.join(root, 'public/bootstrap.js');
const appPath = path.join(root, 'public/app.js');
const pageTemplatePath = path.join(root, 'templates/plaza-mobile-page.txt');
const bootstrapMarker = '/* LAZY_PLAZA_BOOTSTRAP_V1 */';
const entryMarker = '/* LAZY_PLAZA_ENTRY_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

const installBootstrapLoader = (source) => {
  let next = source;
  if (!next.includes(bootstrapMarker)) {
    const loader = [
      `  ${bootstrapMarker}`,
      '  const featureScriptPromises = new Map();',
      '  const loadFeatureScript = (src) => {',
      '    const existing = featureScriptPromises.get(src);',
      '    if (existing) return existing;',
      '    const promise = loadScript(src).catch((error) => {',
      '      featureScriptPromises.delete(src);',
      '      throw error;',
      '    });',
      '    featureScriptPromises.set(src, promise);',
      '    return promise;',
      '  };',
      '  window.__LOAD_PLAZA_EXTRAS__ = () => {',
      '    const startedAt = performance.now();',
      '    return Promise.all([',
      "      loadFeatureScript('/plaza-auto-masonry.js?v=20260730-flow2'),",
      "      loadFeatureScript('/plaza-comment-mode.js?v=20260730-flow2')",
      '    ])',
      '      .then(() => {',
      "        window.__RECORD_PERF__('plaza-extras-ready', {",
      "          status: 'ready',",
      '          duration: Math.round((performance.now() - startedAt) * 10) / 10',
      '        });',
      '        return true;',
      '      })',
      '      .catch((error) => {',
      "        window.__RECORD_PERF__('plaza-extras-ready', {",
      "          status: 'failed',",
      '          duration: Math.round((performance.now() - startedAt) * 10) / 10,',
      "          message: error?.message || 'load failed'",
      '        });',
      '        return false;',
      '      });',
      '  };',
      ''
    ].join('\n');
    next = replaceOnce(
      next,
      '  const showNetworkError = () => {',
      `${loader}  const showNetworkError = () => {`,
      '按需资源加载器插入位置'
    );
  }

  next = next
    .replace(/\n\s*await loadScript\('\/plaza-auto-masonry\.js\?v=[^']+'\);/g, '')
    .replace(/\n\s*await loadScript\('\/plaza-comment-mode\.js\?v=[^']+'\);/g, '');
  return next;
};

const installPlazaEntry = (source, label) => {
  if (source.includes(entryMarker)) return source;
  const pattern = /(async function plaza\([^\n]+\) \{\r?\n  const pageEpoch = beginNavigation\(\);)/;
  if (!pattern.test(source)) throw new Error(`未找到${label}中的活动广场入口`);
  return source.replace(
    pattern,
    `$1\n  ${entryMarker}\n  void window.__LOAD_PLAZA_EXTRAS__?.();`
  );
};

const bootstrap = installBootstrapLoader(fs.readFileSync(bootstrapPath, 'utf8'));
const app = installPlazaEntry(fs.readFileSync(appPath, 'utf8'), '主应用');
const pageTemplate = installPlazaEntry(fs.readFileSync(pageTemplatePath, 'utf8'), '活动广场模板');

fs.writeFileSync(bootstrapPath, bootstrap, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(pageTemplatePath, pageTemplate, 'utf8');

if (!bootstrap.includes(bootstrapMarker)
    || !bootstrap.includes("loadFeatureScript('/plaza-auto-masonry.js?v=")
    || !bootstrap.includes("loadFeatureScript('/plaza-comment-mode.js?v=")
    || bootstrap.includes("await loadScript('/plaza-auto-masonry.js?v=")
    || bootstrap.includes("await loadScript('/plaza-comment-mode.js?v=")
    || !app.includes(entryMarker)
    || !pageTemplate.includes(entryMarker)) {
  throw new Error('活动广场按需资源生成不完整');
}

process.stdout.write('Applied lazy activity-plaza enhancement assets.\n');
