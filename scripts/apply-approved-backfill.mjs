import fs from 'node:fs';
import path from 'node:path';

const sourceFile = path.resolve('scripts/backfill-admin-thumbnails-540.mjs');
const outputFile = path.resolve('scripts/backfill-approved-thumbnails-720.mjs');
const marker = '/* APPROVED_720PX_BACKFILL_V1 */';
if (!fs.existsSync(sourceFile)) throw new Error('管理员540px缩略图回填脚本不存在');

const source = fs.readFileSync(sourceFile, 'utf8');
if (source.includes(marker)
    || !source.includes('admin-thumbs-540-v1')
    || !source.includes('encode(540, 84)')) {
  throw new Error('管理员540px回填脚本已被旧720px生成器污染，停止生成');
}

let output = source;
output = output.replace('`media/${environment}/admin-thumbs-540-v1/${displayId}.webp`', '`media/${environment}/thumbs-720-v1/${displayId}.webp`');
output = output.replace('let output = await encode(540, 84);', 'let output = await encode(720, 84);');
output = output.replace('output = await encode(540, 76);', 'output = await encode(720, 78);');
output = output.replace('output = await encode(480, 72);', 'output = await encode(640, 74);');
output = output.replace("m.business_type IN ('member-checkin','meal-checkin','admin-makeup')", "m.business_type IN ('member-checkin','meal-checkin','admin-makeup','task')");
output = output.replace('COALESCE(t.width,0)<500', 'COALESCE(t.width,0)<680');
output = output.replace('`admin-thumb-540-${item.display_id}`', '`thumb-720-${item.display_id}`');
output = output.replace("'jinshan20-admin-thumb-540-'", "'jinshan20-thumb-720-'");
output = output.replaceAll('> 540', '> 720');
output = `${marker}\n${output}`;

if (!output.includes('thumbs-720-v1')
    || !output.includes('encode(720, 84)')
    || !output.includes("'admin-makeup','task'")) {
  throw new Error('独立720px历史回填脚本生成不完整');
}

fs.writeFileSync(outputFile, output, 'utf8');
console.log('Prepared independent 720px WebP history and plaza thumbnail backfill without overwriting the 540px admin script.');
