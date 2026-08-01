import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* LOGIN_BOOTSTRAP_HANDOFF_V1 */';
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
  const { file, source } = read('cloudflare/worker.js');
  if (!source.includes(marker)) {
    const replacement = `  const token = await createToken(user, env.SESSION_SECRET);\n  ${marker}\n  let bootstrap = null;\n  if (user.role === 'student') {\n    try {\n      const dashboard = await buildStudentDashboard(env, user);\n      bootstrap = {\n        ok: true,\n        user,\n        config: dashboard.config,\n        tracks: TRACKS,\n        date: dashboard.date,\n        time: dashboard.time,\n        dashboard\n      };\n    } catch {\n      bootstrap = null;\n    }\n  }\n  return json({\n    token,\n    bootstrap,\n`;
    const next = replaceOnce(
      source,
      "  const token = await createToken(user, env.SESSION_SECRET);\n  return json({\n    token,\n",
      replacement,
      '登录成功响应入口'
    );
    write(file, next);
  }
}

{
  const { file, source } = read('public/entrance.js');
  if (!source.includes(marker)) {
    const storage = `                    ${marker}\n                    try {\n                        if (result.bootstrap) {\n                            sessionStorage.setItem('jinshan20.loginBootstrap', JSON.stringify({\n                                savedAt: Date.now(),\n                                data: result.bootstrap\n                            }));\n                        }\n                    } catch {}\n                    location.replace('/');`;
    const next = replaceOnce(
      source,
      "                    location.replace('/');",
      storage,
      '登录成功跳转位置'
    );
    write(file, next);
  }
}

{
  const { file, source } = read('public/bootstrap.js');
  if (!source.includes(marker)) {
    const helper = `  ${marker}\n  const consumeLoginBootstrap = () => {\n    try {\n      const key = 'jinshan20.loginBootstrap';\n      const raw = sessionStorage.getItem(key);\n      sessionStorage.removeItem(key);\n      if (!raw) return null;\n      const stored = JSON.parse(raw);\n      const age = Date.now() - Number(stored?.savedAt || 0);\n      const session = stored?.data;\n      if (age < 0 || age > 30_000 || !session?.ok || !session.user?.id) return null;\n      return session;\n    } catch {\n      return null;\n    }\n  };\n`;
    let next = replaceOnce(
      source,
      '  const bootstrapStarted = performance.now();\n',
      `  const bootstrapStarted = performance.now();\n${helper}`,
      '启动脚本登录交接帮助函数位置'
    );

    const requestBlock = /      let storedToken = '';\n      try \{ storedToken = localStorage\.getItem\('token'\) \|\| ''; \} catch \{\}\n      const response = await fetch\('\/api\/session', \{[\s\S]*?      window\.__RECORD_PERF__\('bootstrap-session', \{[\s\S]*?      \}\);\n/;
    const replacement = `      let session = consumeLoginBootstrap();\n      if (!session) {\n        let storedToken = '';\n        try { storedToken = localStorage.getItem('token') || ''; } catch {}\n        const response = await fetch('/api/session', {\n          method: 'POST',\n          credentials: 'same-origin',\n          headers: storedToken ? { authorization: \`Bearer \${storedToken}\` } : {},\n          signal: controller.signal\n        });\n        if (response.status === 401 || response.status === 403) {\n          location.replace('/entrance');\n          return;\n        }\n        if (!response.ok) throw new Error('session unavailable');\n        session = await response.json();\n        window.__RECORD_PERF__('bootstrap-session', {\n          source: 'network',\n          requestId: response.headers.get('x-request-id') || '',\n          status: response.status,\n          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10\n        });\n      } else {\n        window.__RECORD_PERF__('bootstrap-session', {\n          source: 'login-handoff',\n          status: 200,\n          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10\n        });\n      }\n`;
    next = replaceOnce(next, requestBlock, replacement, '启动脚本会话请求区块');
    write(file, next);
  }
}

console.log('Applied one-time login bootstrap handoff.');
