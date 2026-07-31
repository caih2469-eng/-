import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://jinshan20-test.pages.dev';
const STUDENT_ID = 'WEB-PREVIEW-001';
const STUDENT_PASSWORD = 'BrowserPreview2026';
const TASK_ID = 'browser-preview-task';
const SOURCE_IMAGE_ID = 'browser-preview-submission-image';
const REPORT_PATH = 'reports/browser-plaza-mobile-preview.json';

const parseArgs = (argv) => {
  const options = { baseUrl: process.env.BROWSER_PREVIEW_BASE_URL || DEFAULT_BASE_URL };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url') options.baseUrl = argv[++index];
    else throw new Error(`未知参数：${argv[index]}`);
  }
  const url = new URL(options.baseUrl);
  if (url.hostname !== 'jinshan20-test.pages.dev' && !url.hostname.endsWith('.jinshan20-test.pages.dev')) {
    throw new Error(`移动端广场验收仅允许测试站，当前为：${url.hostname}`);
  }
  options.baseUrl = url.origin;
  return options;
};

const findChrome = () => {
  for (const command of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('GitHub Runner 未找到 Chrome/Chromium');
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
      const handler = (params) => { clearTimeout(timer); resolve(params); };
      const handlers = this.listeners.get(method) || [];
      handlers.push(handler);
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

  close() {
    this.socket?.close();
  }
}

const waitFor = async (client, expression, timeoutMs = 20_000, label = '页面条件') => {
  const startedAt = Date.now();
  let lastValue = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await client.evaluate(expression);
    if (lastValue) return lastValue;
    await sleep(80);
  }
  throw new Error(`${label}等待超时，最后结果：${JSON.stringify(lastValue)}`);
};

const navigate = async (client, url) => {
  const loaded = client.waitEvent('Page.loadEventFired').catch(() => null);
  await client.call('Page.navigate', { url });
  await loaded;
};

const login = async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: STUDENT_ID, password: STUDENT_PASSWORD }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.token || !body?.user) {
    throw new Error(`测试学生登录失败（${response.status}）：${JSON.stringify(body)}`);
  }
  return body;
};

const openChrome = async (baseUrl) => {
  const chrome = findChrome();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'jinshan-plaza-mobile-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const processHandle = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
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
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
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
    })
  ]);

  return {
    client,
    async close() {
      client.close();
      processHandle.kill('SIGTERM');
      await sleep(200);
      if (!processHandle.killed) processHandle.kill('SIGKILL');
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }).catch(() => {});
    },
    baseUrl
  };
};

const assertUploadTimeline = (upload) => {
  if (!upload?.displayMediaId || !upload?.thumbMediaId) throw new Error('并行上传没有返回两种媒体编号');
  if (upload.preparedDisplayEdge > 2048) throw new Error(`高清图最长边${upload.preparedDisplayEdge}px，超过2048px`);
  if (upload.preparedThumbEdge > 960) throw new Error(`列表图最长边${upload.preparedThumbEdge}px，超过960px`);
  if (upload.intentStarts !== 2 || upload.putStarts !== 2) {
    throw new Error(`并行上传请求数量异常：intent=${upload.intentStarts}, put=${upload.putStarts}`);
  }
  if (!upload.intentsOverlapped) throw new Error('高清图与列表图上传地址未并行申请');
  if (!upload.putsOverlapped) throw new Error('高清图与列表图未并行直传R2');
  if (upload.thumbParentMediaId !== upload.displayMediaId) {
    throw new Error(`列表图父媒体关系错误：${upload.thumbParentMediaId} != ${upload.displayMediaId}`);
  }
};

