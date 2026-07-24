const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.env.CI) {
  console.log(JSON.stringify({
    skipped: true,
    reason: 'Device matrix uses the controlled local demo fixture; GitHub CI runs functional and load tests only'
  }));
  process.exit(0);
}

const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const findLinuxChrome = () => ['google-chrome', 'chromium']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' }).stdout?.trim())
  .find(Boolean) || '';
const linuxChrome = process.platform === 'win32' ? '' : findLinuxChrome();
const chrome = process.platform === 'win32' ? windowsChrome : linuxChrome;
if (!chrome || !fs.existsSync(chrome)) {
  console.log(JSON.stringify({ skipped: true, reason: 'Chrome executable is unavailable' }));
  process.exit(0);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-device-'));
const port = 9331;
const chromeArgs = [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--disable-gpu', '--no-first-run'];
if (process.platform !== 'win32') chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage');
const browser = spawn(chrome, chromeArgs, { stdio: 'ignore' });
let commandId = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const commandClient = (socket) => {
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  return (method, params = {}) => new Promise((resolve) => {
    const id = ++commandId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
};

(async () => {
  try {
    let target;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        target = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:3000/`, { method: 'PUT' }).then((response) => response.json());
        break;
      } catch {}
      await wait(100);
    }
    if (!target) throw new Error('Chrome DevTools 启动失败');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const send = commandClient(socket);
    await send('Page.enable');
    await send('Runtime.enable');
    const devices = [
      { name: '手机', width: 390, height: 844, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' },
      { name: '平板', width: 768, height: 1024, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
      { name: '电脑', width: 1440, height: 900, mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
      { name: '微信浏览器', width: 390, height: 844, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Version/4.0 Chrome/116 Mobile Safari/537.36 MicroMessenger/8.0.47 WeChat/arm64' }
    ];
    const results = [];
    for (const device of devices) {
      await send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: 1, mobile: device.mobile });
      await send('Network.setUserAgentOverride', { userAgent: device.userAgent });
      await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
      await wait(400);
      const login = await send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:'demo-health',password:'Demo123!'})});const x=await r.json();if(!r.ok)return {ok:false,status:r.status,error:x.error};localStorage.token=x.token;localStorage.user=JSON.stringify(x.user);location.reload();return {ok:true};})()`
      });
      await wait(800);
      const evaluation = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({title:document.title,hasProfile:document.body.innerText.includes('我的资料'),hasCheckin:document.body.innerText.includes('今日打卡'),hasFinalProof:document.body.innerText.includes('最终截图证明'),horizontalOverflow:document.documentElement.scrollWidth>window.innerWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth})`
      });
      results.push({ device: device.name, viewport: `${device.width}x${device.height}`, login: login.result?.result?.value, ...evaluation.result?.result?.value });
      await send('Runtime.evaluate', { expression: 'localStorage.clear()' });
    }
    console.log(JSON.stringify(results, null, 2));
    if (results.some((item) => !item.login?.ok || !item.hasProfile || !item.hasCheckin || !item.hasFinalProof || item.horizontalOverflow)) process.exitCode = 1;
    socket.close();
  } finally {
    browser.kill();
    await wait(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})();
