import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cssTemplatePath = path.resolve('templates/plaza-xhs-density-v2.css');
const jsTemplatePath = path.resolve('templates/plaza-xhs-density-v2.js');
const publicCssPath = path.resolve('public/plaza-xhs-density-v2.css');
const publicJsPath = path.resolve('public/plaza-xhs-density-v2.js');
const htmlPaths = [path.resolve('public/index.html'), path.resolve('public/entrance.html')];
const cssTag = '  <link rel="stylesheet" href="/plaza-xhs-density-v2.css">';
const jsTag = '  <script type="module" src="/plaza-xhs-density-v2.js"></script>';

const [css, js] = await Promise.all([
  readFile(cssTemplatePath, 'utf8'),
  readFile(jsTemplatePath, 'utf8')
]);

if (!css.includes('PLAZA_XHS_DENSITY_V2') || !js.includes('PLAZA_XHS_DENSITY_V2')) {
  throw new Error('小红书密度模板缺少版本标记');
}

await Promise.all([
  writeFile(publicCssPath, css.trimEnd() + '\n', 'utf8'),
  writeFile(publicJsPath, js.trimEnd() + '\n', 'utf8')
]);

for (const htmlPath of htmlPaths) {
  let source = await readFile(htmlPath, 'utf8');
  source = source
    .replace(/^\s*<link rel="stylesheet" href="\/plaza-xhs-density-v2\.css">\s*$/gm, '')
    .replace(/^\s*<script type="module" src="\/plaza-xhs-density-v2\.js"><\/script>\s*$/gm, '');
  if (!source.includes('</head>') || !source.includes('</body>')) {
    throw new Error(`${path.basename(htmlPath)} 缺少HTML结束标签`);
  }
  source = source
    .replace('</head>', `${cssTag}\n</head>`)
    .replace('</body>', `${jsTag}\n</body>`)
    .replace(/\n{3,}/g, '\n\n');
  await writeFile(htmlPath, source, 'utf8');
}

console.log('Applied Xiaohongshu-density plaza presentation without persisting preview posts.');
