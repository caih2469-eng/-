(() => {
  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
  const showNetworkError = () => {
    document.querySelector('#app').innerHTML =
      '<section class="boot-shell"><div class="boot-error">网络连接失败，请检查网络后重试。<br><button type="button" id="bootRetry">重新加载</button></div></section>';
    document.querySelector('#bootRetry').onclick = () => location.reload();
  };
  const bootstrap = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let storedToken = '';
      try { storedToken = localStorage.getItem('token') || ''; } catch {}
      const response = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: storedToken ? { authorization: `Bearer ${storedToken}` } : {},
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        location.replace('/entrance');
        return;
      }
      if (!response.ok) throw new Error('session unavailable');
      const session = await response.json();
      window.__BOOTSTRAP_AUTHENTICATED__ = true;
      window.__BOOTSTRAP_SESSION__ = session;
      window.__BOOTSTRAP_USER__ = session.user || null;
      window.__BOOTSTRAP_DASHBOARD__ = session.dashboard || null;
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/style.css?v=20260729-uploadfix3';
      document.head.appendChild(stylesheet);
      await loadScript('/site-path.js?v=20260729-uploadfix3');
      await loadScript('/app.js?v=20260729-uploadfix3');
    } catch {
      showNetworkError();
    } finally {
      clearTimeout(timeout);
    }
  };
  bootstrap();
})();
