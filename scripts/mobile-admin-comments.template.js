const adminCommentsCache = new Map();

const renderAdminCommentsPage = (result, page, pageEpoch, options = {}) => {
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'admin-comments';
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>评论管理</h1><p>管理员可查看并删除活动广场中的违规评论</p></div><button class="secondary right" id="backComments">返回后台</button></div></header>
    <section class="card">
      ${options.stale ? '<p class="view-cache-status muted">正在后台刷新最新评论…</p>' : ''}
      <div class="admin-comment-list">${result.comments.map((comment) => `
        <article class="comment-item" data-comment="${comment.id}" data-post="${comment.postId || ''}">
          <div class="row"><strong>${escapeHtml(comment.userName)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div>
          <p>${escapeHtml(comment.content)}</p>
          <div class="row"><span class="muted">所属队伍：${escapeHtml(comment.teamName)}</span><button class="danger right delete-admin-comment">删除评论</button></div>
        </article>`).join('') || '<p class="muted">暂无评论</p>'}</div>
      <div class="row plaza-pager"><button class="secondary" id="prevAdminComments" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button class="secondary" id="nextAdminComments" ${!result.hasMore ? 'disabled' : ''}>下一页</button></div>
    </section>`;
  document.querySelector('#backComments').onclick = () => admin();
  document.querySelector('#prevAdminComments').onclick = () => adminComments(page - 1);
  document.querySelector('#nextAdminComments').onclick = () => adminComments(page + 1);
  document.querySelectorAll('.delete-admin-comment').forEach((button) => {
    button.onclick = async (event) => {
      const item = button.closest('[data-comment]');
      if (!await askConfirm('是否删除该评论？', '删除后活动广场会立即同步，且无法恢复。')) return;
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
        await api(`/api/admin/comments/${item.dataset.comment}`, { method: 'DELETE' });
        plazaViewCache.clear();
        for (const cached of adminCommentsCache.values()) {
          cached.data.comments = cached.data.comments.filter((comment) => comment.id !== item.dataset.comment);
        }
        item.remove();
        if (!document.querySelector('.admin-comment-list .comment-item')) {
          document.querySelector('.admin-comment-list').innerHTML = '<p class="muted">暂无评论</p>';
        }
        showToast('评论已删除');
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
};

async function adminComments(page = 1) {
  const pageEpoch = beginNavigation();
  const cacheKey = String(page);
  const cached = adminCommentsCache.get(cacheKey);
  if (cached) renderAdminCommentsPage(cached.data, page, pageEpoch, { stale: true });
  else {
    document.body.dataset.view = 'admin-comments';
    app.innerHTML = `
      <header class="hero"><div class="row"><div><h1>评论管理</h1><p>管理员可查看并删除活动广场中的违规评论</p></div><button class="secondary right" id="backComments">返回后台</button></div></header>
      <section class="card"><div class="admin-panel-loading">正在读取评论…</div></section>`;
    document.querySelector('#backComments').onclick = () => admin();
  }
  try {
    const result = await api(`/api/admin/comments?page=${page}&limit=20`);
    adminCommentsCache.set(cacheKey, { data: result, savedAt: Date.now() });
    if (!isCurrentNavigation(pageEpoch)) return;
    renderAdminCommentsPage(result, page, pageEpoch);
  } catch (error) {
    if (cached || !isCurrentNavigation(pageEpoch)) return;
    app.querySelector('.card').innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button id="retryAdminComments">重新加载</button></div>`;
    document.querySelector('#retryAdminComments').onclick = () => adminComments(page);
  }
}
