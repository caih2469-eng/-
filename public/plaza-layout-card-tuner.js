(() => {
  'use strict';

  const DEBUG_KEY = 'plazaLayoutDebugEnabled';
  const GLOBAL_KEY = 'plazaLayoutTunerV1';
  const CARD_KEY = 'plazaLayoutCardOverridesV2';
  const LEGACY_CARD_KEY = 'plazaLayoutCardOverridesV1';
  const fields = [
    { key: 'cardWidthPercent', label: '当前卡片整体宽度', min: 55, max: 100, step: 1, unit: '%', defaultValue: 100 },
    { key: 'frameWidthPercent', label: '当前图片画面宽度', min: 45, max: 100, step: 1, unit: '%', defaultValue: 100 },
    { key: 'heightPx', label: '当前图片画面高度', min: 0, max: 700, step: 10, unit: 'px', defaultValue: 0, autoZero: true },
    { key: 'scalePercent', label: '当前图片内容缩放', min: 100, max: 280, step: 5, unit: '%', defaultValue: 100 },
    { key: 'objectX', label: '当前图片水平位置', min: 0, max: 100, step: 1, unit: '%', defaultValue: 50 },
    { key: 'objectY', label: '当前图片垂直位置', min: 0, max: 100, step: 1, unit: '%', defaultValue: 50 }
  ];

  const debugEnabled = () => {
    try {
      return localStorage.getItem(DEBUG_KEY) === '1'
        || new URLSearchParams(location.search).get('layoutDebug') === '1';
    } catch {
      return false;
    }
  };
  if (!debugEnabled()) return;

  const clamp = (value, field) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : field.defaultValue;
    return Math.min(field.max, Math.max(field.min, safe));
  };
  const normalize = (candidate = {}) => Object.fromEntries(
    fields.map((field) => [field.key, clamp(candidate[field.key], field)])
  );
  const migrateLegacy = (legacy = {}) => Object.fromEntries(
    Object.entries(legacy).map(([postId, value]) => [postId, normalize({
      cardWidthPercent: 100,
      frameWidthPercent: value?.widthPercent,
      heightPx: value?.heightPx,
      scalePercent: 100,
      objectX: value?.objectX,
      objectY: value?.objectY
    })])
  );
  const loadOverrides = () => {
    try {
      const current = JSON.parse(localStorage.getItem(CARD_KEY) || 'null');
      if (current && typeof current === 'object') {
        return Object.fromEntries(Object.entries(current).map(([postId, value]) => [postId, normalize(value)]));
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_CARD_KEY) || '{}');
      const migrated = migrateLegacy(legacy);
      localStorage.setItem(CARD_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      return {};
    }
  };
  const saveOverrides = () => {
    try { localStorage.setItem(CARD_KEY, JSON.stringify(overrides)); } catch {}
  };
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  };
  const showMessage = (text) => {
    if (typeof window.showToast === 'function') window.showToast(text);
  };

  let overrides = loadOverrides();
  let selectedPostId = '';
  let picking = false;
  let lastCardSet = '';

  const defaultOverride = () => normalize({});
  const currentOverride = () => normalize(overrides[selectedPostId] || {});
  const fieldOutput = (field, value) => field.autoZero && Number(value) === 0
    ? '自动'
    : `${value}${field.unit}`;

  const naturalFeedRatio = (image) => {
    const ratio = Number(image?.naturalWidth) / Number(image?.naturalHeight);
    if (!Number.isFinite(ratio) || ratio <= 0) return 4 / 3;
    return Math.min(4 / 3, Math.max(3 / 4, ratio));
  };
  const restoreAutomaticHeight = (shell, image) => {
    if (!shell) return;
    shell.style.removeProperty('height');
    shell.style.aspectRatio = String(naturalFeedRatio(image));
    delete shell.dataset.individualHeight;
  };

  const rebalanceColumns = () => {
    const grid = document.querySelector('.plaza-grid');
    const columns = [...(grid?.querySelectorAll('[data-plaza-column]') || [])];
    if (!grid || columns.length !== 2 || grid.dataset.cardTunerRebalancing === 'true') return;
    const cards = [...grid.querySelectorAll('.plaza-card[data-post]')]
      .sort((left, right) => Number(left.dataset.cardIndex || 0) - Number(right.dataset.cardIndex || 0));
    if (!cards.length) return;
    grid.dataset.cardTunerRebalancing = 'true';
    columns.forEach((column) => column.replaceChildren());
    cards.forEach((card, index) => {
      const target = index < 2
        ? columns[index]
        : columns[0].getBoundingClientRect().height <= columns[1].getBoundingClientRect().height
          ? columns[0]
          : columns[1];
      target.append(card);
    });
    grid.dataset.cardTunerRebalancing = 'false';
  };

  const resetCardStyles = (card) => {
    const shell = card?.querySelector('.plaza-card-cover');
    const image = shell?.querySelector('img');
    if (!card || !shell) return;
    card.style.removeProperty('width');
    card.style.removeProperty('align-self');
    shell.style.removeProperty('width');
    shell.style.removeProperty('margin-inline');
    restoreAutomaticHeight(shell, image);
    if (image) {
      image.style.removeProperty('transform');
      image.style.removeProperty('transform-origin');
      image.style.objectPosition = '50% 50%';
    }
  };

  const applyCardOverride = (card) => {
    const postId = String(card?.dataset?.post || '');
    const shell = card?.querySelector('.plaza-card-cover');
    const image = shell?.querySelector('img');
    if (!postId || !shell) return;
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, postId);
    const value = normalize(overrides[postId] || {});

    resetCardStyles(card);
    card.classList.toggle('plaza-card-layout-selected', postId === selectedPostId);
    card.dataset.layoutCustomized = hasOverride ? 'true' : 'false';
    if (!hasOverride) return;

    card.style.width = `${value.cardWidthPercent}%`;
    card.style.alignSelf = 'center';
    shell.style.width = `${value.frameWidthPercent}%`;
    shell.style.marginInline = 'auto';
    if (value.heightPx > 0) {
      shell.style.height = `${value.heightPx}px`;
      shell.style.aspectRatio = 'auto';
      shell.dataset.individualHeight = 'true';
    } else {
      restoreAutomaticHeight(shell, image);
    }
    if (image) {
      image.style.transform = `scale(${value.scalePercent / 100})`;
      image.style.transformOrigin = 'center';
      image.style.objectPosition = `${value.objectX}% ${value.objectY}%`;
    }
  };

  const applyAllOverrides = (shouldRebalance = true) => {
    document.querySelectorAll('.plaza-card[data-post]').forEach(applyCardOverride);
    if (shouldRebalance) requestAnimationFrame(rebalanceColumns);
  };

  const injectStyle = () => {
    if (document.querySelector('#plazaCardLayoutTunerStyle')) return;
    const style = document.createElement('style');
    style.id = 'plazaCardLayoutTunerStyle';
    style.textContent = `
      .plaza-card-layout-selected { outline: 3px solid #ff2442 !important; outline-offset: 2px; border-radius: 7px; }
      .plaza-card[data-layout-customized="true"]::after { content: "单独调整"; position: absolute; top: 6px; right: 6px; z-index: 4; padding: 3px 6px; border-radius: 999px; background: rgba(0,0,0,.68); color: #fff; font: 10px/1.2 system-ui,sans-serif; pointer-events: none; }
      .plaza-card[data-layout-customized="true"] { position: relative; }
      .plaza-individual-editor { margin: 14px 0 0; padding: 14px; border-radius: 14px; background: #f7f7f8; }
      .plaza-individual-editor h3 { margin: 0 0 4px; font-size: 15px; }
      .plaza-individual-editor-note { margin: 0 0 12px; color: #777; font-size: 12px; line-height: 1.5; }
      .plaza-selected-work { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; padding: 8px 10px; border-radius: 10px; background: #fff; font-size: 12px; }
      .plaza-selected-work strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .plaza-card-control { display: grid; grid-template-columns: minmax(0,1fr) 52px; align-items: center; gap: 6px 10px; margin-top: 10px; }
      .plaza-card-control label { grid-column: 1 / -1; color: #555; font-size: 12px; }
      .plaza-card-control input[type="range"] { width: 100%; margin: 0; accent-color: #ff2442; }
      .plaza-card-control output { text-align: right; color: #ff2442; font-size: 12px; font-variant-numeric: tabular-nums; }
      .plaza-card-control input:disabled { opacity: .35; }
      .plaza-card-editor-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
      .plaza-card-editor-actions button { min-height: 38px; padding: 7px 9px; font-size: 12px; }
      .plaza-pick-hint { position: fixed; left: 50%; bottom: max(18px,env(safe-area-inset-bottom)); z-index: 100020; transform: translateX(-50%); padding: 10px 16px; border-radius: 999px; background: #17191f; color: #fff; font: 13px/1.2 system-ui,sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.24); }
    `;
    document.head.append(style);
  };

  const syncEditor = (section) => {
    const card = selectedPostId
      ? document.querySelector(`.plaza-card[data-post="${CSS.escape(selectedPostId)}"]`)
      : null;
    const title = card?.querySelector('.plaza-card-copy')?.textContent?.trim()
      || card?.querySelector('.plaza-publisher')?.textContent?.trim()
      || '';
    const selectedLabel = section.querySelector('[data-selected-work]');
    selectedLabel.textContent = selectedPostId ? (title || `作品 ${selectedPostId}`) : '尚未选择作品';
    const value = currentOverride();
    section.querySelectorAll('[data-card-layout-key]').forEach((input) => {
      const field = fields.find((item) => item.key === input.dataset.cardLayoutKey);
      input.disabled = !selectedPostId;
      input.value = String(value[field.key]);
      const output = section.querySelector(`[data-card-layout-output="${field.key}"]`);
      if (output) output.textContent = fieldOutput(field, value[field.key]);
    });
    section.querySelectorAll('[data-needs-selected]').forEach((button) => {
      button.disabled = !selectedPostId;
    });
    applyAllOverrides(true);
  };

  const ensureEditor = () => {
    const panel = document.querySelector('.plaza-layout-tuner');
    if (!panel || panel.querySelector('.plaza-individual-editor')) return;
    const section = document.createElement('section');
    section.className = 'plaza-individual-editor';
    section.innerHTML = `
      <h3>单独调整每张作品</h3>
      <p class="plaza-individual-editor-note">先选择一张作品，再分别修改卡片宽度、图片画面宽高、内容缩放和裁切位置。其他作品不会同步变化。</p>
      <div class="plaza-selected-work"><span>当前作品</span><strong data-selected-work>尚未选择作品</strong></div>
      <button type="button" data-card-pick>选择一张作品</button>
      ${fields.map((field) => `
        <div class="plaza-card-control">
          <label for="plazaCard_${field.key}">${field.label}</label>
          <input id="plazaCard_${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${field.defaultValue}" data-card-layout-key="${field.key}">
          <output for="plazaCard_${field.key}" data-card-layout-output="${field.key}">${fieldOutput(field, field.defaultValue)}</output>
        </div>`).join('')}
      <div class="plaza-card-editor-actions">
        <button type="button" class="secondary" data-card-auto data-needs-selected>高度恢复自动</button>
        <button type="button" class="secondary" data-card-reset data-needs-selected>恢复当前作品</button>
        <button type="button" data-card-copy-all>复制全部配置</button>
        <button type="button" class="secondary" data-card-reset-all>清除全部单卡设置</button>
      </div>`;

    const actions = panel.querySelector('.plaza-layout-tuner-actions');
    panel.insertBefore(section, actions || null);

    section.querySelector('[data-card-pick]').onclick = () => {
      picking = true;
      panel.hidden = true;
      document.querySelector('.plaza-layout-tuner-button')?.setAttribute('aria-expanded', 'false');
      let hint = document.querySelector('.plaza-pick-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'plaza-pick-hint';
        document.body.append(hint);
      }
      hint.textContent = '请点击要单独调整的作品';
    };

    section.querySelectorAll('[data-card-layout-key]').forEach((input) => {
      input.oninput = () => {
        if (!selectedPostId) return;
        const field = fields.find((item) => item.key === input.dataset.cardLayoutKey);
        overrides[selectedPostId] = normalize({ ...currentOverride(), [field.key]: clamp(input.value, field) });
        saveOverrides();
        syncEditor(section);
      };
    });

    section.querySelector('[data-card-auto]').onclick = () => {
      if (!selectedPostId) return;
      overrides[selectedPostId] = normalize({ ...currentOverride(), heightPx: 0 });
      saveOverrides();
      syncEditor(section);
    };
    section.querySelector('[data-card-reset]').onclick = () => {
      if (!selectedPostId) return;
      delete overrides[selectedPostId];
      saveOverrides();
      syncEditor(section);
      showMessage('已恢复当前作品');
    };
    section.querySelector('[data-card-reset-all]').onclick = () => {
      overrides = {};
      saveOverrides();
      syncEditor(section);
      showMessage('已清除全部单卡设置');
    };
    section.querySelector('[data-card-copy-all]').onclick = async () => {
      let global = {};
      try { global = JSON.parse(localStorage.getItem(GLOBAL_KEY) || '{}'); } catch {}
      const payload = JSON.stringify({ version: 3, mode: 'plaza-layout', global, cards: overrides }, null, 2);
      await copyText(payload);
      showMessage('整体和逐张参数已复制');
    };
    syncEditor(section);
  };

  document.addEventListener('click', (event) => {
    const exit = event.target.closest?.('[data-layout-exit]');
    if (exit) {
      try {
        localStorage.removeItem(DEBUG_KEY);
        localStorage.removeItem(CARD_KEY);
        localStorage.removeItem(LEGACY_CARD_KEY);
      } catch {}
      return;
    }
    if (!picking) return;
    const card = event.target.closest?.('.plaza-card[data-post]');
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selectedPostId = String(card.dataset.post || '');
    picking = false;
    document.querySelector('.plaza-pick-hint')?.remove();
    applyAllOverrides(true);
    const panel = document.querySelector('.plaza-layout-tuner');
    if (panel) panel.hidden = false;
    document.querySelector('.plaza-layout-tuner-button')?.setAttribute('aria-expanded', 'true');
    const section = panel?.querySelector('.plaza-individual-editor');
    if (section) syncEditor(section);
  }, true);

  injectStyle();
  const timer = setInterval(() => {
    if (!debugEnabled()) {
      clearInterval(timer);
      return;
    }
    if (document.body.dataset.view !== 'plaza') return;
    ensureEditor();
    const cardSet = [...document.querySelectorAll('.plaza-card[data-post]')]
      .map((card) => card.dataset.post)
      .join('|');
    if (cardSet !== lastCardSet) {
      lastCardSet = cardSet;
      applyAllOverrides(true);
    }
  }, 250);
})();
