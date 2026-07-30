import path from 'node:path';

const DEFAULT_BASE_URL = 'https://jinshan20-test.pages.dev';

export const validateCleanupBaseUrl = (value) => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed = host === 'jinshan20-test.pages.dev'
    || host.endsWith('.jinshan20-test.pages.dev')
    || host === 'localhost'
    || host === '127.0.0.1'
    || (host.endsWith('.pages.dev') && /(?:^|[.-])(test|staging)(?:[.-]|$)/.test(host));
  if (!allowed || host === 'jinshan20.pages.dev' || host.includes('production')) {
    throw new Error(`清理脚本拒绝非测试/预览域名：${host}`);
  }
  return url.origin;
};

const fetchJson = async (url, init = {}) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
};

const main = async () => {
  const baseUrl = validateCleanupBaseUrl(process.env.LOAD_BASE_URL || DEFAULT_BASE_URL);
  const runId = String(process.env.LOAD_RUN_ID || '').toLowerCase();
  const adminId = process.env.LOAD_ADMIN_ID || '';
  const adminPassword = process.env.LOAD_ADMIN_PASSWORD || '';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(runId)) throw new Error('必须设置有效的LOAD_RUN_ID');
  if (!adminId || !adminPassword) {
    throw new Error('必须设置LOAD_ADMIN_ID和LOAD_ADMIN_PASSWORD');
  }
  const login = await fetchJson(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: adminId, password: adminPassword })
  });
  if (!login.ok || !login.body?.token) throw new Error(`管理员登录失败：${login.status}`);
  const headers = { authorization: `Bearer ${login.body.token}` };
  const cleanup = await fetchJson(
    `${baseUrl}/__load/member-checkin-fast/cleanup?runId=${encodeURIComponent(runId)}`,
    { method: 'POST', headers }
  );
  if (!cleanup.ok) throw new Error(`清理失败：${cleanup.status} ${JSON.stringify(cleanup.body)}`);
  const inventory = cleanup.body?.inventoryAfter || {};
  const remaining = [
    'users',
    'loadAdmins',
    'mediaObjects',
    'memberCheckins',
    'uploadIntents',
    'thumbMediaObjects',
    'teams',
    'tasks',
    'r2Objects'
  ].reduce((sum, key) => sum + Number(inventory[key] || 0), 0);
  const report = {
    schemaVersion: 1,
    environment: baseUrl,
    runId,
    cleanup: cleanup.body,
    inventoryAfterCleanup: inventory,
    passed: remaining === 0
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
};

if (process.argv[1]
    && path.basename(process.argv[1]) === 'cleanup-staging-member-checkin-fast-load.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
