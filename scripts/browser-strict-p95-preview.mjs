import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_BASE_URL = 'https://jinshan20-test.pages.dev';
const STUDENT_ID = 'WEB-PREVIEW-001';
const STUDENT_PASSWORD = 'BrowserPreview2026';
const ROUNDS = 20;
const THRESHOLD_MS = 1000;
const REPORT_PATH = 'reports/browser-strict-p95-preview.json';

const parseArgs = (argv) => {
  const options = { baseUrl: process.env.BROWSER_PREVIEW_BASE_URL || DEFAULT_BASE_URL };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url') options.baseUrl = argv[++index];
    else throw new Error(`未知参数：${argv[index]}`);
  }
  const url = new URL(options.baseUrl);
  if (url.hostname !== 'jinshan20-test.pages.dev' && !url.hostname.endsWith('.jinshan20-test.pages.dev')) {
    throw new Error(`严格p95验收仅允许隔离测试站，当前为：${url.hostname}`);
  }
  options.baseUrl = url.origin;
  return options;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (value) => Math.round(value * 10) / 10;
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};
const stats = (values) => ({
  min: round1(Math.min(...values)),
  p50: round1(percentile(values, 50)),
  p95: round1(percentile(values, 95)),
  max: round1(Math.max(...values))
});

const findChrome = () => {
  for (const command of ['google-chrome-stable', 'google-chrome']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('GitHub Runner 未找到正式版 Google Chrome');
};

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket连接超时')), 10_000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket连接失败')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      const handlers = this.listeners.get(message.method) || [];
      this.listeners.set(message.method, []);
      handlers.forEach((handler) => handler(message.params || {}));
    });
  }
  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  waitEvent(method, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待${method}超时`)), timeoutMs);
      const handlers = this.listeners.get(method) || [];
      handlers.push((params) => { clearTimeout(timer); resolve(params); });
      this.listeners.set(method, handlers);
    });
  }
  async evaluate(expression, awaitPromise = true) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'unknown';
      throw new Error(`浏览器执行失败：${description}`);
    }
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}

const waitFor = async (client, expression, timeoutMs = 20_000, label = '页面条件') => {
  const startedAt = performance.now();
  let last = null;
  while (performance.now() - startedAt < timeoutMs) {
    last = await client.evaluate(expression);
    if (last) return last;
    await sleep(40);
  }
  throw new Error(`${label}等待超时，最后结果：${JSON.stringify(last)}`);
};

const navigate = async (client, url) => {
  const loaded = client.waitEvent('Page.loadEventFired').catch(() => null);
  await client.call('Page.navigate', { url });
  await loaded;
};

const openChrome = async () => {
  const chrome = findChrome();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'jinshan-strict-p95-'));
  const port = 9500 + Math.floor(Math.random() * 400);
  const processHandle = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-default-apps', '--disable-extensions', '--disable-sync',
    '--metrics-recording-only', '--no-first-run', '--window-size=390,844',
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, 'about:blank'
  ], { stdio: 'ignore' });

  let target;
  let version;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [versionResponse, listResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) }),
        fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(700) })
      ]);
      if (versionResponse.ok && listResponse.ok) {
        version = await versionResponse.json();
        const targets = await listResponse.json();
        target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
        if (target) break;
      }
    } catch {}
    await sleep(100);
  }
  if (!target) {
    processHandle.kill('SIGKILL');
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('无法连接严格验收Chrome');
  }

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([
    client.call('Page.enable'), client.call('Runtime.enable'), client.call('Network.enable'),
    client.call('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844
    }),
    client.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }),
    client.call('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36',
      platform: 'Android'
    })
  ]);

  return {
    client,
    chromeVersion: version?.Browser || version?.['User-Agent'] || '',
    async close() {
      client.close();
      processHandle.kill('SIGTERM');
      await sleep(150);
      if (!processHandle.killed) processHandle.kill('SIGKILL');
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
    }
  };
};

const runRound = async (baseUrl, round) => {
  const browser = await openChrome();
  const { client } = browser;
  try {
    await client.call('Network.clearBrowserCache');
    await client.call('Network.clearBrowserCookies');

    const entranceStarted = performance.now();
    await navigate(client, `${baseUrl}/entrance?strictP95=${Date.now()}-${round}`);
    await waitFor(client, `(() => {
      const form = document.querySelector('#login-form');
      const user = form?.querySelector('input[name="studentId"]');
      const pass = form?.querySelector('input[name="password"]');
      const button = form?.querySelector('button[type="submit"]');
      if (!form || !user || !pass || !button) return false;
      const style = getComputedStyle(form);
      const ui = document.querySelector('#ui-layer');
      const uiStyle = ui ? getComputedStyle(ui) : null;
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(uiStyle?.opacity || 0) >= 0.99
        && form.getBoundingClientRect().width > 0
        && !user.disabled && !pass.disabled && !button.disabled;
    })()`, 10_000, '登录页可输入');
    const entranceUsableMs = round1(performance.now() - entranceStarted);

    await client.evaluate(`(() => {
      const form = document.querySelector('#login-form');
      const user = form.querySelector('input[name="studentId"]');
      const pass = form.querySelector('input[name="password"]');
      user.value = ${JSON.stringify(STUDENT_ID)};
      pass.value = ${JSON.stringify(STUDENT_PASSWORD)};
      user.dispatchEvent(new Event('input', { bubbles: true }));
      pass.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const loginStarted = performance.now();
    await client.evaluate(`document.querySelector('#login-form').requestSubmit()`);
    await waitFor(client, `Boolean(document.querySelector('#plaza') && document.body.dataset.view === 'student')`, 20_000, '登录后首页可操作');
    const loginToHomeMs = round1(performance.now() - loginStarted);

    await client.call('Network.clearBrowserCache');
    const plazaStarted = performance.now();
    await client.evaluate(`document.querySelector('#plaza').click()`);
    await waitFor(client, `(() => {
      const image = document.querySelector('img[data-perf-image="plaza-thumb"]');
      const grid = document.querySelector('.plaza-grid');
      return Boolean(grid && image && image.complete && image.naturalWidth
        && document.querySelector('#backHome')
        && document.querySelector('[data-sort="latest"]')
        && document.querySelector('#togglePlazaSearch'));
    })()`, 20_000, '广场首屏可操作');
    const homeToPlazaMs = round1(performance.now() - plazaStarted);

    const detailStarted = performance.now();
    await client.evaluate(`document.querySelector('[data-post]')?.click()`);
    await waitFor(client, `(() => {
      const modal = document.querySelector('.plaza-detail');
      const close = document.querySelector('#closePost');
      const image = modal?.querySelector('img');
      return Boolean(modal && close && image && image.complete && image.naturalWidth);
    })()`, 20_000, '广场详情主体可操作');
    const plazaToDetailMs = round1(performance.now() - detailStarted);

    const result = { round, entranceUsableMs, loginToHomeMs, homeToPlazaMs, plazaToDetailMs };
    process.stdout.write(`[strict-p95] ${JSON.stringify(result)}\n`);
    return { ...result, chromeVersion: browser.chromeVersion };
  } finally {
    await browser.close();
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const rounds = [];
  for (let round = 1; round <= ROUNDS; round += 1) rounds.push(await runRound(options.baseUrl, round));

  const metrics = {
    entranceUsableMs: stats(rounds.map((item) => item.entranceUsableMs)),
    loginToHomeMs: stats(rounds.map((item) => item.loginToHomeMs)),
    homeToPlazaMs: stats(rounds.map((item) => item.homeToPlazaMs)),
    plazaToDetailMs: stats(rounds.map((item) => item.plazaToDetailMs))
  };
  const failures = Object.entries(metrics)
    .filter(([, value]) => value.p95 > THRESHOLD_MS)
    .map(([name, value]) => ({ name, p95: value.p95, thresholdMs: THRESHOLD_MS }));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    commit: process.env.GITHUB_SHA || '',
    runId: process.env.GITHUB_RUN_ID || '',
    chrome: rounds[0]?.chromeVersion || '',
    rounds: ROUNDS,
    thresholdMs: THRESHOLD_MS,
    metrics,
    failures,
    accepted: failures.length === 0,
    samples: rounds
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.accepted) process.exitCode = 1;
};

main().catch(async (error) => {
  const report = {
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || '',
    runId: process.env.GITHUB_RUN_ID || '',
    error: String(error?.stack || error)
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true }).catch(() => {});
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
