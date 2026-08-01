import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = 'BUILD_ASSET_VERSION_V1';
const fallbackVersion = '20260731-approved1';
const commitSha = String(
  process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || ''
).trim().toLowerCase();
const buildVersion = /^[0-9a-f]{40}$/.test(commitSha)
  ? commitSha
  : fallbackVersion;

const targets = [
  { relativePath: 'public/index.html', type: 'html' },
  { relativePath: 'public/entrance.html', type: 'html' },
  { relativePath: 'public/bootstrap.js', type: 'javascript' }
];

const applyBuildAssetVersion = () => {
  let changedFiles = 0;

  for (const target of targets) {
    const file = path.join(root, target.relativePath);
    if (!fs.existsSync(file)) throw new Error(`${target.relativePath}不存在`);

    const source = fs.readFileSync(file, 'utf8');
    const references = [...source.matchAll(/\?v=([a-zA-Z0-9._-]+)/g)];
    if (!references.length) {
      throw new Error(`${target.relativePath}没有可更新的版本化资源地址`);
    }

    let next = source.replace(
      /\?v=[a-zA-Z0-9._-]+/g,
      `?v=${buildVersion}`
    );

    if (!next.includes(marker)) {
      const markerText = target.type === 'html'
        ? `  <!-- ${marker} fallback=${fallbackVersion} -->\n`
        : `/* ${marker} fallback=${fallbackVersion} */\n`;
      next = target.type === 'html'
        ? next.replace('</head>', `${markerText}</head>`)
        : `${markerText}${next}`;
    }

    if (!next.includes(`?v=${buildVersion}`)) {
      throw new Error(`${target.relativePath}资源版本写入失败`);
    }

    if (next !== source) {
      fs.writeFileSync(file, next, 'utf8');
      changedFiles += 1;
    }
  }

  if (changedFiles) {
    console.log(`Applied commit-scoped asset version ${buildVersion} to ${changedFiles} files.`);
  }
};

applyBuildAssetVersion();

const hookKey = Symbol.for('jinshan20.buildAssetVersionBeforeExit');
if (!globalThis[hookKey]) {
  globalThis[hookKey] = true;
  process.once('beforeExit', applyBuildAssetVersion);
}
