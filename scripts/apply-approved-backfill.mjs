import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('scripts/backfill-admin-thumbnails-540.mjs');
const marker = '/* APPROVED_640PX_BACKFILL_V1 */';
if (!fs.existsSync(file)) throw new Error('历史缩略图回填脚本不存在');
let source = fs.readFileSync(file, 'utf8');
if (!source.includes(marker)) {
  source = source.replace('`media/${environment}/admin-thumbs-540-v1/${displayId}.webp`', '`media/${environment}/thumbs-640-v1/${displayId}.webp`');
  source = source.replace('let output = await encode(540, 84);', 'let output = await encode(640, 84);');
  source = source.replace('output = await encode(540, 76);', 'output = await encode(640, 76);');
  source = source.replace('output = await encode(480, 72);', 'output = await encode(560, 72);');
  source = source.replace("m.business_type IN ('member-checkin','meal-checkin','admin-makeup')", "m.business_type IN ('member-checkin','meal-checkin','admin-makeup','task')");
  source = source.replace('COALESCE(t.width,0)<500', 'COALESCE(t.width,0)<600');
  source = source.replace('`admin-thumb-540-${item.display_id}`', '`thumb-640-${item.display_id}`');
  source = source.replace("'jinshan20-admin-thumb-540-'", "'jinshan20-thumb-640-'");
  source = source.replaceAll('> 540', '> 640');
  source = marker + '\n' + source;
  fs.writeFileSync(file, source, 'utf8');
}
console.log('Prepared 640px WebP history, admin and plaza thumbnail backfill.');
