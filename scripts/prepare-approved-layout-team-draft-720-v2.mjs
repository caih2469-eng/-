import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('scripts/apply-approved-layout-team-draft-720-v2.mjs');
const marker = '/* PREPARED_ADMIN_POST_GRID_MATCH_V1 */';
let source = fs.readFileSync(file, 'utf8');

if (!source.includes(marker)) {
  const label = "'管理端六列帖子容器'";
  const labelIndex = source.indexOf(label);
  if (labelIndex < 0) throw new Error('未找到管理端帖子容器补丁标签');
  const start = source.lastIndexOf('    next = replaceOnce(', labelIndex);
  const closeStart = source.indexOf('    );', labelIndex);
  if (start < 0 || closeStart < 0) throw new Error('无法定位管理端帖子容器补丁边界');
  const end = closeStart + '    );'.length;
  const replacement = [
    `    ${marker}`,
    '    next = replaceOnce(',
    '      next,',
    '      /<div class="admin-compact-list">([\\s\\S]*?result\\.posts\\.map\\(compactPostRow\\)[\\s\\S]*?暂无广场帖子[\\s\\S]*?)<\\/div>/',
    '      \'<div class="admin-post-grid">$1</div>\',',
    "      '管理端六列帖子容器'",
    '    );'
  ].join('\n');
  source = source.slice(0, start) + replacement + source.slice(end);
  fs.writeFileSync(file, source, 'utf8');
}

console.log('Prepared stable admin plaza six-column grid matcher.');
