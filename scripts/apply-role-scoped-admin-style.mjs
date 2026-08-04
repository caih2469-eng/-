import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const bootstrapPath = path.join(root, 'public/bootstrap.js');
const marker = '/* ROLE_SCOPED_ADMIN_STYLE_V1 */';

if (!fs.existsSync(bootstrapPath)) throw new Error('public/bootstrap.js不存在');

let source = fs.readFileSync(bootstrapPath, 'utf8');

if (!source.includes(marker)) {
  const unconditional = /\n\s*loadStylesheet\('\/admin-dashboard-refactor\.css\?v=([^']+)'\);/;
  const match = source.match(unconditional);
  if (!match) throw new Error('未找到管理员样式首屏加载位置，已停止以避免误改');

  const version = match[1];
  const replacement = [
    '',
    `      ${marker}`,
    "      if (window.__BOOTSTRAP_USER__?.role === 'admin') {",
    `        loadStylesheet('/admin-dashboard-refactor.css?v=${version}');`,
    '      }'
  ].join('\n');

  source = source.replace(unconditional, replacement);
}

const withoutAdminBlock = source.replace(
  /if \(window\.__BOOTSTRAP_USER__\?\.role === 'admin'\) \{[\s\S]*?\n\s*\}/,
  ''
);

if (!source.includes(marker)
    || !source.includes("window.__BOOTSTRAP_USER__?.role === 'admin'")
    || !source.includes("loadStylesheet('/admin-dashboard-refactor.css?v=")
    || /loadStylesheet\('\/admin-dashboard-refactor\.css\?v=[^']+'\);/.test(withoutAdminBlock)) {
  throw new Error('管理员样式按角色加载生成不完整');
}

fs.writeFileSync(bootstrapPath, source, 'utf8');
process.stdout.write('Applied role-scoped admin stylesheet loading.\n');