const runAcceptance = async (baseUrl) => {
  const credentials = await login(baseUrl);
  const browser = await openChrome(baseUrl);
  const { client } = browser;
  try {
    await navigate(client, `${baseUrl}/entrance`);
    await client.evaluate(`localStorage.setItem('token', ${JSON.stringify(credentials.token)}); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(credentials.user))});`);
    await navigate(client, `${baseUrl}/?debugPerf=1&plazaMobileAcceptance=${Date.now()}`);
    await waitFor(client, `Boolean(document.querySelector('#plaza') && document.body.dataset.view === 'student')`, 20_000, '学生首页');

    await client.call('Network.clearBrowserCache');
    await client.evaluate(`window.__PLAZA_COLD_STARTED__ = performance.now(); window.__PERF_METRICS__ = []; document.querySelector('#plaza').click();`);
    const cold = await waitFor(client, `(() => {
      const image = document.querySelector('img[data-perf-image="plaza-thumb"]');
      const grid = document.querySelector('.plaza-grid');
      if (!image || !grid || !image.complete || !image.naturalWidth) return null;
      const text = document.body.innerText;
      return {
        visibleMs: Math.round((performance.now() - window.__PLAZA_COLD_STARTED__) * 10) / 10,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        columnCount: getComputedStyle(grid).columnCount,
        hasBack: Boolean(document.querySelector('#backHome')),
        hasLatest: Boolean(document.querySelector('[data-sort="latest"]')),
        hasHot: Boolean(document.querySelector('[data-sort="hot"]')),
        hasSearch: Boolean(document.querySelector('#togglePlazaSearch')),
        hasMonthSelector: Boolean(document.querySelector('#plazaMonth')),
        hasMonthlySort: Boolean(document.querySelector('[data-sort="monthly"]')),
        hasOldBanner: text.includes('四校区活动广场'),
        hasMonthlyRanking: text.includes('月度排行')
      };
    })()`, 20_000, '活动广场冷缓存首图');

    if (cold.visibleMs > 1000) throw new Error(`活动广场首张缩略图冷加载${cold.visibleMs}ms，超过1000ms`);
    if (cold.columnCount !== '2') throw new Error(`活动广场不是双列瀑布流：column-count=${cold.columnCount}`);
    if (!cold.hasBack || !cold.hasLatest || !cold.hasHot || !cold.hasSearch) throw new Error('顶部返回、最新发布、热门排行或搜索入口缺失');
    if (cold.hasMonthSelector || cold.hasMonthlySort || cold.hasOldBanner || cold.hasMonthlyRanking) {
      throw new Error('旧大横幅、月份选择或月度排行仍存在');
    }

    const upload = await client.evaluate(`(async () => {
      const sourceResponse = await fetch('/api/public-images/${SOURCE_IMAGE_ID}?variant=display&v=plaza-mobile-acceptance');
      if (!sourceResponse.ok) throw new Error('验收源图片加载失败：' + sourceResponse.status);
      const sourceBlob = await sourceResponse.blob();
      const sourceFile = new File([sourceBlob], 'plaza-mobile-acceptance.webp', { type: sourceBlob.type || 'image/webp' });
      const prepared = await prepareImageVariantsMeasured(sourceFile);
      const events = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const rawUrl = typeof input === 'string' ? input : input.url;
        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const parsed = new URL(rawUrl, location.href);
        const kind = method === 'POST' && parsed.pathname === '/api/media/upload-intents'
          ? 'intent'
          : method === 'POST' && /\/api\/media\/upload-intents\/[^/]+\/confirm$/.test(parsed.pathname)
            ? 'confirm'
            : method === 'PUT' ? 'put' : '';
        const startedAt = performance.now();
        if (kind) events.push({ kind, phase: 'start', at: startedAt, body: typeof init.body === 'string' ? init.body : '' });
        try {
          const response = await originalFetch(input, init);
          if (kind) events.push({ kind, phase: 'end', at: performance.now(), status: response.status });
          return response;
        } catch (error) {
          if (kind) events.push({ kind, phase: 'end', at: performance.now(), error: String(error?.message || error) });
          throw error;
        }
      };
      try {
        const pair = await uploadPreparedImagePair(prepared, {
          taskId: '${TASK_ID}',
          businessType: 'task',
          onStage: () => {}
        }, new AbortController().signal);
        const starts = (kind) => events.filter((event) => event.kind === kind && event.phase === 'start');
        const ends = (kind) => events.filter((event) => event.kind === kind && event.phase === 'end');
        const overlapped = (kind) => {
          const kindStarts = starts(kind);
          const kindEnds = ends(kind);
          return kindStarts.length === 2 && kindEnds.length === 2
            && Math.max(...kindStarts.map((event) => event.at)) < Math.min(...kindEnds.map((event) => event.at));
        };
        const thumbConfirm = starts('confirm')
          .map((event) => { try { return JSON.parse(event.body || '{}'); } catch { return {}; } })
          .find((body) => body.parentMediaId);
        return {
          displayMediaId: pair.display.mediaId,
          thumbMediaId: pair.thumb.mediaId,
          preparedDisplayEdge: Math.max(prepared.display.width, prepared.display.height),
          preparedThumbEdge: Math.max(prepared.thumb.width, prepared.thumb.height),
          intentStarts: starts('intent').length,
          putStarts: starts('put').length,
          intentsOverlapped: overlapped('intent'),
          putsOverlapped: overlapped('put'),
          thumbParentMediaId: thumbConfirm?.parentMediaId || '',
          events
        };
      } finally {
        window.fetch = originalFetch;
      }
    })()`);
    assertUploadTimeline(upload);

    const searchTerms = [
      '网页验收队伍',
      '网页浏览器验收活动',
      '网页验收学生',
      '网页浏览器自动验收公开作品'
    ];
    const searchResults = [];
    for (const term of searchTerms) {
      await client.evaluate(`(() => {
        const toggle = document.querySelector('#togglePlazaSearch');
        const panel = document.querySelector('#plazaSearchPanel');
        if (panel?.hidden) toggle?.click();
        const input = document.querySelector('#plazaSearchInput');
        input.value = ${JSON.stringify(term)};
        document.querySelector('#plazaSearchForm').requestSubmit();
      })()`);
      const result = await waitFor(client, `(() => {
        const input = document.querySelector('#plazaSearchInput');
        const cards = document.querySelectorAll('[data-post]');
        return input?.value === ${JSON.stringify(term)} && cards.length > 0
          ? { term: input.value, cards: cards.length, text: document.body.innerText.slice(0, 500) }
          : null;
      })()`, 15_000, `搜索：${term}`);
      searchResults.push({ term, cards: result.cards });
    }

    await client.evaluate(`document.querySelector('[data-sort="hot"]')?.click()`);
    await waitFor(client, `document.querySelector('[data-sort="hot"]')?.classList.contains('active')`, 15_000, '热门排行切换');
    await client.evaluate(`document.querySelector('[data-sort="latest"]')?.click()`);
    await waitFor(client, `document.querySelector('[data-sort="latest"]')?.classList.contains('active')`, 15_000, '最新发布切换');

    await client.evaluate(`document.querySelector('#backHome')?.click()`);
    await waitFor(client, `Boolean(document.querySelector('#plaza') && document.body.dataset.view === 'student')`, 15_000, '返回首页');

    return {
      baseUrl,
      commit: process.env.GITHUB_SHA || '',
      runId: process.env.GITHUB_RUN_ID || '',
      generatedAt: new Date().toISOString(),
      cold,
      upload,
      searchResults,
      navigation: {
        back: true,
        latest: true,
        hot: true,
        search: true
      },
      removedLegacyElements: true
    };
  } finally {
    await browser.close();
  }
};

const options = parseArgs(process.argv.slice(2));
runAcceptance(options.baseUrl)
  .then(async (report) => {
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  })
  .catch(async (error) => {
    const report = {
      baseUrl: options.baseUrl,
      commit: process.env.GITHUB_SHA || '',
      runId: process.env.GITHUB_RUN_ID || '',
      generatedAt: new Date().toISOString(),
      error: String(error?.stack || error)
    };
    await mkdir(path.dirname(REPORT_PATH), { recursive: true }).catch(() => {});
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
    console.error(error);
    process.exitCode = 1;
  });
