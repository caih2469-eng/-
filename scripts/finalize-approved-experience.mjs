import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_MOBILE_EXPERIENCE_FINALIZED_V1 */';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!/\breadConfig\b/.test(next.slice(0, next.indexOf("from '../lib/runtime.js'")))) {
      next = next.replace('  nowIso,\n  readJson,', '  nowIso,\n  readConfig,\n  readJson,');
    }
    next = next.replace(/const THUMB_MAX_EDGE = (?:360|540|640);/, 'const THUMB_MAX_EDGE = 640;');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/lib/runtime.js');
  if (!source.includes(marker)) {
    let next = source;
    next = next.replace('    checkinSettings: {\n      enabled:', '    checkinSettings: {\n      configured: Boolean(values.checkinSettings),\n      enabled:');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(marker)) {
    let next = source;
    next = next.replace(
      "  const settings = config?.checkinSettings || {};\n  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};",
      "  const settings = config?.checkinSettings || {};\n  if (!settings.configured) {\n    return { ...task, memberImageLimit: Math.min(8, Math.max(1, Number(task.imageLimit || 3))) };\n  }\n  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};"
    );
    next = marker + '\n' + next;
    write(file, next);
  }
}

console.log('Finalized approved 640px media imports and check-in settings compatibility.');
