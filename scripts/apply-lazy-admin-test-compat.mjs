import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const replaceNamedTest = (source, title, replacement, label = title) => {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`test\\('${escapedTitle}',[\\s\\S]*?\\r?\\n\\}\\);`);
  if (!pattern.test(source)) throw new Error(`未找到测试：${label}`);
  return source.replace(pattern, replacement.trim());
};

const updateTestFile = (relativePath, updates) => {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, 'utf8');
  for (const [title, replacement] of updates) {
    source = replaceNamedTest(source, title, replacement, `${relativePath} / ${title}`);
  }
  fs.writeFileSync(file, source, 'utf8');
};

updateTestFile('test/admin-dashboard-refactor.test.js', [[
  'admin dashboard patch is idempotent and removes retired admin entry points',
  String.raw`test('admin dashboard patch is idempotent and removes retired admin entry points', () => {
  const runAdminModule = (...args) => execFileSync(
    process.execPath,
    ['scripts/apply-lazy-admin-client.mjs', ...args],
    { stdio: 'pipe' }
  );
  runAdminModule('--restore');
  try {
    execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
    const first = read('public/app.js');
    execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
    const second = read('public/app.js');
    assert.equal(second, first);

    assert.match(first, /ADMIN_DASHBOARD_REFACTOR_V1/);
    assert.match(first, /STUDENT_ADMIN_FLOW_V2/);
    assert.doesNotMatch(first, /async function legacyAdmin\(/);
    assert.doesNotMatch(first, /id="legacyAdminTools"/);
    assert.doesNotMatch(first, /id="ranking"/);
    assert.doesNotMatch(first, /function rankingTable\(/);
    assert.doesNotMatch(first, /async function rankings\(/);

    const start = first.indexOf('/* ADMIN_DASHBOARD_REFACTOR_V1 */');
    const end = first.indexOf('function enhanceAdminSections()', start);
    assert.ok(start >= 0 && end > start);
    const compact = first.slice(start, end);

    assert.match(compact, /健康自律赛道/);
    assert.match(compact, /四校区赛道/);
    assert.match(compact, /data-track-filter="health"/);
    assert.match(compact, /data-track-filter="interaction"/);
    assert.match(compact, /track=\$\{adminDashboardState\.userTrack\}/);
    assert.match(compact, /队伍管理/);
    assert.match(compact, /用户管理/);
    assert.match(compact, /活动广场管理/);
    assert.match(compact, /评论管理/);
    assert.doesNotMatch(compact, /高级工具/);
    assert.doesNotMatch(compact, /api\/admin\/overview/);
    assert.doesNotMatch(compact, /api\/admin\/material-tasks/);
    assert.match(compact, /admin-post-tile/);
    assert.match(compact, /refreshCompactPlazaPanel/);
    assert.match(compact, /refreshCompactTeamPanel/);
  } finally {
    runAdminModule();
  }
});`
]]);

updateTestFile('test/approved-layout-team-draft-720.test.js', [[
  '管理端打卡设置紧凑且帖子固定六列',
  String.raw`test('管理端打卡设置紧凑且帖子固定六列', () => {
  const adminClient = read('public/admin-client.js');
  const style = read('public/style.css');
  assert.match(adminClient, /class="[^"]*\badmin-post-grid\b[^"]*"/);
  assert.match(style, /\.admin-post-grid[\s\S]*grid-template-columns:\s*repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(style, /checkin-settings-form input\[type="checkbox"\][\s\S]*width:\s*18px/);
  assert.match(style, /weekday-options[\s\S]*repeat\(7,minmax\(0,1fr\)\)/);
});`
]]);

