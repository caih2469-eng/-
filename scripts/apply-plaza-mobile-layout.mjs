import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');
const stylePath = path.resolve('public/style.css');
const plazaRoutePath = path.resolve('cloudflare/routes/plaza.js');
const memberTestPath = path.resolve('test/member-checkin-fast.test.js');
const layoutTestPath = path.resolve('test/approved-layout-team-draft-720.test.js');
const mobileTestPath = path.resolve('test/approved-mobile-experience.test.js');
const studentFlowTestPath = path.resolve('test/student-admin-flow.test.js');
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

const findTopLevelDeclaration = (source, fromIndex) => {
  const pattern = /^(?:async\s+function|function|const|let|class)\s+[A-Za-z_$][\w$]*/gm;
  pattern.lastIndex = Math.max(0, fromIndex);
  return pattern.exec(source)?.index ?? -1;
};

const replaceTopLevelDeclaration = (source, startAnchors, replacement, label) => {
  const candidates = (Array.isArray(startAnchors) ? startAnchors : [startAnchors])
    .map((anchor) => ({ anchor, index: source.indexOf(anchor) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);
  const start = candidates[0]?.index ?? -1;
  const end = start >= 0 ? findTopLevelDeclaration(source, start + 1) : -1;
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${label}顶层边界未找到，已停止以避免误改（start=${start}, end=${end}）`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

const replaceNamedTest = (source, title, replacement, label) => {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`test\\('${escapedTitle}',[\\s\\S]*?\\r?\\n\\}\\);`);
  if (!pattern.test(source)) throw new Error(`${label}未找到`);
  return source.replace(pattern, replacement.trim());
};

const [pageTemplate, styleTemplate, routeTemplate] = await Promise.all([
  readFile(pageTemplatePath, 'utf8'),
  readFile(styleTemplatePath, 'utf8'),
  readFile(routeTemplatePath, 'utf8')
]);
const plazaTemplateStart = pageTemplate.indexOf('\nasync function plaza');
if (plazaTemplateStart < 0) throw new Error('活动广场模板缺少plaza函数');
const renderTemplate = pageTemplate.slice(0, plazaTemplateStart).trimEnd();
const plazaTemplate = pageTemplate.slice(plazaTemplateStart + 1).trimEnd();

let app = await readFile(appPath, 'utf8');
if (!app.includes(marker)) {
  app = replaceTopLevelDeclaration(
    app,
    'const renderPlazaPage',
    `${renderTemplate}\n\n`,
    '活动广场渲染函数'
  );
  app = replaceTopLevelDeclaration(
    app,
    ['async function plaza', 'const plaza = async'],
    `${plazaTemplate}\n\n`,
    '活动广场加载函数'
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
memberTest = replaceNamedTest(
  memberTest,
  '单人打卡使用Pica生成2048px高清图与960px列表图',
  pairedUploadTest,
  '并行图片上传测试'
);
await writeFile(memberTestPath, memberTest, 'utf8');

let layoutTest = await readFile(layoutTestPath, 'utf8');
layoutTest = replaceNamedTest(
  layoutTest,
  '队伍草稿可继续编辑并删除广场二次文案字段',
  String.raw`test('队伍草稿可继续编辑并删除广场二次文案字段', () => {
  const app = read('public/app.js');
  const student = read('cloudflare/routes/student.js');
  const plazaBody = app.match(/\/\* PLAZA_MOBILE_LAYOUT_V1 \*\/[\s\S]*?async function plaza/)?.[0] || '';
  assert.match(app, /已保存队伍作品/);
  assert.doesNotMatch(app, /广场作品文案（发布时必填）/);
  assert.doesNotMatch(app, /id="plazaCopyField"/);
  assert.match(app, /plazaCopy: form\.copy\.value/);
  assert.match(student, /const plazaCopy = cleanText\(body\.copy, 2000\)/);
  assert.doesNotMatch(student, /请填写广场作品文案/);
  assert.match(plazaBody, /<h2>\$\{escapeHtml\(post\.teamName\)\}<\/h2>/);
  assert.match(plazaBody, /plaza-channel-tabs/);
  assert.match(plazaBody, /togglePlazaSearch/);
  assert.doesNotMatch(plazaBody, /四校区活动广场|月度排行|id="plazaMonth"/);
});`,
  '队伍草稿与新广场布局测试'
);
await writeFile(layoutTestPath, layoutTest, 'utf8');

let mobileTest = await readFile(mobileTestPath, 'utf8');
mobileTest = replaceNamedTest(
  mobileTest,
  '活动广场、历史打卡和管理员列表图统一使用960px Pica链路',
  String.raw`test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路', () => {
  const app = read('public/app.js');
  const style = read('public/style.css');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-admin-thumbnails-540.mjs');
  const plazaBody = app.match(/\/\* PLAZA_MOBILE_LAYOUT_V1 \*\/[\s\S]*?async function plaza/)?.[0] || '';
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /data-perf-image="history-thumb"/);
  assert.match(plazaBody, /data-perf-image="plaza-thumb"/);
  assert.match(plazaBody, /data-priority=/);
  assert.match(plazaBody, /cardIndex === 0 \? 'high' : 'low'/);
  assert.match(app, /data-perf-image="admin-checkin-thumb"/);
  assert.match(style, /column-count:\s*2/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /thumbs-720-v1/);
  assert.match(backfill, /encode\(720, 84\)/);
});`,
  'Pica与广场首图优先级测试'
);
mobileTest = replaceNamedTest(
  mobileTest,
  '累计打卡数据由后端按有效日期去重计算',
  String.raw`test('累计打卡数据由后端按有效日期去重计算', () => {
  const dashboard = read('cloudflare/services/student-dashboard.js');
  assert.match(dashboard, /COUNT\(DISTINCT checkin_date\)/);
  assert.match(dashboard, /COUNT\(DISTINCT occurrence_date\)/);
  assert.match(dashboard, /personalDays/);
  assert.match(dashboard, /teamDays/);
  assert.match(dashboard, /status IN \('submitted','approved'\)/);
});`,
  '累计打卡后端去重测试'
);
await writeFile(mobileTestPath, mobileTest, 'utf8');

let studentFlowTest = await readFile(studentFlowTestPath, 'utf8');
studentFlowTest = replaceNamedTest(
  studentFlowTest,
  'student home keeps only the requested shortcuts and a working history modal root',
  String.raw`test('student home keeps only the requested shortcuts and a working history modal root', () => {
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const app = read('public/app.js');
  const studentBody = app.match(/async function student\([\s\S]*?\r?\n\}\r?\n\r?\nfunction openStudentCheckinHistory/)?.[0]
    || app.match(/async function home\([\s\S]*?\r?\n\}\r?\n\r?\nfunction taskFormFields/)?.[0]
    || '';
  assert.ok(studentBody.length > 0, '未定位到学生首页函数');
  assert.match(studentBody, /id="historyCheckins"/);
  assert.match(studentBody, /id="plaza"/);
  assert.match(studentBody, /id="inbox"/);
  assert.match(studentBody, /id="teamCheckinStats"/);
  assert.match(studentBody, /id="modalRoot"/);
  assert.doesNotMatch(studentBody, /id="ranking"/);
  assert.doesNotMatch(studentBody, /profile-card/);
  assert.doesNotMatch(studentBody, /id="myTeam"/);
  assert.doesNotMatch(studentBody, /data-jump="activityTasks"/);
});`,
  '学生首页限定范围测试'
);
await writeFile(studentFlowTestPath, studentFlowTest, 'utf8');

if (!(await readFile(appPath, 'utf8')).includes(marker)
    || !(await readFile(stylePath, 'utf8')).includes(marker)
    || !(await readFile(plazaRoutePath, 'utf8')).includes(marker)
    || !(await readFile(memberTestPath, 'utf8')).includes('uploadPreparedImagePair')
    || !(await readFile(mobileTestPath, 'utf8')).includes('column-count')) {
  throw new Error('活动广场移动端布局、并行上传或测试生成不完整');
}

process.stdout.write('Applied mobile plaza layout, search, masonry feed, paired upload and scoped assertions.\n');
