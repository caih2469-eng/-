import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_BASE_URL = 'https://jinshan20-test.pages.dev';
const STUDENT_ID = 'WEB-PREVIEW-001';
const STUDENT_PASSWORD = 'BrowserPreview2026';
const REPORT_PATH = 'reports/browser-strict-p95.json';

const parseArgs = (argv) => {
  const options = {
    baseUrl: process.env.BROWSER_PREVIEW_BASE_URL || DEFAULT_BASE_URL,
    runs: Number(process.env.STRICT_P95_RUNS || 20),
    thresholdMs: Number(process.env.STRICT_P95_THRESHOLD_MS || 1000)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') options.baseUrl = argv[++index];
    else if (arg === '--runs') options.runs = Number(argv[++index]);
    else if (arg === '--threshold-ms') options.thresholdMs = Number(argv[++index]);
    else throw new Error(`未知参数：${arg}`);
  }
  const url = new URL(options.baseUrl);
  if (url.hostname !== 'jinshan20-test.pages.dev' && !url.hostname.endsWith('.jinshan20-test.pages.dev')) {
    throw new Error(`严格p95完整登录验收仅允许隔离测试站，当前为：${url.hostname}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 20) throw new Error('严格p95至少需要20次完整运行');
  if (!Number.isFinite(options.thresholdMs) || options.thresholdMs <= 0) throw new Error('阈值无效');
  options.baseUrl = url.origin;
  return options;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value) => Math.round(value * 10) / 10;
const findChrome = () => {
  for (const command of ['google-chrome-stable', 'google-chrome']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('未找到 Google Chrome Stable');
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
      const timer = setTimeout(() => reject(new Error('CDP连接超时')), 10_000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP连接失败')); }, { once: true });
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
      const handler = (params) => { clearTimeout(timer); resolve(params); };
      const handlers = this.listeners.get(method) || [];
      handlers.push(handler);
      this.listeners.set(method, handlers);
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const message = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'unknown';
      throw new Error(`浏览器执行失败：${message}`);
    }
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}

const waitFor = async (client, expression, timeoutMs, label) => {
  const startedAt = performance.now();
  let last = null;
  while (performance.now() - startedAt < timeoutMs) {
    try {
      last = await client.evaluate(expression);
      if (last) return last;
    } catch {}
    await sleep(50);
  }
  throw new Error(`${label}等待超时，最后结果：${JSON.stringify(last)}`);
};

const navigate = async (client, url) => {
  const loaded = client.waitEvent('Page.loadEventFired', 20_000).catch(() => null);
  await client.call('Page.navigate', { url });
  await loaded;
};

const openChrome = async () => {
  const chrome = findChrome();
  const versionResult = spawnSync(chrome, ['--version'], { encoding: 'utf8' });
  const chromeVersion = versionResult.stdout.trim() || versionResult.stderr.trim();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'jinshan-strict-p95-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const processHandle = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--window-size=390,844',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
      const targets = await response.json();
      target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target) {
    processHandle.kill('SIGKILL');
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('无法连接测试Chrome');
  }

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([
    client.call('Page.enable'),
    client.call('Runtime.enable'),
    client.call('Network.enable'),
    client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    }),
    client.call('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36',
      platform: 'Android'
    }),
    client.call('Network.emulateNetworkConditions', {
      offline: false,
      latency: 40,
      downloadThroughput: 1_250_000,
      uploadThroughput: 625_000,
      connectionType: 'cellular4g'
    })
  ]);

  return {
    client,
    chromeVersion,
    async close() {
      client.close();
      processHandle.kill('SIGTERM');
      await sleep(120);
      if (!processHandle.killed) processHandle.kill('SIGKILL');
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
    }
  };
};

const runOne = async (baseUrl, runIndex) => {
  const browser = await openChrome();
  const { client } = browser;
  try {
    const loginPageStarted = performance.now();
    await navigate(client, `${baseUrl}/entrance?strictP95=${Date.now()}-${runIndex}`);
    await waitFor(client, `(() => {
      const form = document.querySelector('#login-form');
      const user = form?.querySelector('input[name="studentId"]');
      const pass = form?.querySelector('input[name="password"]');
      const button = form?.querySelector('button[type="submit"]');
      if (!form || !user || !pass || !button) return false;
      const rect = form.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) return false;
      if (Number(getComputedStyle(form).opacity || 1) < 0.95) return false;
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(30, rect.height / 3));
      return Boolean(top && (top === form || form.contains(top)) && !button.disabled);
    })()`, 10_000, '登录页可输入');
    const loginPageReadyMs = round(performance.now() - loginPageStarted);

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
    await waitFor(client, `(() => {
      const plaza = document.querySelector('#plaza');
      const app = document.querySelector('#app');
      if (!plaza || !app || document.body.dataset.view !== 'student') return false;
      const rect = plaza.getBoundingClientRect();
      return rect.width > 30 && rect.height > 30 && !plaza.disabled;
    })()`, 15_000, '登录后首页可操作');
    const loginToHomeMs = round(performance.now() - loginStarted);

    const plazaStarted = performance.now();
    await client.evaluate(`document.querySelector('#plaza').click()`);
    await waitFor(client, `(() => {
      const image = document.querySelector('img[data-perf-image="plaza-thumb"]');
      const back = document.querySelector('#backHome');
      const latest = document.querySelector('[data-sort="latest"]');
      if (!image || !image.complete || !image.naturalWidth || !back || !latest) return false;
      return !back.disabled && !latest.disabled;
    })()`, 15_000, '活动广场首屏可操作');
    const homeToPlazaMs = round(performance.now() - plazaStarted);

    const detailStarted = performance.now();
    await client.evaluate(`document.querySelector('[data-post]')?.click()`);
    await waitFor(client, `(() => {
      const detail = document.querySelector('.plaza-detail');
      const image = detail?.querySelector('.image-viewer-trigger img, img');
      const close = detail?.querySelector('#closePost');
      if (!detail || !image || !close) return false;
      return image.complete && image.naturalWidth > 0 && !close.disabled;
    })()`, 15_000, '活动详情主体可操作');
    const plazaToDetailMs = round(performance.now() - detailStarted);

    return {
      run: runIndex,
      loginPageReadyMs,
      loginToHomeMs,
      homeToPlazaMs,
      plazaToDetailMs,
      chromeVersion: browser.chromeVersion
    };
  } finally {
    await browser.close();
  }
};

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  return {
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1]
  };
};

const options = parseArgs(process.argv.slice(2));
const runs = [];
const failures = [];
for (let index = 1; index <= options.runs; index += 1) {
  try {
    const result = await runOne(options.baseUrl, index);
    runs.push(result);
    process.stdout.write(`strict-p95 run ${index}/${options.runs}: ${JSON.stringify(result)}\n`);
  } catch (error) {
    const failure = { run: index, error: String(error?.stack || error) };
    failures.push(failure);
    process.stderr.write(`strict-p95 run ${index}/${options.runs} failed: ${failure.error}\n`);
  }
  await sleep(350);
}

const metricNames = ['loginPageReadyMs', 'loginToHomeMs', 'homeToPlazaMs', 'plazaToDetailMs'];
const summary = {};
for (const metric of metricNames) {
  const values = runs.map((item) => item[metric]).filter(Number.isFinite);
  summary[metric] = values.length ? stats(values) : null;
}
const accepted = failures.length === 0
  && runs.length === options.runs
  && metricNames.every((metric) => summary[metric]?.p95 < options.thresholdMs);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl: options.baseUrl,
  commit: process.env.GITHUB_SHA || '',
  runId: process.env.GITHUB_RUN_ID || '',
  runsRequested: options.runs,
  runsCompleted: runs.length,
  thresholdMs: options.thresholdMs,
  networkProfile: { name: 'fast-4g-fixed', latencyMs: 40, downloadMbps: 10, uploadMbps: 5 },
  chrome: runs[0]?.chromeVersion || '',
  summary,
  failures,
  accepted,
  runs
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!accepted) process.exitCode = 1;