updateTestFile('test/approved-mobile-experience.test.js', [
  [
    '活动广场、历史打卡和管理员列表图统一使用960px Pica链路',
    String.raw`test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路', () => {
  const app = read('public/app.js');
  const adminClient = read('public/admin-client.js');
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
  assert.match(adminClient, /data-perf-image="admin-checkin-thumb"/);
  assert.match(style, /column-count:\s*2/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /thumbs-720-v1/);
  assert.match(backfill, /encode\(720, 84\)/);
});`
  ],
  [
    '管理员可以设置打卡日期时段星期和两类照片数量',
    String.raw`test('管理员可以设置打卡日期时段星期和两类照片数量', () => {
  const adminClient = read('public/admin-client.js');
  const admin = read('cloudflare/routes/admin.js');
  const runtime = read('cloudflare/lib/runtime.js');
  const dashboard = read('cloudflare/services/student-dashboard.js');
  assert.match(adminClient, /adminAccordionMarkup\('checkin', '打卡设置'/);
  assert.match(adminClient, /personalImageLimit/);
  assert.match(adminClient, /teamImageLimit/);
  assert.match(admin, /\/api\/admin\/checkin-settings/);
  assert.match(runtime, /checkinSettings:/);
  assert.match(dashboard, /applyInteractionCheckinSettings/);
  assert.match(dashboard, /memberImageLimit/);
  assert.match(dashboard, /checkinEnabled/);
});`
  ],
  [
    '管理员广场详情返回照片并自动显示队伍名称',
    String.raw`test('管理员广场详情返回照片并自动显示队伍名称', () => {
  const adminClient = read('public/admin-client.js');
  const admin = read('cloudflare/routes/admin.js');
  assert.match(adminClient, /<dt>队伍<\/dt><dd>\$\{escapeHtml\(post\.teamName\)\}<\/dd>/);
  assert.match(adminClient, /admin-post-photo-grid/);
  assert.match(adminClient, /data-perf-image="admin-plaza-thumb"/);
  assert.match(admin, /imagesBySubmission/);
  assert.match(admin, /images: imagesBySubmission\.get\(item\.submissionId\)/);
});`
  ]
]);

updateTestFile('test/lazy-admin-client.test.js', [
  [
    '独立管理端模块完整保留后台功能',
    String.raw`test('独立管理端模块完整保留后台功能', () => {
  const admin = read('public/admin-client.js');
  assert.match(admin, /\/\* ADMIN_CLIENT_MODULE_V1 \*\//);
  assert.match(admin, /async function adminComments\(/);
  assert.match(admin, /async function admin\(/);
  assert.match(admin, /function openAdminUserDrawer\(/);
  assert.match(admin, /function taskFormFields\(/);
  assert.match(admin, /window\.__ADMIN_CLIENT_ENTRY__/);
  assert.doesNotMatch(admin, /if \(window\.__BOOTSTRAP_AUTHENTICATED__\)/);
});`
  ],
  [
    '管理端模块使用版本化长期缓存且加载失败可重试',
    String.raw`test('管理端模块使用版本化长期缓存且加载失败可重试', () => {
  const app = read('public/app.js');
  const headers = read('public/_headers');
  assert.match(headers, /\/admin-client\.js[\r\n]+\s*Cache-Control:\s*public, max-age=31536000, immutable/);
  assert.match(app, /script\.dataset\.adminClientModule = 'true'/);
  assert.match(app, /script\.onerror = \(\) => \{ script\.remove\(\)/);
  assert.match(app, /adminClientModulePromise = null/);
  assert.match(app, /retryAdminClient/);
});`
  ]
]);

