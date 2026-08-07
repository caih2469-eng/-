import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* LOGIN_BOOTSTRAP_HANDOFF_V2 */';
const key = 'jinshan20.loginBootstrap.v2';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

// Successful authentication may optionally return the exact student home snapshot
// generated from the already-authenticated user. Failure to build the acceleration
// payload never changes login success, token issuance, cookies or permissions.
{
  const { file, source } = read('cloudflare/worker.js');
  if (!source.includes(marker)) {
    const old = `  delete user.passwordHash;\n  const token = await createToken(user, env.SESSION_SECRET);\n  return json({\n    token,\n    user: {\n      id: user.id,\n      studentId: user.studentId,\n      name: user.name,\n      role: user.role,\n      trackId: user.trackId,\n      status: user.status\n    }\n  }, 200, {`;
    const replacement = `  delete user.passwordHash;\n  ${marker}\n  const loginUser = {\n    id: user.id,\n    studentId: user.studentId,\n    name: user.name,\n    role: user.role,\n    trackId: user.trackId,\n    status: user.status\n  };\n  const dashboardPromise = user.role === 'student'\n    ? buildStudentDashboard(env, user).catch(() => null)\n    : Promise.resolve(null);\n  const [token, dashboard] = await Promise.all([\n    createToken(user, env.SESSION_SECRET),\n    dashboardPromise\n  ]);\n  const bootstrap = dashboard ? {\n    ok: true,\n    user: {\n      id: user.id,\n      studentId: user.studentId,\n      name: user.name,\n      role: user.role,\n      campus: user.campus,\n      trackId: user.trackId,\n      status: user.status,\n      createdAt: user.createdAt\n    },\n    config: dashboard.config,\n    tracks: TRACKS,\n    date: dashboard.date || shanghaiDate(),\n    time: dashboard.time || shanghaiTime(),\n    dashboard\n  } : null;\n  return json({\n    token,\n    user: loginUser,\n    bootstrap\n  }, 200, {`;
    write(file, replaceOnce(source, old, replacement, '登录成功响应V2加速位置'));
  }
}

// Store the optional acceleration payload only after the normal token/user storage
// succeeds. The payload is never required for login and is discarded on validation failure.
{
  const { file, source } = read('public/entrance.js');
  if (!source.includes(marker)) {
    const old = `                    location.replace('/');`;
    const replacement = `                    ${marker}\n                    try {\n                        const bootstrap = result.bootstrap;\n                        if (bootstrap?.ok\n                            && bootstrap.user?.id\n                            && bootstrap.user.id === result.user?.id\n                            && bootstrap.dashboard) {\n                            sessionStorage.setItem(${JSON.stringify(key)}, JSON.stringify({\n                                savedAt: Date.now(),\n                                userId: result.user.id,\n                                data: bootstrap\n                            }));\n                        } else {\n                            sessionStorage.removeItem(${JSON.stringify(key)});\n                        }\n                    } catch {}\n                    location.replace('/');`;
    write(file, replaceOnce(source, old, replacement, '登录成功跳转V2交接位置'));
  }
}

// Warm only immutable/public static resources from the login document. They are not
// executed on the login page. The browser can reuse the HTTP-cache entries after the
// successful navigation while the server is authenticating/building the snapshot.
{
  const entrance = read('public/entrance.html');
  if (!entrance.source.includes('<!-- LOGIN_HOME_PREFETCH_V2 -->')) {
    const index = read('public/index.html').source;
    const bootstrap = read('public/bootstrap.js').source;
    const bootstrapUrl = index.match(/<script[^>]+src="([^"]*\/bootstrap\.js[^"]*)"/)?.[1];
    const styleUrl = bootstrap.match(/loadStylesheet\('([^']*\/style\.css[^']*)'\)/)?.[1];
    const sitePathUrl = bootstrap.match(/loadScript\('([^']*\/site-path\.js[^']*)'\)/)?.[1];
    const appUrl = bootstrap.match(/loadScript\('([^']*\/app\.js[^']*)'\)/)?.[1];
    if (!bootstrapUrl || !styleUrl || !sitePathUrl || !appUrl) {
      throw new Error('未找到登录页未来导航预取资源');
    }
    const links = [
      '    <!-- LOGIN_HOME_PREFETCH_V2 -->',
      `    <link rel="prefetch" href="${bootstrapUrl}" as="script">`,
      `    <link rel="prefetch" href="${styleUrl}" as="style">`,
      `    <link rel="prefetch" href="${sitePathUrl}" as="script">`,
      `    <link rel="prefetch" href="${appUrl}" as="script">`
    ].join('\n');
    write(entrance.file, replaceOnce(entrance.source, '</head>', `${links}\n</head>`, '登录页未来导航资源预取位置'));
  }
}

