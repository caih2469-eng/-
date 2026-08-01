import fs from 'node:fs';
import path from 'node:path';

const marker = '/* HEALTH_CLIENT_CHECKIN_V1 */';
const appPath = path.resolve('public/app.js');
const templatePath = path.resolve('templates/health-client-checkin-home.txt');

if (!fs.existsSync(appPath)) throw new Error('public/app.js不存在');
if (!fs.existsSync(templatePath)) throw new Error('健康自律客户端模板不存在');

const source = fs.readFileSync(appPath, 'utf8');
if (!source.includes(marker)) {
  const template = fs.readFileSync(templatePath, 'utf8').trim();
  fs.writeFileSync(appPath, `${source.trimEnd()}\n\n${template}\n\n${marker}\n`, 'utf8');
}

console.log('Applied isolated health-track client check-in entry.');