updateTestFile('test/mobile-admin-photo-fix.test.js', [
  [
    '管理员用户卡片点击后立即打开打卡抽屉，不再等待全部队伍和任务',
    String.raw`test('管理员用户卡片点击后立即打开打卡抽屉，不再等待全部队伍和任务', () => {
  const adminClient = read('public/admin-client.js');
  const panelStart = adminClient.indexOf('const renderAdminUserPanel');
  const panelEnd = adminClient.indexOf('async function refreshCompactAdminUsers', panelStart);
  const panel = adminClient.slice(panelStart, panelEnd);
  assert.match(panel, /openAdminUserDrawer\(studentUser, date\)/);
  assert.doesNotMatch(panel, /loadCompactAdminTeams\(\)/);
  assert.doesNotMatch(panel, /api\('\/api\/admin\/tasks'\)/);
  assert.doesNotMatch(panel, /beginButtonLoading\(button/);
});`
  ],
  [
    '打卡抽屉仅显示打卡记录并提供一分钟缓存和请求去重',
    String.raw`test('打卡抽屉仅显示打卡记录并提供一分钟缓存和请求去重', () => {
  const adminClient = read('public/admin-client.js');
  const start = adminClient.indexOf('/* MOBILE_ADMIN_PHOTO_FIX_V1 */');
  const end = adminClient.indexOf('function taskFormFields', start);
  const drawer = adminClient.slice(start, end);
  assert.match(drawer, /ADMIN_CHECKIN_CACHE_TTL_MS = 60_000/);
  assert.match(drawer, /adminCheckinInflight/);
  assert.match(drawer, /admin-checkin-photo-grid/);
  assert.doesNotMatch(drawer, /基本资料|所属队伍|补卡权限|管理操作/);
  assert.doesNotMatch(drawer, /new Image\(\)/);
});`
  ]
]);

updateTestFile('test/real-device-performance-diagnostics.test.js', [[
  '实体设备调试模式记录入口到第一张缩略图真实显示耗时',
  String.raw`test('实体设备调试模式记录入口到第一张缩略图真实显示耗时', () => {
  const app = read('public/app.js');
  const adminClient = read('public/admin-client.js');
  const runtime = `${app}\n${adminClient}`;
  assert.match(runtime, /startPhotoFlow\('history'\)/);
  assert.match(runtime, /startPhotoFlow\('plaza'\)/);
  assert.match(runtime, /startPhotoFlow\('admin-checkin'\)/);
  assert.match(runtime, /photoFlowDuration/);
  assert.match(runtime, /flowDuration/);
  assert.match(runtime, /cacheHint/);
});`
]]);

updateTestFile('test/stage-e-ui-cache-navigation.test.js', [[
  '阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离',
  String.raw`test('阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离', () => {
  const adminSource = fs.readFileSync(path.join(root, 'public', 'admin-client.js'), 'utf8');
  const runtimeSource = `${appSource}\n${adminSource}`;
  assert.match(appSource, /const VIEW_CACHE_TTL_MS = 20_000;/);
  assert.match(appSource, /const plazaViewCache = new Map\(\);/);
  assert.match(adminSource, /const adminCommentViewCache = new Map\(\);/);
  assert.doesNotMatch(runtimeSource, /const rankingViewCache = new Map\(\);/);
  assert.match(appSource, /const scopedCacheKey = \(\.\.\.parts\) => \[/);
  assert.match(appSource, /user\?\.id \|\| user\?\.studentId \|\| 'anonymous'/);
  assert.match(appSource, /\]\.join\('\|'\);/);
  assert.match(appSource, /scopedCacheKey\('plaza', safeSort, page, safeQuery\)/);
  assert.match(adminSource, /scopedCacheKey\('admin-comments', page\)/);
  const cacheBlock = sourceBetween('const VIEW_CACHE_TTL_MS', 'const clearUserViewCaches');
  assert.doesNotMatch(cacheBlock, /localStorage|sessionStorage/);
});`
]]);

updateTestFile('test/student-admin-flow.test.js', [[
  'comment management uses page cache and retired ranking code is absent from the frontend',
  String.raw`test('comment management uses page cache and retired ranking code is absent from the frontend', () => {
  const app = read('public/app.js');
  const adminClient = read('public/admin-client.js');
  const runtime = `${app}\n${adminClient}`;
  assert.match(adminClient, /const adminCommentViewCache = new Map\(\)/);
  assert.match(adminClient, /scopedCacheKey\('admin-comments', page\)/);
  assert.match(adminClient, /renderAdminCommentsPage/);
  assert.doesNotMatch(runtime, /const rankingViewCache = new Map\(\)/);
  assert.doesNotMatch(runtime, /async function rankings\(/);
});`
]]);

process.stdout.write('Aligned legacy frontend tests with the lazy admin client module.\n');