// The homepage consumes only a very recent, well-formed, same-user acceleration
// payload. Any missing/tampered/stale payload follows the existing /api/session path.
{
  const { file, source } = read('public/bootstrap.js');
  if (!source.includes(marker)) {
    const helper = `  ${marker}\n  const consumeLoginBootstrapV2 = () => {\n    try {\n      const raw = sessionStorage.getItem(${JSON.stringify(key)});\n      sessionStorage.removeItem(${JSON.stringify(key)});\n      if (!raw) return null;\n      const stored = JSON.parse(raw);\n      const age = Date.now() - Number(stored?.savedAt || 0);\n      const session = stored?.data;\n      const cachedUser = JSON.parse(localStorage.getItem('user') || 'null');\n      if (age < 0 || age > 10_000) return null;\n      if (!stored?.userId || stored.userId !== cachedUser?.id) return null;\n      if (!session?.ok || session.user?.id !== stored.userId || !session.dashboard || !session.config) return null;\n      return session;\n    } catch {\n      return null;\n    }\n  };\n`;
    let next = replaceOnce(
      source,
      '  const bootstrapStarted = performance.now();\n',
      `  const bootstrapStarted = performance.now();\n${helper}`,
      '首页V2交接帮助函数位置'
    );

    const networkBlock = /      const sessionRequest = fetch\('\/api\/session', \{([\s\S]*?)\n      \}\);\n      \/\/ The authenticated request is issued first; static public assets download in parallel while D1 builds the dashboard\.\n      queueMicrotask\(warmHomeAssets\);\n      const response = await sessionRequest;\n      if \(response\.status === 401 \|\| response\.status === 403\) \{\n        location\.replace\('\/entrance'\);\n        return;\n      \}\n      if \(!response\.ok\) throw new Error\('session unavailable'\);\n      const session = await response\.json\(\);\n      window\.__RECORD_PERF__\('bootstrap-session', \{\n        requestId: response\.headers\.get\('x-request-id'\) \|\| '',\n        status: response\.status,\n        duration: Math\.round\(\(performance\.now\(\) - bootstrapStarted\) \* 10\) \/ 10\n      \}\);/;
    const match = next.match(networkBlock);
    if (!match) throw new Error('未找到V4首页session网络区块');
    const replacement = `      let session = consumeLoginBootstrapV2();\n      queueMicrotask(warmHomeAssets);\n      if (!session) {\n        const sessionRequest = fetch('/api/session', {${match[1]}\n        });\n        const response = await sessionRequest;\n        if (response.status === 401 || response.status === 403) {\n          location.replace('/entrance');\n          return;\n        }\n        if (!response.ok) throw new Error('session unavailable');\n        session = await response.json();\n        window.__RECORD_PERF__('bootstrap-session', {\n          source: 'network',\n          requestId: response.headers.get('x-request-id') || '',\n          status: response.status,\n          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10\n        });\n      } else {\n        window.__RECORD_PERF__('bootstrap-session', {\n          source: 'login-handoff-v2',\n          status: 200,\n          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10\n        });\n      }`;
    next = next.replace(networkBlock, replacement);
    write(file, next);
  }
}

// Legacy generators intentionally assert that the login page does not execute app.js.
// V2 only adds <link rel="prefetch">. Patch this one assertion after those generators
// have converged, preserving the original test title and every other test in the file.
{
  const { file, source } = read('test/production-media-login-performance.test.js');
  const oldAssertion = '  assert.doesNotMatch(html, /\\bapp\\.js\\b/);';
  const markerAssertion = '    assert.match(html, /LOGIN_HOME_PREFETCH_V2/);';
  if (!source.includes(markerAssertion)) {
    const replacement = [
      '  assert.doesNotMatch(html, /<script[^>]+src=["\'][^"\']*(?:\\/app\\.js|\\/bootstrap\\.js)/i);',
      '  if (/\\bapp\\.js\\b/.test(html) || /\\bbootstrap\\.js\\b/.test(html)) {',
      '    assert.match(html, /LOGIN_HOME_PREFETCH_V2/);',
      '    assert.match(html, /<link[^>]+rel=["\']prefetch["\'][^>]+href=["\'][^"\']*\\/(?:app|bootstrap)\\.js/i);',
      '  }'
    ].join('\n');
    write(file, replaceOnce(source, oldAssertion, replacement, '入口页主应用执行与prefetch区分断言'));
  }
}

const worker = read('cloudflare/worker.js').source;
const entrance = read('public/entrance.js').source;
const entranceHtml = read('public/entrance.html').source;
const bootstrap = read('public/bootstrap.js').source;
const productionPerformanceTest = read('test/production-media-login-performance.test.js').source;
if (!worker.includes(marker)
    || !worker.includes('buildStudentDashboard(env, user).catch(() => null)')
    || !worker.includes('bootstrap\n  }, 200, {')
    || !entrance.includes(marker)
    || !entrance.includes(key)
    || !entranceHtml.includes('LOGIN_HOME_PREFETCH_V2')
    || !bootstrap.includes(marker)
    || !bootstrap.includes('consumeLoginBootstrapV2')
    || !bootstrap.includes('age > 10_000')
    || !bootstrap.includes("source: 'login-handoff-v2'")
    || !bootstrap.includes("fetch('/api/session'")
    || !productionPerformanceTest.includes('assert.match(html, /LOGIN_HOME_PREFETCH_V2/);')
    || !productionPerformanceTest.includes("test('阶段B会话直接携带学生首页快照")) {
  throw new Error('安全登录首页交接V2生成不完整');
}

console.log('Applied safe login bootstrap handoff V2 with 10-second same-user validation, network fallback and prefetch-aware safety test.');
