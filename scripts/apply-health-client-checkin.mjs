import fs from 'node:fs';
import path from 'node:path';

const marker = '/* HEALTH_CLIENT_CHECKIN_V1 */';
const preserveMarker = '/* HEALTH_CLIENT_RETURN_PRESERVE_V2 */';
const appPath = path.resolve('public/app.js');
const templatePath = path.resolve('templates/health-client-checkin-home.txt');
const preserveTemplatePath = path.resolve('templates/health-client-return-preserve.txt');

if (!fs.existsSync(appPath)) throw new Error('public/app.js不存在');
if (!fs.existsSync(templatePath)) throw new Error('健康自律客户端模板不存在');
if (!fs.existsSync(preserveTemplatePath)) throw new Error('健康自律返回稳定模板不存在');

let source = fs.readFileSync(appPath, 'utf8');
if (!source.includes(marker)) {
  const template = fs.readFileSync(templatePath, 'utf8').trim();
  source = `${source.trimEnd()}\n\n${template}\n\n${marker}\n`;
}
if (!source.includes(preserveMarker)) {
  const preserveTemplate = fs.readFileSync(preserveTemplatePath, 'utf8').trim();
  source = `${source.trimEnd()}\n\n${preserveTemplate}\n\n${preserveMarker}\n`;
}
fs.writeFileSync(appPath, source, 'utf8');

console.log('Applied isolated health-track client check-in entry and stable return rendering.');
