import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseUrl = process.env.AUDIT_BASE_URL || 'https://jinshan20-test.pages.dev';
const executablePath = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ headless: true, executablePath });

const devices = [
  {
    name: 'Android WeChat',
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Version/4.0 Chrome/116 Mobile Safari/537.36 MicroMessenger/8.0.47 WeChat/arm64',
  },
  {
    name: 'iPhone WeChat',
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.49',
  },
  {
    name: 'Desktop Edge',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 Edg/124',
  },
];

const results = [];
for (const device of devices) {
  const context = await browser.newContext({
    viewport: device.viewport,
    userAgent: device.userAgent,
    isMobile: device.name !== 'Desktop Edge',
  });
  const page = await context.newPage();
  let transferredBytes = 0;
  const resources = [];
  page.on('response', async (response) => {
    if (!response.url().startsWith(baseUrl)) return;
    const headers = await response.allHeaders();
    const bytes = Number(headers['content-length'] || 0);
    transferredBytes += bytes;
    resources.push({ url: response.url(), status: response.status(), bytes });
  });
  const started = performance.now();
  await page.goto(`${baseUrl}/entrance`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const domContentLoadedObservedMs = performance.now() - started;
  await page.waitForSelector('#login-form', { state: 'visible', timeout: 10_000 });
  const formVisibleMs = performance.now() - started;
  await page.waitForTimeout(1200);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');
    return {
      responseStartMs: navigation?.responseStart || 0,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
      loadMs: navigation?.loadEventEnd || 0,
      fcpMs: paint.find((entry) => entry.name === 'first-contentful-paint')?.startTime || 0,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  results.push({
    device: device.name,
    domContentLoadedObservedMs: Number(domContentLoadedObservedMs.toFixed(1)),
    formVisibleMs: Number(formVisibleMs.toFixed(1)),
    transferredBytes,
    resources,
    ...metrics,
  });
  await context.close();
}

await browser.close();
process.stdout.write(`${JSON.stringify({ baseUrl, testedAt: new Date().toISOString(), results }, null, 2)}\n`);
