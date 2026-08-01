import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* RUNTIME_RELEASE_VERSION_V1 */';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, pattern, replacement, label) => {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const { file, source } = read('public/bootstrap.js');
  if (!source.includes(marker)) {
    const fallbackVersion = source.match(/\/app\.js\?v=([A-Za-z0-9._-]+)/)?.[1] || 'current';
    const helpers = `  ${marker}
  const fallbackReleaseVersion = ${JSON.stringify(fallbackVersion)};
  const releaseState = { version: '', checkedAt: 0 };
  const fetchReleaseVersion = async () => {
    const response = await fetch('/deployment-version.json?entry=' + Date.now(), {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('release unavailable');
    const deployment = await response.json();
    const version = String(deployment.commit || deployment.assetVersion || '').trim();
    if (!version) throw new Error('release missing');
    return version;
  };
  const resolveReleaseVersion = async () => {
    try {
      releaseState.version = await fetchReleaseVersion();
    } catch {
      releaseState.version = fallbackReleaseVersion;
    }
    releaseState.checkedAt = Date.now();
    window.__RELEASE_VERSION__ = releaseState.version;
    return releaseState.version;
  };
  const versionedAsset = (assetPath, version) =>
    assetPath + (assetPath.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version);
  const verifyVisibleRelease = async (force = false) => {
    if (document.visibilityState === 'hidden') return;
    if (!force && Date.now() - releaseState.checkedAt < 15_000) return;
    try {
      const latest = await fetchReleaseVersion();
      releaseState.checkedAt = Date.now();
      if (releaseState.version && latest !== releaseState.version) location.reload();
    } catch {}
  };
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void verifyVisibleRelease(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void verifyVisibleRelease();
  });
`;
    let next = replaceOnce(
      source,
      '  const bootstrapStarted = performance.now();\n',
      '  const bootstrapStarted = performance.now();\n' + helpers,
      '启动脚本版本检查入口'
    );
    next = replaceOnce(
      next,
      "    try {\n      let storedToken = '';",
      "    try {\n      const releaseVersion = await resolveReleaseVersion();\n      let storedToken = '';",
      '启动脚本资源版本解析'
    );

    const stylesheetAssets = ['/style.css', '/admin-dashboard-refactor.css'];
    for (const asset of stylesheetAssets) {
      const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      next = replaceOnce(
        next,
        new RegExp(`loadStylesheet\\('${escaped}\\?v=[^']+'\\);`),
        `loadStylesheet(versionedAsset('${asset}', releaseVersion));`,
        `${asset}动态版本`
      );
    }

    const scriptAssets = [
      '/site-path.js',
      '/app.js',
      '/plaza-auto-masonry.js',
      '/plaza-comment-mode.js'
    ];
    for (const asset of scriptAssets) {
      const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      next = replaceOnce(
        next,
        new RegExp(`await loadScript\\('${escaped}\\?v=[^']+'\\);`),
        `await loadScript(versionedAsset('${asset}', releaseVersion));`,
        `${asset}动态版本`
      );
    }
    write(file, next);
  }
}

{
  const { file, source } = read('public/index.html');
  if (!source.includes(marker)) {
    const loader = `  <script>
    ${marker}
    (() => {
      const script = document.createElement('script');
      script.src = '/bootstrap.js?entry=' + Date.now();
      script.async = false;
      document.body.appendChild(script);
    })();
  </script>`;
    const next = replaceOnce(
      source,
      /\s*<script src="\/bootstrap\.js\?v=[^"]+" defer><\/script>/,
      loader,
      '首页启动脚本标签'
    );
    write(file, next);
  }
}

{
  const { file, source } = read('public/entrance.html');
  if (!source.includes(marker)) {
    const loader = `  <script>
    ${marker}
    (() => {
      const fetchReleaseVersion = async () => {
        const response = await fetch('/deployment-version.json?entry=' + Date.now(), {
          cache: 'no-store',
          credentials: 'same-origin'
        });
        if (!response.ok) throw new Error('release unavailable');
        const deployment = await response.json();
        const version = String(deployment.commit || deployment.assetVersion || '').trim();
        if (!version) throw new Error('release missing');
        return version;
      };
      const load = async () => {
        let version = String(Date.now());
        try { version = await fetchReleaseVersion(); } catch {}
        window.__RELEASE_VERSION__ = version;
        const script = document.createElement('script');
        script.src = '/entrance.js?v=' + encodeURIComponent(version);
        script.async = false;
        document.body.appendChild(script);
        let checkedAt = Date.now();
        const verify = async (force = false) => {
          if (document.visibilityState === 'hidden') return;
          if (!force && Date.now() - checkedAt < 15_000) return;
          try {
            const latest = await fetchReleaseVersion();
            checkedAt = Date.now();
            if (latest !== version) location.reload();
          } catch {}
        };
        window.addEventListener('pageshow', (event) => {
          if (event.persisted) void verify(true);
        });
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) void verify();
        });
      };
      void load();
    })();
  </script>`;
    const next = replaceOnce(
      source,
      /\s*<script src="\/entrance\.js\?v=[^"]+"><\/script>/,
      loader,
      '登录页脚本标签'
    );
    write(file, next);
  }
}

console.log('Applied deployment-aware runtime asset versioning.');
