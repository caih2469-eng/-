import fs from 'node:fs';
import path from 'node:path';

const version = '20260730-adminphoto2';
const file = path.join(process.cwd(), 'scripts', 'apply-admin-dashboard-refactor.mjs');
const source = fs.readFileSync(file, 'utf8');
const next = source.replace(/20260730-(?:flow2|adminphoto1|adminphoto2)/g, version);
if (!next.includes(version)) throw new Error('后台资源版本更新失败');
if (next !== source) fs.writeFileSync(file, next, 'utf8');
console.log(`Pinned regenerated assets to ${version}.`);
