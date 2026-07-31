import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');
const stylePath = path.resolve('public/style.css');
const plazaRoutePath = path.resolve('cloudflare/routes/plaza.js');
const pageTemplatePath = path.resolve('templates/plaza-mobile-page.txt');
const styleTemplatePath = path.resolve('templates/plaza-mobile-style.css');
const routeTemplatePath = path.resolve('templates/plaza-route-search.txt');
const marker = '/* PLAZA_MOBILE_LAYOUT_V1 */';

const replaceRegexOnce = (source, pattern, replacement, label) => {
  const match = source.match(pattern);
  if (!match) throw new Error(`${label}未找到，已停止以避免误改`);
  return source.replace(pattern, replacement);
};

const [pageTemplate, styleTemplate, routeTemplate] = await Promise.all([
  readFile(pageTemplatePath, 'utf8'),
  readFile(styleTemplatePath, 'utf8'),
  readFile(routeTemplatePath, 'utf8')
]);

let app = await readFile(appPath, 'utf8');
if (!app.includes(marker)) {
  app = replaceRegexOnce(
    app,
    /const renderPlazaPage = \(result, sort, page, month, pageEpoch, options = \{\}\) => \{[\s\S]*?\n\}\n\nfunction rankingTable/,
    `${pageTemplate.trimEnd()}\n\nfunction rankingTable`,
    '活动广场页面函数'
  );
  await writeFile(appPath, app, 'utf8');
}

let style = await readFile(stylePath, 'utf8');
if (!style.includes(marker)) {
  style = `${style.trimEnd()}\n\n${styleTemplate.trim()}\n`;
  await writeFile(stylePath, style, 'utf8');
}

let plazaRoute = await readFile(plazaRoutePath, 'utf8');
if (!plazaRoute.includes(marker)) {
  plazaRoute = replaceRegexOnce(
    plazaRoute,
    /  if \(route === '\/api\/plaza' && request\.method === 'GET'\) \{[\s\S]*?\n  \}\n\n  const detailMatch/,
    `${routeTemplate.trimEnd()}\n\n  const detailMatch`,
    '活动广场查询路由'
  );
  await writeFile(plazaRoutePath, plazaRoute, 'utf8');
}

if (!(await readFile(appPath, 'utf8')).includes(marker)
    || !(await readFile(stylePath, 'utf8')).includes(marker)
    || !(await readFile(plazaRoutePath, 'utf8')).includes(marker)) {
  throw new Error('活动广场移动端布局生成不完整');
}

process.stdout.write('Applied mobile plaza layout, search and masonry feed.\n');
