import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('scripts/apply-approved-layout-team-draft-720-v2.mjs');
const adminMarker = '/* PREPARED_ADMIN_POST_GRID_MATCH_V3 */';
const historyMarker = '/* PREPARED_TEAM_HISTORY_ANCHOR_V1 */';
let source = fs.readFileSync(file, 'utf8');

if (!source.includes(adminMarker)) {
  const label = "'管理端六列帖子容器'";
  const labelIndex = source.indexOf(label);
  if (labelIndex >= 0) {
    const start = source.lastIndexOf('    next = replaceOnce(', labelIndex);
    const closeStart = source.indexOf('    );', labelIndex);
    if (start < 0 || closeStart < 0) throw new Error('无法定位重复的管理端帖子容器补丁');
    const end = closeStart + '    );'.length;
    source = source.slice(0, start) + `    ${adminMarker}\n` + source.slice(end);
  } else {
    const anchor = "    next = next.replaceAll(\"plazaCopy: form.plazaCopy?.value || ''\", 'plazaCopy: form.copy.value');";
    const anchorIndex = source.indexOf(anchor);
    if (anchorIndex < 0) throw new Error('未找到管理端帖子补丁清理锚点');
    const insertAt = anchorIndex + anchor.length;
    source = source.slice(0, insertAt) + `\n\n    ${adminMarker}` + source.slice(insertAt);
  }
}

if (!source.includes(historyMarker)) {
  const label = "'队伍历史接口位置'";
  const labelIndex = source.indexOf(label);
  if (labelIndex < 0) throw new Error('未找到队伍历史接口补丁标签');
  const start = source.lastIndexOf('    next = replaceOnce(', labelIndex);
  const closeStart = source.indexOf('    );', labelIndex);
  if (start < 0 || closeStart < 0) throw new Error('无法定位队伍历史接口补丁边界');
  const end = closeStart + '    );'.length;
  const replacement = [
    `    ${historyMarker}`,
    '    next = replaceOnce(',
    '      next,',
    "      '  const submissionMatch = route.match',",
    "      teamHistoryBackend + '  const submissionMatch = route.match',",
    "      '队伍历史接口位置'",
    '    );'
  ].join('\n');
  source = source.slice(0, start) + replacement + source.slice(end);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Prepared single-source admin grid and stable team-history route anchor.');
