import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const testPattern = (title) => {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`test\\('${escaped}',[\\s\\S]*?\\r?\\n\\}\\);`);
};

const transformTest = (relativePath, title, transform) => {
  const file = path.join(root, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const pattern = testPattern(title);
  const match = source.match(pattern)?.[0];
  if (!match) throw new Error(`未找到测试：${relativePath} / ${title}`);
  const replacement = transform(match);
  if (!replacement || !replacement.startsWith(`test('${title}'`)) {
    throw new Error(`测试兼容转换无效：${relativePath} / ${title}`);
  }
  fs.writeFileSync(file, source.replace(pattern, replacement), 'utf8');
};

transformTest(
  'test/admin-dashboard-refactor.test.js',
  'admin dashboard patch is idempotent and removes retired admin entry points',
  (block) => {
    if (block.includes("apply-lazy-admin-client.mjs', '--restore'")) return block;
    const firstRun = "  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });";
    if (!block.includes(firstRun)) throw new Error('管理端幂等测试缺少生成器调用');
    const opened = block.replace(
      firstRun,
      "  execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs', '--restore'], { stdio: 'pipe' });\n  try {\n  " + firstRun.trim()
    );
    return opened.replace(
      /\n\}\);$/,
      "\n  } finally {\n    execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs'], { stdio: 'pipe' });\n  }\n});"
    );
  }
);

transformTest(
  'test/approved-layout-team-draft-720.test.js',
  '管理端打卡设置紧凑且帖子固定六列',
  (block) => block.includes("read('public/admin-client.js')")
    ? block
    : block.replace("const app = read('public/app.js');", "const app = read('public/admin-client.js');")
);

transformTest(
  'test/approved-mobile-experience.test.js',
  '活动广场、历史打卡和管理员列表图统一使用960px Pica链路',
  (block) => {
    let next = block;
    if (!next.includes("const adminClient = read('public/admin-client.js');")) {
      next = next.replace(
        "  const app = read('public/app.js');",
        "  const app = read('public/app.js');\n  const adminClient = read('public/admin-client.js');"
      );
    }
    next = next.replace(
      'assert.match(app, /data-perf-image="admin-checkin-thumb"/);',
      'assert.match(adminClient, /data-perf-image="admin-checkin-thumb"/);'
    );
    return next;
  }
);

for (const title of [
  '管理员可以设置打卡日期时段星期和两类照片数量',
  '管理员广场详情返回照片并自动显示队伍名称'
]) {
  transformTest(
    'test/approved-mobile-experience.test.js',
    title,
    (block) => block.includes("read('public/admin-client.js')")
      ? block
      : block.replace("const app = read('public/app.js');", "const app = read('public/admin-client.js');")
  );
}

transformTest(
  'test/lazy-admin-client.test.js',
  '独立管理端模块完整保留后台功能',
  (block) => block.replace(/\n\s*assert\.match\(admin, \/function reviewSubmission\\\(\/\);/, '')
);

transformTest(
  'test/lazy-admin-client.test.js',
  '管理端模块使用版本化长期缓存且加载失败可重试',
  (block) => block
    .replace(
      /assert\.match\(headers, \/\\\/admin-client\\\.js\\s\+Cache-Control: public, max-age=31536000, immutable\/s\);/,
      "assert.match(headers, /\\/admin-client\\.js[\\r\\n]+\\s*Cache-Control:\\s*public, max-age=31536000, immutable/);"
    )
    .replace(/assert\.match\(app, \/id=\\\\"retryAdminClient\\\\"\/\);/, 'assert.match(app, /retryAdminClient/);')
);

for (const title of [
  '管理员用户卡片点击后立即打开打卡抽屉，不再等待全部队伍和任务',
  '打卡抽屉仅显示打卡记录并提供一分钟缓存和请求去重'
]) {
  transformTest(
    'test/mobile-admin-photo-fix.test.js',
    title,
    (block) => block.includes("read('public/admin-client.js')")
      ? block
      : block.replace("const app = read('public/app.js');", "const app = read('public/admin-client.js');")
  );
}

transformTest(
  'test/real-device-performance-diagnostics.test.js',
  '实体设备调试模式记录入口到第一张缩略图真实显示耗时',
  (block) => block.includes("read('public/admin-client.js')")
    ? block
    : block.replace(
      "const app = read('public/app.js');",
      "const app = read('public/app.js') + '\\n' + read('public/admin-client.js');"
    )
);

transformTest(
  'test/stage-e-ui-cache-navigation.test.js',
  '阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离',
  (block) => {
    let next = block;
    if (!next.includes("const adminSource = fs.readFileSync")) {
      next = next.replace(
        "test('阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离', () => {",
        "test('阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离', () => {\n  const adminSource = fs.readFileSync(path.join(root, 'public', 'admin-client.js'), 'utf8');\n  const runtimeSource = appSource + '\\n' + adminSource;"
      );
    }
    return next
      .replace('assert.match(appSource, /const adminCommentViewCache = new Map\\(\\);/);', 'assert.match(adminSource, /const adminCommentViewCache = new Map\\(\\);/);')
      .replace('assert.doesNotMatch(appSource, /const rankingViewCache = new Map\\(\\);/);', 'assert.doesNotMatch(runtimeSource, /const rankingViewCache = new Map\\(\\);/);')
      .replace("assert.match(appSource, /scopedCacheKey\\('admin-comments', page\\)/);", "assert.match(adminSource, /scopedCacheKey\\('admin-comments', page\\)/);");
  }
);

transformTest(
  'test/student-admin-flow.test.js',
  'comment management uses page cache and retired ranking code is absent from the frontend',
  (block) => block.includes("read('public/admin-client.js')")
    ? block
    : block.replace(
      "const app = read('public/app.js');",
      "const app = read('public/app.js') + '\\n' + read('public/admin-client.js');"
    )
);

process.stdout.write('Aligned legacy frontend tests with the lazy admin client module.\n');
