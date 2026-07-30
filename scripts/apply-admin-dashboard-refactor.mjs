import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const appPath = path.join(root, 'public', 'app.js');
const templatePath = path.join(root, 'scripts', 'admin-dashboard-refactor.template.js');
const marker = '/* ADMIN_DASHBOARD_REFACTOR_V1 */';
const anchor = 'function enhanceAdminSections() {';

if (!fs.existsSync(appPath) || !fs.existsSync(templatePath)) {
  throw new Error('后台减法重构所需文件不存在');
}

let source = fs.readFileSync(appPath, 'utf8');
if (source.includes(marker)) {
  console.log('Admin dashboard refactor already applied.');
  process.exit(0);
}

const originalAdmin = 'async function admin(selectedDate, pageEpoch = beginNavigation()) {';
if (!source.includes(originalAdmin)) {
  throw new Error('未找到原始 admin 函数，已停止以避免误改');
}
if (!source.includes(anchor)) {
  throw new Error('未找到后台增强函数锚点，已停止以避免误改');
}

source = source.replace(originalAdmin, 'async function legacyAdmin(selectedDate, pageEpoch = beginNavigation()) {');
const template = fs.readFileSync(templatePath, 'utf8').trim();
source = source.replace(anchor, `${template}\n\n${anchor}`);

fs.writeFileSync(appPath, source, 'utf8');
console.log('Applied compact admin dashboard refactor to public/app.js.');
