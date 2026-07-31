import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('scripts/apply-approved-layout-team-draft-720-v2.mjs');
const marker = '/* PREPARED_ADMIN_POST_GRID_MATCH_V3 */';
let source = fs.readFileSync(file, 'utf8');

if (!source.includes(marker)) {
  const label = "'管理端六列帖子容器'";
  const labelIndex = source.indexOf(label);
  if (labelIndex >= 0) {
    const start = source.lastIndexOf('    next = replaceOnce(', labelIndex);
    const closeStart = source.indexOf('    );', labelIndex);
    if (start < 0 || closeStart < 0) throw new Error('无法定位重复的管理端帖子容器补丁');
    const end = closeStart + '    );'.length;
    source = source.slice(0, start) + `    ${marker}\n` + source.slice(end);
  } else {
    const anchor = "    next = next.replaceAll(\"plazaCopy: form.plazaCopy?.value || ''\", 'plazaCopy: form.copy.value');";
    const anchorIndex = source.indexOf(anchor);
    if (anchorIndex < 0) throw new Error('未找到管理端帖子补丁清理锚点');
    const insertAt = anchorIndex + anchor.length;
    source = source.slice(0, insertAt) + `\n\n    ${marker}` + source.slice(insertAt);
  }
  fs.writeFileSync(file, source, 'utf8');
}

console.log('Removed duplicate admin plaza container patch; the admin generator remains the single source of truth.');
