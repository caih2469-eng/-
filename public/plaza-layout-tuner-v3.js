(() => {
  'use strict';

  const DEBUG_KEY = 'plazaLayoutDebugEnabledV3';
  const GLOBAL_KEY = 'plazaLayoutTunerV1';
  const CARD_KEY = 'plazaLayoutCardOverridesV3';

  const globalFields = [
    { key: 'sidePadding', label: '页面左右边距', css: '--plaza-side-padding', min: 0, max: 20, step: 1, unit: 'px', fallback: 5 },
    { key: 'columnGap', label: '两列间距', css: '--plaza-column-gap', min: 0, max: 20, step: 1, unit: 'px', fallback: 5 },
    { key: 'cardGap', label: '卡片底部间距', css: '--plaza-card-gap', min: 0, max: 30, step: 1, unit: 'px', fallback: 10 },
    { key: 'navHeight', label: '顶部导航高度', css: '--plaza-nav-height', min: 42, max: 64, step: 1, unit: 'px', fallback: 50 },
    { key: 'titleFontSize', label: '文案字号', css: '--plaza-title-font-size', min: 11, max: 22, step: 1, unit: 'px', fallback: 15 },
    { key: 'titleLineHeight', label: '文案行高', css: '--plaza-title-line-height', min: 15, max: 32, step: 1, unit: 'px', fallback: 21 },
    { key: 'titlePadding', label: '文字左右内边距', css: '--plaza-title-padding', min: 0, max: 18, step: 1, unit: 'px', fallback: 10 },
    { key: 'authorHeight', label: '作者区域高度', css: '--plaza-author-height', min: 24, max: 48, step: 1, unit: 'px', fallback: 34 },
    { key: 'avatarSize', label: '头像尺寸', css: '--plaza-avatar-size', min: 14, max: 30, step: 1, unit: 'px', fallback: 20 },
    { key: 'authorFontSize', label: '作者与数字字号', css: '--plaza-author-font-size', min: 9, max: 16, step: 1, unit: 'px', fallback: 12 }
  ];

  const cardFields = [
    { key: 'cardWidth', label: '卡片整体宽度', min: 55, max: 100, step: 1, unit: '%', fallback: 100 },
    { key: 'coverWidth', label: '图片画面宽度', min: 45, max: 100, step: 1, unit: '%', fallback: 100 },
    { key: 'coverHeight', label: '图片画面高度', min: 0, max: 700, step: 10, unit: 'px', fallback: 0, autoZero: true },
    { key: 'imageScale', label: '图片内容缩放', min: 100, max: 280, step: 5, unit: '%', fallback: 100 },
    { key: 'positionX', label: '水平显示位置', min: 0, max: 100, step: 1, unit: '%', fallback: 50 },
    { key: 'positionY', label: '垂直显示位置', min: 0, max: 100, step: 1, unit: '%', fallback: 50 }
  ];

  const params = new URLSearchParams(location.search);
  try {
    if (params.get('layoutDebug') === '1') localStorage.setItem(DEBUG_KEY, '1');
    if (params.get('layoutDebug') === '0') localStorage.removeItem(DEBUG_KEY);
  } catch {}

  const enabled = (() => {
    try { return params.get('layoutDebug') === '1' || localStorage.getItem(DEBUG_KEY) === '1'; }
    catch { return params.get('layoutDebug') === '1'; }
  })();
  if (!enabled) return;

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
    catch { return fallback; }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };
  const clampField = (value, field) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : field.fallback;
    return Math.min(field.max, Math.max(field.min, safe));
  };
  const normalize = (candidate, fields) => Object.fromEntries(
    fields.map((field) => [field.key, clampField(candidate?.[field.key], field)])
  );
  const displayValue = (field, value) => field.autoZero && Number(value) === 0
    ? '自动'
    : `${value}${field.unit}`;

  let globalConfig = normalize(readJson(GLOBAL_KEY, {}), globalFields);
  let cardConfigs = readJson(CARD_KEY, {});
  let selectedPostId = '';
  let selectionMode = false;
  let installQueued = false;

  const rebalance = () => {
    const grid = document.querySelector('.plaza-grid');
    const columns = [...(grid?.querySelectorAll('[data-plaza-column]') || [])];
    if (!grid || columns.length !== 2 || grid.dataset.tunerRebalancing === 'true') return;
    const cards = [...grid.querySelectorAll('.plaza-card[data-post]')]
      .sort((a, b) => Number(a.dataset.cardIndex || 0) - Number(b.dataset.cardIndex || 0));
    if (!cards.length) return;
    grid.dataset.tunerRebalancing = 'true';
    columns.forEach((column) => column.replaceChildren());
    cards.forEach((card, index) => {
      const target = index < 2
        ? columns[index]
        : columns[0].getBoundingClientRect().height <= columns[1].getBoundingClientRect().height
          ? columns[0]
          : columns[1];
      target.append(card);
    });
    grid.dataset.tunerRebalancing = 'false';
  };

  const applyGlobal = (shouldRebalance = true) => {
    if (!document.body) return;
    globalFields.forEach((field) => {
      document.body.style.setProperty(field.css, `${globalConfig[field.key]}${field.unit}`);
    });
    if (shouldRebalance) requestAnimationFrame(rebalance);
  };

  const naturalRatio = (image) => {
    const ratio = Number(image?.naturalWidth) / Number(image?.naturalHeight);
    if (!Number.isFinite(ratio) || ratio <= 0) return 4 / 3;
    return Math.min(4 / 3, Math.max(3 / 4, ratio));
  };

  const restoreNaturalCover = (cover, image) => {
    if (!cover) return;
    cover.style.removeProperty('height');
    cover.style.aspectRatio = String(naturalRatio(image));
  };

  const resetCardStyles = (card) => {
    if (!card) return;
    const cover = card.querySelector('.plaza-card-cover');
    const image = cover?.querySelector('img');
    card.style.removeProperty('width');
    card.style.removeProperty('align-self');
    if (cover) {
      cover.style.removeProperty('width');
      cover.style.removeProperty('margin-inline');
      restoreNaturalCover(cover, image);
    }
    if (image) {
      image.style.removeProperty('transform');
      image.style.removeProperty('transform-origin');
      image.style.objectPosition = '50% 50%';
    }
  };

  const cardConfig = (postId) => normalize(cardConfigs[postId] || {}, cardFields);

  const applyCard = (card) => {
    const postId = card?.dataset?.post;
    if (!postId) return;
    resetCardStyles(card);
    const saved = cardConfigs[postId];
    if (!saved) return;
    const config = cardConfig(postId);
    const cover = card.querySelector('.plaza-card-cover');
    const image = cover?.querySelector('img');
    card.style.width = `${config.cardWidth}%`;
    card.style.alignSelf = 'center';
    if (cover) {
      cover.style.width = `${config.coverWidth}%`;
      cover.style.marginInline = 'auto';
      if (config.coverHeight > 0) {
        cover.style.height = `${config.coverHeight}px`;
        cover.style.aspectRatio = 'auto';
      } else {
        restoreNaturalCover(cover, image);
      }
    }
    if (image) {
      image.style.transform = `scale(${config.imageScale / 100})`;
      image.style.transformOrigin = 'center';
      image.style.objectPosition = `${config.positionX}% ${config.positionY}%`;
    }
  };

  const applyCards = (shouldRebalance = true) => {
    document.querySelectorAll('.plaza-card[data-post]').forEach(applyCard);
    if (shouldRebalance) requestAnimationFrame(rebalance);
  };

  const injectStyle = () => {
    if (document.querySelector('#plazaLayoutTunerV3Style')) return;
    const style = document.createElement('style');
    style.id = 'plazaLayoutTunerV3Style';
    style.textContent = `
      .plaza-layout-tuner-button,.plaza-layout-tuner,.plaza-tuner-v2-button,.plaza-tuner-v2{display:none!important}
      .plaza-tuner-v3-button{position:fixed;right:12px;bottom:max(14px,env(safe-area-inset-bottom));z-index:12020;min-width:68px;min-height:42px;padding:0 14px;border:0;border-radius:999px;background:#17191f;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.25);font-size:13px;font-weight:650}
      .plaza-tuner-v3{position:fixed;inset:auto 0 0;z-index:12030;max-height:min(84vh,780px);padding:0 14px max(14px,env(safe-area-inset-bottom));border-radius:20px 20px 0 0;background:rgba(255,255,255,.98);box-shadow:0 -12px 40px rgba(0,0,0,.24);overflow:auto;overscroll-behavior:contain}
      .plaza-tuner-v3[hidden]{display:none}
      .plaza-tuner-v3-head{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;margin:0 -14px;padding:12px 14px 9px;background:rgba(255,255,255,.98);border-bottom:1px solid #eee}
      .plaza-tuner-v3-head strong{font-size:16px}.plaza-tuner-v3-head span{color:#888;font-size:11px}.plaza-tuner-v3-close{margin-left:auto;width:34px;height:34px;padding:0;border-radius:50%;background:#f2f2f3;color:#222;font-size:20px}
      .plaza-tuner-v3-tabs{position:sticky;top:56px;z-index:3;display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:8px 0;background:rgba(255,255,255,.98)}
      .plaza-tuner-v3-tabs button{min-height:36px;padding:0;border-radius:10px;background:#f4f4f5;color:#555}.plaza-tuner-v3-tabs button.active{background:#ff2442;color:#fff}
      .plaza-tuner-v3-section[hidden]{display:none}.plaza-tuner-v3-note{margin:4px 0 8px;padding:10px;border-radius:10px;background:#fff3f5;color:#8d3341;font-size:12px;line-height:1.5}
      .plaza-tuner-v3-control{display:grid;grid-template-columns:minmax(108px,auto) minmax(0,1fr) 56px;align-items:center;gap:8px;min-height:44px}.plaza-tuner-v3-control label{font-size:12px;font-weight:500}.plaza-tuner-v3-control input{width:100%;margin:0;accent-color:#ff2442}.plaza-tuner-v3-control output{text-align:right;color:#666;font:11px/1.2 ui-monospace,monospace}
      .plaza-tuner-v3-actions{position:sticky;bottom:0;display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:8px -14px -1px;padding:10px 14px max(10px,env(safe-area-inset-bottom));background:rgba(255,255,255,.98);border-top:1px solid #eee}.plaza-tuner-v3-actions button{min-height:40px;padding:0 5px;border-radius:11px;font-size:12px}.plaza-tuner-v3-actions .secondary{background:#f2f2f3;color:#333}
      .plaza-card.plaza-tuner-selected{outline:3px solid #ff2442;outline-offset:2px;border-radius:7px}.plaza-card.plaza-tuner-pickable{outline:2px dashed rgba(255,36,66,.72);outline-offset:-2px}
    `;
    document.head.append(style);
  };

  const copyConfig = async () => {
    const payload = JSON.stringify({ version: 3, mode: 'plaza-layout', global: globalConfig, cards: cardConfigs }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      if (typeof window.showToast === 'function') window.showToast('整体与逐张配置已复制');
    } catch {
      window.prompt('复制以下布局配置', payload);
    }
  };

  const install = () => {
    if (!document.body || document.body.dataset.view !== 'plaza') return;
    injectStyle();
    applyGlobal(false);
    applyCards(false);
    document.querySelector('.plaza-layout-tuner-button')?.remove();
    document.querySelector('.plaza-layout-tuner')?.remove();
    document.querySelector('.plaza-tuner-v2-button')?.remove();
    document.querySelector('.plaza-tuner-v2')?.remove();
    if (document.querySelector('.plaza-tuner-v3-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plaza-tuner-v3-button';
    button.textContent = '调布局';

    const panel = document.createElement('section');
    panel.className = 'plaza-tuner-v3';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="plaza-tuner-v3-head">
        <div><strong>活动广场布局调试</strong><br><span>“单张图片”中的参数只作用于所选卡片</span></div>
        <button type="button" class="plaza-tuner-v3-close">×</button>
      </div>
      <div class="plaza-tuner-v3-tabs">
        <button type="button" class="active" data-tuner-tab="global">整体布局</button>
        <button type="button" data-tuner-tab="card">单张图片</button>
      </div>
      <div class="plaza-tuner-v3-section" data-tuner-section="global">
        ${globalFields.map((field) => `<div class="plaza-tuner-v3-control"><label>${field.label}</label><input type="range" min="${field.min}" max="${field.max}" step="${field.step}" data-global-key="${field.key}"><output data-global-output="${field.key}"></output></div>`).join('')}
      </div>
      <div class="plaza-tuner-v3-section" data-tuner-section="card" hidden>
        <p class="plaza-tuner-v3-note" data-card-note>点击底部“选择图片”，关闭面板后再点任意卡片。每张图片可设置不同宽度、高度、缩放和显示位置。</p>
        ${cardFields.map((field) => `<div class="plaza-tuner-v3-control"><label>${field.label}</label><input type="range" min="${field.min}" max="${field.max}" step="${field.step}" data-card-key="${field.key}" disabled><output data-card-output="${field.key}">—</output></div>`).join('')}
      </div>
      <div class="plaza-tuner-v3-actions">
        <button type="button" class="secondary" data-tuner-select>选择图片</button>
        <button type="button" class="secondary" data-tuner-reset>恢复当前</button>
        <button type="button" data-tuner-copy>复制配置</button>
        <button type="button" class="secondary" data-tuner-exit>退出调试</button>
      </div>`;

    const setTab = (name) => {
      panel.querySelectorAll('[data-tuner-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.tunerTab === name));
      panel.querySelectorAll('[data-tuner-section]').forEach((section) => { section.hidden = section.dataset.tunerSection !== name; });
    };
    const syncGlobal = () => {
      globalFields.forEach((field) => {
        const value = globalConfig[field.key];
        const input = panel.querySelector(`[data-global-key="${field.key}"]`);
        const output = panel.querySelector(`[data-global-output="${field.key}"]`);
        if (input) input.value = String(value);
        if (output) output.textContent = displayValue(field, value);
      });
    };
    const syncCard = () => {
      const config = selectedPostId ? cardConfig(selectedPostId) : normalize({}, cardFields);
      const card = selectedPostId ? document.querySelector(`.plaza-card[data-post="${CSS.escape(selectedPostId)}"]`) : null;
      const note = panel.querySelector('[data-card-note]');
      if (note) note.textContent = selectedPostId
        ? `正在单独调整：${card?.querySelector('.plaza-card-copy')?.textContent?.trim() || selectedPostId}`
        : '点击底部“选择图片”，关闭面板后再点任意卡片。每张图片可设置不同宽度、高度、缩放和显示位置。';
      cardFields.forEach((field) => {
        const input = panel.querySelector(`[data-card-key="${field.key}"]`);
        const output = panel.querySelector(`[data-card-output="${field.key}"]`);
        if (input) { input.disabled = !selectedPostId; input.value = String(config[field.key]); }
        if (output) output.textContent = selectedPostId ? displayValue(field, config[field.key]) : '—';
      });
    };

    syncGlobal();
    syncCard();
    button.onclick = () => { panel.hidden = !panel.hidden; };
    panel.querySelector('.plaza-tuner-v3-close').onclick = () => { panel.hidden = true; };
    panel.querySelectorAll('[data-tuner-tab]').forEach((tab) => { tab.onclick = () => setTab(tab.dataset.tunerTab); });
    panel.querySelectorAll('[data-global-key]').forEach((input) => {
      input.oninput = () => {
        globalConfig = normalize({ ...globalConfig, [input.dataset.globalKey]: Number(input.value) }, globalFields);
        writeJson(GLOBAL_KEY, globalConfig);
        applyGlobal(true);
        syncGlobal();
      };
    });
    panel.querySelectorAll('[data-card-key]').forEach((input) => {
      input.oninput = () => {
        if (!selectedPostId) return;
        cardConfigs[selectedPostId] = normalize({ ...cardConfig(selectedPostId), [input.dataset.cardKey]: Number(input.value) }, cardFields);
        writeJson(CARD_KEY, cardConfigs);
        applyCard(document.querySelector(`.plaza-card[data-post="${CSS.escape(selectedPostId)}"]`));
        syncCard();
        requestAnimationFrame(rebalance);
      };
    });
    panel.querySelector('[data-tuner-select]').onclick = () => {
      selectionMode = true;
      document.querySelectorAll('.plaza-card').forEach((card) => card.classList.add('plaza-tuner-pickable'));
      button.textContent = '点选图片';
      panel.hidden = true;
    };
    panel.querySelector('[data-tuner-reset]').onclick = () => {
      const cardTab = panel.querySelector('[data-tuner-tab="card"]')?.classList.contains('active');
      if (cardTab && selectedPostId) {
        delete cardConfigs[selectedPostId];
        writeJson(CARD_KEY, cardConfigs);
        resetCardStyles(document.querySelector(`.plaza-card[data-post="${CSS.escape(selectedPostId)}"]`));
        syncCard();
        requestAnimationFrame(rebalance);
      } else {
        globalConfig = normalize({}, globalFields);
        writeJson(GLOBAL_KEY, globalConfig);
        applyGlobal(true);
        syncGlobal();
      }
    };
    panel.querySelector('[data-tuner-copy]').onclick = () => { void copyConfig(); };
    panel.querySelector('[data-tuner-exit]').onclick = () => {
      try { localStorage.removeItem(DEBUG_KEY); } catch {}
      const url = new URL(location.href);
      url.searchParams.delete('layoutDebug');
      location.href = url.toString();
    };

    document.body.append(button, panel);
    requestAnimationFrame(rebalance);
  };

  document.addEventListener('click', (event) => {
    if (!selectionMode) return;
    const card = event.target.closest?.('.plaza-card[data-post]');
    if (!card) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectionMode = false;
    selectedPostId = card.dataset.post;
    document.querySelectorAll('.plaza-card').forEach((item) => item.classList.remove('plaza-tuner-pickable', 'plaza-tuner-selected'));
    card.classList.add('plaza-tuner-selected');
    const button = document.querySelector('.plaza-tuner-v3-button');
    const panel = document.querySelector('.plaza-tuner-v3');
    if (button) button.textContent = '调布局';
    if (panel) {
      panel.hidden = false;
      panel.querySelector('[data-tuner-tab="card"]')?.click();
      const config = cardConfig(selectedPostId);
      const note = panel.querySelector('[data-card-note]');
      if (note) note.textContent = `正在单独调整：${card.querySelector('.plaza-card-copy')?.textContent?.trim() || selectedPostId}`;
      cardFields.forEach((field) => {
        const input = panel.querySelector(`[data-card-key="${field.key}"]`);
        const output = panel.querySelector(`[data-card-output="${field.key}"]`);
        if (input) { input.disabled = false; input.value = String(config[field.key]); }
        if (output) output.textContent = displayValue(field, config[field.key]);
      });
    }
  }, true);

  const scheduleInstall = () => {
    if (installQueued) return;
    installQueued = true;
    requestAnimationFrame(() => {
      installQueued = false;
      install();
    });
  };

  const boot = () => {
    injectStyle();
    const observer = new MutationObserver(scheduleInstall);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-view']
    });
    scheduleInstall();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
