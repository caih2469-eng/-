function openStudentCheckinHistory() {
  let root = document.querySelector('#modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    document.body.appendChild(root);
  }
  let page = 1;
  let loading = false;
  root.innerHTML = `<div class="drawer-backdrop" id="historyDrawerBackdrop">
    <section class="bottom-drawer history-drawer" role="dialog" aria-modal="true" aria-labelledby="historyDrawerTitle">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">我的记录</small><h2 id="historyDrawerTitle">历史打卡</h2></div>
        <button class="secondary right" id="closeHistoryDrawer">关闭</button>
      </div>
      <div id="studentHistoryList"><p class="muted">正在读取历史打卡…</p></div>
      <button class="secondary full-width" id="moreStudentHistory" hidden>加载更多</button>
    </section>
  </div>`;
  const list = root.querySelector('#studentHistoryList');
  const more = root.querySelector('#moreStudentHistory');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeHistoryDrawer').onclick = close;
  root.querySelector('#historyDrawerBackdrop').onclick = (event) => {
    if (event.target.id === 'historyDrawerBackdrop') close();
  };

  const renderRecord = (record) => {
    const title = record.taskName
      || config?.slots?.find((slot) => slot.id === record.slotId)?.label
      || '打卡';
    const status = {
      pending: '待审核',
      submitted: '已提交',
      approved: '已通过',
      rejected: '已退回',
      returned: '退回修改'
    }[record.status] || record.status || '已提交';
    const images = (Array.isArray(record.images) ? record.images : []).map((media, index) => {
      const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl || media.displayUrl;
      const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
      if (!thumbUrl) return '';
      return `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
        data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
        data-image-alt="${escapeHtml(title)}图片">
        <span class="image-shell"><img data-src="${escapeHtml(thumbUrl)}" loading="${index ? 'lazy' : 'eager'}"
          width="480" height="360" fetchpriority="${index ? 'low' : 'high'}"
          decoding="async" alt="${escapeHtml(title)}图片"
          onload="this.parentElement.classList.add('loaded')"
          onerror="this.hidden=true;this.parentElement.classList.add('failed')">
          <span class="image-error">图片加载失败，点击重试</span></span>
      </button>`;
    }).join('');
    return `<article class="history-checkin-card">
      <div class="row"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(record.date || '')}</small></div>
        <span class="pill ${record.status === 'approved' ? 'done' : 'pending'}">${escapeHtml(status)}</span></div>
      <p class="muted">${escapeHtml(formatDate(record.submittedAt))}</p>
      ${images ? `<div class="drawer-photo-grid compact">${images}</div>` : '<p class="muted">该记录没有可显示的图片</p>'}
      ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ''}
      ${record.reviewNote ? `<p class="bad">审核说明：${escapeHtml(record.reviewNote)}</p>` : ''}
    </article>`;
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const result = await api(`/api/checkins/history?page=${page}&limit=20`);
      const records = Array.isArray(result.records) ? result.records : [];
      if (page === 1) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', records.map(renderRecord).join(''));
      if (!records.length && page === 1) list.innerHTML = '<p class="muted">暂无历史打卡记录</p>';
      const total = Number(result.total || 0);
      const loaded = Math.min(total, page * Number(result.limit || 20));
      prepareDynamicContent(list);
      more.hidden = result.hasMore === false || loaded >= total || !records.length;
      more.textContent = `加载更多（${loaded}/${total}）`;
      page += 1;
    } catch (error) {
      if (page === 1) list.innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button id="retryStudentHistory">重新读取</button></div>`;
      list.querySelector('#retryStudentHistory')?.addEventListener('click', () => {
        page = 1;
        void load();
      });
      more.hidden = true;
    } finally {
      loading = false;
      more.disabled = false;
    }
  };
  more.onclick = load;
  void load();
}
