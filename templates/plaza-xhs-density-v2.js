/* PLAZA_XHS_DENSITY_V2 */
const clampPlazaCoverRatio = (image) => {
  if (!(image instanceof HTMLImageElement) || image.dataset.perfImage !== 'plaza-thumb') return;
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;
  const shell = image.closest('.plaza-card-cover');
  if (!shell) return;
  const naturalRatio = image.naturalWidth / image.naturalHeight;
  const feedRatio = Math.min(1.5, Math.max(.75, naturalRatio));
  shell.style.aspectRatio = String(feedRatio);
  shell.dataset.feedRatio = feedRatio.toFixed(3);
};

const normalizePlazaCard = (card) => {
  if (!(card instanceof HTMLElement) || !card.matches('.plaza-card')) return;
  card.querySelector('.plaza-body h2')?.remove();
  const like = card.querySelector('.plaza-like');
  if (like && like.dataset.iconized !== 'true') {
    const count = String(like.textContent || '').replace(/[^0-9万.]/g, '') || '0';
    like.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.5 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg><span>${count}</span>`;
    like.dataset.iconized = 'true';
  }
  const image = card.querySelector('img[data-perf-image="plaza-thumb"]');
  if (image) clampPlazaCoverRatio(image);
};

const normalizePlazaFeed = (root = document) => {
  root.querySelectorAll?.('.plaza-card').forEach(normalizePlazaCard);
};

document.addEventListener('load', (event) => {
  clampPlazaCoverRatio(event.target);
}, true);

const plazaObserver = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches('.plaza-card')) normalizePlazaCard(node);
      normalizePlazaFeed(node);
    }
  }
});

const startPlazaDensity = () => {
  normalizePlazaFeed();
  plazaObserver.observe(document.body, { childList: true, subtree: true });
  document.documentElement.classList.add('plaza-xhs-density-v2');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPlazaDensity, { once: true });
} else {
  startPlazaDensity();
}
