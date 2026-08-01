(() => {
  'use strict';

  const GRID_SELECTOR = '.plaza-grid';
  const CARD_SELECTOR = '.plaza-card[data-post]';
  const COLUMN_SELECTOR = '[data-plaza-column]';
  const stateByGrid = new WeakMap();
  const activeGrids = new Set();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const readCssNumber = (name, fallback) => {
    const value = Number.parseFloat(getComputedStyle(document.body).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };

  const cardKey = (card) => String(card?.dataset?.post || card?.dataset?.cardIndex || '');

  const sortedCards = (grid) => [...grid.querySelectorAll(CARD_SELECTOR)]
    .sort((left, right) => Number(left.dataset.cardIndex || 0) - Number(right.dataset.cardIndex || 0));

  const feedRatioForImage = (image) => {
    const naturalWidth = Number(image?.naturalWidth || image?.getAttribute?.('width') || 0);
    const naturalHeight = Number(image?.naturalHeight || image?.getAttribute?.('height') || 0);
    const naturalRatio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 4 / 3;
    const minRatio = readCssNumber('--plaza-cover-min-ratio', 3 / 4);
    const maxRatio = Math.max(minRatio, readCssNumber('--plaza-cover-max-ratio', 4 / 3));
    return clamp(naturalRatio, minRatio, maxRatio);
  };

  const applyAutomaticCover = (image) => {
    const cover = image?.closest?.('.plaza-card-cover');
    if (!cover || image.hidden) return;
    if (cover.dataset.individualHeight === 'true' || Number.parseFloat(cover.style.height) > 0) return;
    const ratio = feedRatioForImage(image);
    cover.style.setProperty('aspect-ratio', String(ratio));
    cover.dataset.feedRatio = ratio.toFixed(4);
    cover.classList.add('loaded');
    image.style.setProperty('display', 'block');
    image.style.setProperty('width', '100%', 'important');
    image.style.setProperty('height', '100%', 'important');
    image.style.setProperty('object-fit', 'cover', 'important');
  };

  const estimateCardHeight = (card, columnWidth) => {
    const cover = card.querySelector('.plaza-card-cover');
    const image = cover?.querySelector('img');
    const cardWidthPercent = clamp(Number.parseFloat(card.style.width) || 100, 10, 100) / 100;
    const effectiveWidth = Math.max(1, columnWidth * cardWidthPercent);
    const coverWidthPercent = clamp(Number.parseFloat(cover?.style.width) || 100, 10, 100) / 100;
    const effectiveCoverWidth = Math.max(1, effectiveWidth * coverWidthPercent);
    const fixedCoverHeight = Number.parseFloat(cover?.style.height || '0');
    const ratio = Number.parseFloat(cover?.dataset.feedRatio || '')
      || (image ? feedRatioForImage(image) : 4 / 3);
    const coverHeight = fixedCoverHeight > 0 ? fixedCoverHeight : effectiveCoverWidth / ratio;

    const copy = card.querySelector('.plaza-card-copy');
    const copyText = String(copy?.textContent || '').trim();
    const titleFontSize = readCssNumber('--plaza-title-font-size', 15);
    const titleLineHeight = readCssNumber('--plaza-title-line-height', 21);
    const titlePadding = readCssNumber('--plaza-title-padding', 10);
    const titleTopGap = copyText ? readCssNumber('--plaza-title-top-gap', 8) : 0;
    const usableTextWidth = Math.max(20, effectiveWidth - titlePadding * 2);
    const charactersPerLine = Math.max(6, Math.floor(usableTextWidth / Math.max(8, titleFontSize * 0.95)));
    const titleLines = copyText ? Math.min(2, Math.max(1, Math.ceil(copyText.length / charactersPerLine))) : 0;
    const authorHeight = readCssNumber('--plaza-author-height', 34);
    return Math.round((coverHeight + titleTopGap + titleLines * titleLineHeight + authorHeight) * 10) / 10;
  };

  const measureCard = (card, state) => {
    const key = cardKey(card);
    const height = Math.round(card.getBoundingClientRect().height * 10) / 10;
    if (!key || !Number.isFinite(height) || height <= 0) return false;
    const previous = state.measuredHeights.get(key);
    state.measuredHeights.set(key, height);
    return !Number.isFinite(previous) || Math.abs(previous - height) > 1;
  };

  const scheduleGrid = (grid) => {
    const state = stateByGrid.get(grid);
    if (!state || state.frame || !grid.isConnected) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      layoutGrid(grid);
    });
  };

  const layoutGrid = (grid) => {
    const state = stateByGrid.get(grid);
    const columns = [...grid.querySelectorAll(COLUMN_SELECTOR)];
    const cards = sortedCards(grid);
    if (!state || state.rebalancing || columns.length !== 2 || cards.length === 0) return;

    cards.forEach((card) => measureCard(card, state));
    const gridWidth = grid.getBoundingClientRect().width || Math.max(320, window.innerWidth - 10);
    const columnGap = readCssNumber('--plaza-column-gap', 5);
    const cardGap = readCssNumber('--plaza-card-gap', 10);
    const columnWidth = Math.max(1, (gridWidth - columnGap) / 2);
    const assignments = [[], []];
    const columnHeights = [0, 0];

    for (const card of cards) {
      const key = cardKey(card);
      const targetColumnIndex = columnHeights[1] < columnHeights[0] ? 1 : 0;
      assignments[targetColumnIndex].push(card);
      const measuredHeight = state.measuredHeights.get(key);
      const cardHeight = Number.isFinite(measuredHeight)
        ? measuredHeight
        : estimateCardHeight(card, columnWidth);
      columnHeights[targetColumnIndex] += cardHeight + cardGap;
    }

    state.rebalancing = true;
    columns.forEach((column, index) => column.replaceChildren(...assignments[index]));
    grid.dataset.estimatedColumnHeights = columnHeights.map((height) => Math.round(height)).join(',');
    state.rebalancing = false;

    requestAnimationFrame(() => {
      let changed = false;
      cards.forEach((card) => {
        state.resizeObserver.observe(card);
        if (measureCard(card, state)) changed = true;
      });
      if (changed && state.verificationPass < 2) {
        state.verificationPass += 1;
        scheduleGrid(grid);
      } else {
        state.verificationPass = 0;
      }
    });
  };

  const bindGrid = (grid) => {
    if (!(grid instanceof HTMLElement) || stateByGrid.has(grid)) return;
    const state = {
      frame: 0,
      rebalancing: false,
      verificationPass: 0,
      measuredHeights: new Map(),
      resizeObserver: null
    };
    state.resizeObserver = new ResizeObserver((entries) => {
      if (state.rebalancing) return;
      let changed = false;
      for (const entry of entries) {
        if (entry.target.matches?.(CARD_SELECTOR) && measureCard(entry.target, state)) changed = true;
      }
      if (changed) scheduleGrid(grid);
    });
    stateByGrid.set(grid, state);
    activeGrids.add(grid);

    grid.addEventListener('load', (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.closest('.plaza-card-cover')) return;
      applyAutomaticCover(image);
      const card = image.closest(CARD_SELECTOR);
      if (card) measureCard(card, state);
      scheduleGrid(grid);
    }, true);

    grid.addEventListener('error', (event) => {
      if (event.target instanceof HTMLImageElement) scheduleGrid(grid);
    }, true);

    sortedCards(grid).forEach((card) => {
      state.resizeObserver.observe(card);
      const image = card.querySelector('.plaza-card-cover img');
      if (image?.complete && image.naturalWidth) applyAutomaticCover(image);
    });
    scheduleGrid(grid);
  };

  const scanForGrids = (root = document) => {
    if (root instanceof Element && root.matches(GRID_SELECTOR)) bindGrid(root);
    root.querySelectorAll?.(GRID_SELECTOR).forEach(bindGrid);
  };

  const start = () => {
    scanForGrids();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scanForGrids(node);
        });
      }
      for (const grid of [...activeGrids]) {
        if (!grid.isConnected) activeGrids.delete(grid);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => {
      activeGrids.forEach((grid) => scheduleGrid(grid));
    }, { passive: true });
  };

  window.schedulePlazaMasonryLayout = () => {
    activeGrids.forEach((grid) => scheduleGrid(grid));
  };
  window.applyAutomaticPlazaCover = applyAutomaticCover;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
