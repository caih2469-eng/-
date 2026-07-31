import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');
const stylePath = path.resolve('public/style.css');
const plazaRoutePath = path.resolve('cloudflare/routes/plaza.js');
const memberTestPath = path.resolve('test/member-checkin-fast.test.js');
const pageTemplatePath = path.resolve('templates/plaza-mobile-page.txt');
const styleTemplatePath = path.resolve('templates/plaza-mobile-style.css');
const routeTemplatePath = path.resolve('templates/plaza-route-search.txt');
const marker = '/* PLAZA_MOBILE_LAYOUT_V1 */';

const replaceBetween = (source, startAnchor, endAnchor, replacement, label) => {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${label}锚点未找到，已停止以避免误改（start=${start}, end=${end}）`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

const [pageTemplate, styleTemplate, routeTemplate] = await Promise.all([
  readFile(pageTemplatePath, 'utf8'),
  readFile(styleTemplatePath, 'utf8'),
  readFile(routeTemplatePath, 'utf8')
]);

let app = await readFile(appPath, 'utf8');
if (!app.includes(marker)) {
  app = replaceBetween(
    app,
    'const renderPlazaPage',
    'function rankingTable',
    `${pageTemplate.trimEnd()}\n\n`,
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
  plazaRoute = replaceBetween(
    plazaRoute,
    "  if (route === '/api/plaza' && request.method === 'GET') {",
    '  const detailMatch',
    `${routeTemplate.trimEnd()}\n\n`,
    '活动广场查询路由'
  );
  await writeFile(plazaRoutePath, plazaRoute, 'utf8');
}

let memberTest = await readFile(memberTestPath, 'utf8');
const pairedUploadTest = String.raw`test('单人打卡使用Pica生成2048px高清图与960px列表图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const memberBody = app.match(
    /function memberCheckinForm\(task\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction materialSubmissionForm/
  )?.[1] || '';
  assert.match(memberBody, /prepareImageVariantsMeasured\(sourceFile/);
  assert.match(memberBody, /uploadPreparedImagePair\(prepared/);
  assert.match(memberBody, /businessType:\s*'member-checkin'/);
  assert.match(memberBody, /item\.mediaId = pair\.display\.mediaId/);
  assert.match(memberBody, /item\.thumbMediaId = pair\.thumb\.mediaId/);
  assert.doesNotMatch(memberBody, /uploadCompressedImage\(prepared\.(?:display|thumb)/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /Promise\.all\(\[\s*requestVariantUploadIntent\(prepared\.display/);
  assert.match(app, /const displayPut = putVariantToR2/);
  assert.match(app, /const thumbPut = putVariantToR2/);
});`;
const memberPattern = /test\('单人打卡使用Pica生成2048px高清图与960px列表图',[\s\S]*?\r?\n\}\);/;
if (memberPattern.test(memberTest)) {
  memberTest = memberTest.replace(memberPattern, pairedUploadTest);
  await writeFile(memberTestPath, memberTest, 'utf8');
}

if (!(await readFile(appPath, 'utf8')).includes(marker)
    || !(await readFile(stylePath, 'utf8')).includes(marker)
    || !(await readFile(plazaRoutePath, 'utf8')).includes(marker)
    || !(await readFile(memberTestPath, 'utf8')).includes('uploadPreparedImagePair')) {
  throw new Error('活动广场移动端布局或并行上传测试生成不完整');
}

process.stdout.write('Applied mobile plaza layout, search, masonry feed and paired upload assertions.\n');
