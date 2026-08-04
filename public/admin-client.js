/* ADMIN_CLIENT_LAZY_CLIENT_V1 */
async function adminComments(page = 1) {
  const pageEpoch = beginNavigation();
  const result = await api(`/api/admin/comments?page=${page}&limit=20`);
  if (!isCurrentNavigation(pageEpoch)) return;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>评论管理</h1><p>管理员可查看并删除活动广场中的违规评论</p></div><button class="secondary right" id="backComments">返回后台</button></div></header>
    <section class="card"><div class="admin-comment-list">${result.comments.map((comment) => `
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
        item.remove();
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
}

async function admin(selectedDate, pageEpoch = beginNavigation()) {
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'admin';
  app.innerHTML = '<main class="app-shell-placeholder" aria-busy="true"><header class="hero"></header><section class="metric-grid"></section><section class="card"></section></main>';
  const date = selectedDate || new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai'
  });
  const [completion, userResult, teamResult, taskAdminResult, plazaAdminResult, overview, materialAdmin, governance] = await Promise.all([
    api(`/api/admin/completion-summary?date=${date}`),
    api(`/api/admin/users?page=${adminUserPage}&limit=30&q=${encodeURIComponent(adminUserQuery)}&completion=${adminUserFilter}&date=${date}&track=${adminCompletionTrack === 'all' ? '' : adminCompletionTrack}`),
    api('/api/admin/teams'),
    api('/api/admin/tasks'),
    api('/api/admin/plaza?page=1&limit=30'),
    api('/api/admin/overview'),
    api(`/api/admin/material-tasks?page=${materialAdminPage}&limit=30&campus=${encodeURIComponent(materialAdminCampus)}`),
    api('/api/admin/governance')
  ]);
  if (!isCurrentNavigation(pageEpoch)) return;
  const users = userResult.users;
  const userTiles = users.map((studentUser, index) => `
    <button class="admin-user-tile ${studentUser.completed ? 'completed' : 'missing'}" data-id="${studentUser.id}">
      <span class="user-number">${(userResult.page - 1) * userResult.limit + index + 1}</span>
      <strong>${escapeHtml(studentUser.name)}</strong>
      ${studentUser.completed ? '<span class="user-completion" aria-label="已完成">✓</span>' : ''}
    </button>`).join('');
  const overallSummary = completion.overall;
  const interactionSummary = completion.tracks.find((item) => item.trackId === 'interaction')
    || { completed: 0, total: 0 };
  const healthSummary = completion.tracks.find((item) => item.trackId === 'health')
    || { completed: 0, total: 0 };
  const teamRows = teamResult.teams.map((team) => `
    <tr>
      <td>${escapeHtml(team.name)}<br><small>邀请码：<strong>${escapeHtml(team.inviteCode)}</strong></small></td>
      <td>${team.memberCount}/${team.memberLimit}</td>
      <td>
        <div><strong>队长：${team.captain ? `${escapeHtml(team.captain.name)}（${escapeHtml(team.captain.studentId)}）` : '未指定'}</strong></div>
        <div class="member-list compact">${team.members.length
          ? team.members.map((member) => `<span>${escapeHtml(member.name)} <button class="mini danger remove-member" data-team="${team.id}" data-user="${member.id}" title="移除成员">×</button></span>`).join('')
          : '<span class="muted">空队伍</span>'}
        </div>
      </td>
      <td class="actions">
        <button class="secondary edit-team" data-id="${team.id}">修改</button>
        <button class="secondary add-team-member" data-id="${team.id}" ${team.isFull ? 'disabled' : ''}>加入成员</button>
        <button class="secondary set-captain" data-id="${team.id}">${team.captain ? '更换队长' : '指定队长'}</button>
        ${team.captain ? `<button class="secondary clear-captain" data-id="${team.id}">取消队长</button>` : ''}
        <button class="danger dissolve-team" data-id="${team.id}">解散</button>
      </td>
    </tr>`).join('');
  const taskStatusNames = { draft: '草稿', published: '发布', closed: '关闭', archived: '归档' };
  const submissionStatusNames = { draft: '草稿', submitted: '已提交', returned: '退回', approved: '通过' };
  const taskRows = taskAdminResult.tasks.map((task) => {
    const submissions = taskAdminResult.submissions.filter((item) => item.taskId === task.id);
    return `<tr><td>${escapeHtml(task.name)}</td><td>${escapeHtml(trackName(task.trackId))}</td><td>${taskStatusNames[task.status]}</td><td>${formatDate(task.startAt)}<br>${formatDate(task.endAt)}</td><td>${submissions.length}</td><td><button class="secondary edit-task" data-id="${task.id}">编辑</button></td></tr>`;
  }).join('');
  const submissionRows = taskAdminResult.submissions.map((item) => {
    const task = taskAdminResult.tasks.find((entry) => entry.id === item.taskId);
    return `<tr><td>${escapeHtml(task?.name || '已归档任务')}</td><td>${item.ownerType === 'team' ? '队伍' : '个人'} ${escapeHtml(item.ownerId)}</td><td>${submissionStatusNames[item.status] || item.status}</td><td>${item.images.map((url) => `<a href="${escapeHtml(url)}" target="_blank">图片</a>`).join(' ')}</td><td>${escapeHtml(item.copy)}</td><td>${item.status === 'submitted' ? `<button class="approve-submission" data-id="${item.id}">通过</button><button class="danger return-submission" data-id="${item.id}">退回</button>` : ''}<button class="danger delete-submission" data-id="${item.id}">删除</button></td></tr>`;
  }).join('');
  const plazaRows = plazaAdminResult.posts.map((post) => `<tr>
    <td>${escapeHtml(post.teamName)}</td><td>${escapeHtml(post.taskName)}</td><td>${post.members.map((member) => escapeHtml(member.name)).join('、')}</td>
    <td>${post.status === 'visible' ? '公开' : '已隐藏'}</td><td>${post.viewCount}</td><td>${post.likeCount}</td>
    <td><button class="secondary toggle-post" data-id="${post.id}" data-status="${post.status === 'visible' ? 'hidden' : 'visible'}">${post.status === 'visible' ? '隐藏' : '恢复'}</button><button class="secondary exclude-post" data-id="${post.id}" data-excluded="${!post.excludedFromRanking}">${post.excludedFromRanking ? '恢复排名' : '排除排名'}</button><button class="danger delete-post" data-id="${post.id}">删除</button></td>
  </tr>`).join('');
  const materialTaskRows = materialAdmin.tasks.map((task) => {
    const submissions = materialAdmin.submissions.filter((item) => item.taskId === task.id);
    const progress = materialAdmin.campusProgress?.find((item) => item.taskId === task.id)?.campuses || [];
    return `<tr><td>${escapeHtml(task.title)}</td><td>个人</td><td>${formatDate(task.deadline)}</td><td>${task.fileTypes.map((type) => `.${escapeHtml(type)}`).join('、')}</td><td>${submissions.length}</td><td>${progress.map((item) => `${escapeHtml(item.campus)} ${item.completed}/${item.total}`).join('<br>')}</td><td><button class="secondary missing-material" data-id="${task.id}">导出未提交名单</button></td></tr>`;
  }).join('');
  const materialSubmissionRows = materialAdmin.submissions.map((item) => {
    const task = materialAdmin.tasks.find((entry) => entry.id === item.taskId);
    return `<tr><td>${escapeHtml(task?.title || '已删除任务')}</td><td>${escapeHtml(item.owner?.campus || '未设置')}</td><td>${escapeHtml(item.owner?.name || item.ownerId)}<br><small>${escapeHtml(item.owner?.studentId || '')}</small></td><td>${item.status === 'returned' ? '已退回' : '已提交'}</td><td>${item.files.map((file) => `<button class="secondary admin-material-download" data-url="${file.downloadUrl}" data-name="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</button>`).join(' ')}</td><td>${escapeHtml(item.summary)}</td><td>${item.status === 'submitted' ? `<button class="danger return-material" data-id="${item.id}">退回修改</button>` : escapeHtml(item.reviewNote || '等待重新提交')}</td></tr>`;
  }).join('');

  app.innerHTML = `
    <header class="hero">
      <div class="row"><div><h1>活动管理后台</h1><div>${escapeHtml(config.activityName)}</div></div><button class="secondary right" id="ranking">排行榜</button><button class="secondary" id="plaza">活动广场</button><button class="secondary" id="commentAdmin">评论管理</button><button class="secondary" id="out">退出</button></div>
    </header>
    <section class="metric-grid">
      ${[['用户数量',overview.userCount],['队伍数量',overview.teamCount],['今日提交',overview.todaySubmissions],['公开帖子',overview.publicPostCount],['点赞数量',overview.likeCount],['浏览数量',overview.viewCount]].map(([label,value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
    </section>
    <section class="card">
      <details>
        <summary>修改我的管理员密码</summary>
        <form id="changeAdminPassword" class="inline-form">
          <input name="currentPassword" type="password" autocomplete="current-password" placeholder="当前密码" required>
          <input name="newPassword" type="password" autocomplete="new-password" minlength="8" placeholder="新密码（至少8位）" required>
          <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="再次输入新密码" required>
          <button>修改密码</button>
        </form>
      </details>
    </section>
    ${governance.isPrimary ? `<section class="card">
      <div class="row"><div><h2>管理员账号与操作监督</h2><p class="muted">只有最高管理员可以创建管理员，并查看、驳回其他管理员的补卡和审核操作。</p></div><span class="pill done">最高管理员</span></div>
      <details>
        <summary>创建管理员账号</summary>
        <form id="createAdmin" class="inline-form">
          <input name="studentId" placeholder="管理员账号" required>
          <input name="name" placeholder="管理员姓名" required>
          <input name="campus" placeholder="校区" value="金山学院" required>
          <input name="password" type="password" minlength="8" placeholder="初始密码（至少8位）" required>
          <button>创建管理员</button>
        </form>
      </details>
      <h3>管理员列表</h3>
      <div class="member-list">${governance.admins.map((item) => `<span>${escapeHtml(item.name)} · ${escapeHtml(item.studentId)} · ${item.id === user.id ? '最高管理员' : '管理员'}</span>`).join('')}</div>
      <h3>其他管理员操作记录</h3>
      <div class="table-wrap"><table><thead><tr><th>管理员</th><th>操作</th><th>对象</th><th>时间</th><th>状态</th><th>处理</th></tr></thead><tbody>
        ${governance.logs.map((item) => `<tr><td>${escapeHtml(item.actorName)}<br><small>${escapeHtml(item.actorStudentId)}</small></td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entityType)}</td><td>${formatDate(item.createdAt)}</td><td>${item.reviewStatus === 'rejected' ? '<span class="pill pending">已驳回</span>' : '<span class="pill done">有效</span>'}</td><td>${item.reviewStatus !== 'rejected' && ['makeup','approved','returned'].includes(item.action) ? `<button class="danger reject-admin-action" data-id="${item.id}">驳回操作</button>` : '仅查看'}</td></tr>`).join('') || '<tr><td colspan="6">暂无其他管理员操作</td></tr>'}
      </tbody></table></div>
    </section>` : ''}
    <section class="card admin-user-section">
      <div class="row completion-heading">
        <div><h2>每日完成情况</h2><p class="muted">三餐全部提交才计为“食光有约”当日完成；点击姓名查看详情或补卡</p></div>
        <label class="right">日期 <input id="date" type="date" value="${date}"></label><button class="secondary" id="reload">查询</button>
      </div>
      <div class="completion-summary-grid">
        <button class="completion-summary ${adminCompletionTrack === 'all' ? 'active' : ''}" data-track="all"><span>总完成情况</span><strong>${overallSummary.completed}/${overallSummary.total}</strong></button>
        <button class="completion-summary ${adminCompletionTrack === 'interaction' ? 'active' : ''}" data-track="interaction"><span>廿载同心</span><strong>${interactionSummary.completed}/${interactionSummary.total}</strong></button>
        <button class="completion-summary ${adminCompletionTrack === 'health' ? 'active' : ''}" data-track="health"><span>食光有约</span><strong>${healthSummary.completed}/${healthSummary.total}</strong></button>
      </div>
      <div class="row completion-list-heading"><strong>${adminCompletionTrack === 'interaction' ? '廿载同心' : adminCompletionTrack === 'health' ? '食光有约' : '全部赛道'}用户</strong><span class="right muted">共 ${userResult.total} 人</span></div>
      <form id="adminUserSearch" class="user-list-toolbar">
        <input name="query" value="${escapeHtml(adminUserQuery)}" placeholder="搜索姓名或学号" aria-label="搜索姓名或学号">
        <button>搜索</button>
      </form>
      <div class="user-filter-tabs" role="group" aria-label="完成状态筛选">
        ${[['all','全部用户'],['completed','已完成'],['missing','未完成']].map(([value,label]) =>
          `<button class="secondary user-filter ${adminUserFilter === value ? 'active' : ''}" data-filter="${value}">${label}</button>`).join('')}
      </div>
      <div class="admin-user-grid">${userTiles || '<p class="muted">没有符合条件的用户</p>'}</div>
      <div class="user-pagination">
        <button class="secondary" id="adminUserPrev" ${userResult.page <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${userResult.page} / ${Math.max(1, Math.ceil(userResult.total / userResult.limit))} 页</span>
        <button class="secondary" id="adminUserNext" ${userResult.page * userResult.limit >= userResult.total ? 'disabled' : ''}>下一页</button>
      </div>
    </section>
    <section class="card">
      <div class="row"><h2>活动任务管理</h2><span class="right muted">所有时间由服务端校验</span></div>
      <form id="switches" class="inline-form">
        <label><input type="checkbox" name="activityEnabled" ${config.activityEnabled ? 'checked' : ''}> 活动总开关</label>
        <label><input type="checkbox" name="interaction" ${config.trackEnabled?.interaction ? 'checked' : ''}> 四校区赛道</label>
        <label><input type="checkbox" name="health" ${config.trackEnabled?.health ? 'checked' : ''}> 自律赛道</label>
        <button>保存开关</button>
      </form>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>赛道</th><th>状态</th><th>时间</th><th>提交数</th><th>操作</th></tr></thead><tbody>${taskRows || '<tr><td colspan="6">尚无任务</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <h2>任务材料审核</h2>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>提交主体</th><th>状态</th><th>图片</th><th>文案</th><th>审核</th></tr></thead><tbody>${submissionRows || '<tr><td colspan="6">尚无材料</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><h2>活动广场管理</h2><span class="right muted">帖子仅由公开任务提交自动生成</span></div>
      <div class="table-wrap"><table><thead><tr><th>队伍</th><th>任务</th><th>成员</th><th>状态</th><th>浏览</th><th>点赞</th><th>操作</th></tr></thead><tbody>${plazaRows || '<tr><td colspan="7">暂无广场帖子</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><h2>最终截图证明</h2><span class="right muted">最多 8 张 · 压缩后单张不超过 5MB</span></div>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>方式</th><th>截止时间</th><th>图片类型</th><th>已提交</th><th>各校区进度</th><th>操作</th></tr></thead><tbody>${materialTaskRows || '<tr><td colspan="7">暂无截图任务</td></tr>'}</tbody></table></div>
      <h3>材料提交记录</h3>
      <div class="row"><label>校区筛选 <select id="materialCampus"><option value="">全部校区</option>${(materialAdmin.campuses || []).map((campus) => `<option value="${escapeHtml(campus)}" ${campus === materialAdminCampus ? 'selected' : ''}>${escapeHtml(campus)}</option>`).join('')}</select></label><span class="right">第 ${materialAdmin.pagination?.page || 1}/${materialAdmin.pagination?.pages || 1} 页，共 ${materialAdmin.pagination?.total || 0} 人</span><button class="secondary" id="materialPrev" ${materialAdminPage <= 1 ? 'disabled' : ''}>上一页</button><button class="secondary" id="materialNext" ${materialAdminPage >= (materialAdmin.pagination?.pages || 1) ? 'disabled' : ''}>下一页</button></div>
      <div class="table-wrap"><table><thead><tr><th>任务</th><th>校区</th><th>学生</th><th>状态</th><th>截图</th><th>总结</th><th>管理</th></tr></thead><tbody>${materialSubmissionRows || '<tr><td colspan="7">暂无截图提交</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><div><h2>Excel 数据导出</h2><p class="muted">学号按文本格式导出，不会变成科学计数法。</p></div><label class="right">缺卡日期 <input id="exportDate" type="date" value="${date}"></label><label>排行榜月份 <input id="exportMonth" type="month" value="${date.slice(0, 7)}"></label></div>
      <div class="export-buttons">${[['users','用户名单'],['teams','队伍名单'],['checkins','打卡记录'],['missing','缺卡名单'],['rankings','排行榜'],['materials','材料清单']].map(([type,label]) => `<button class="secondary export-data" data-type="${type}">${label}</button>`).join('')}</div>
    </section>
    <section class="card">
      <div class="row">
        <div><h2>互动赛道队伍</h2><p class="muted">已创建 ${teamResult.teamCount}/${teamResult.maxTeams} 个队伍</p></div>
        <form id="teamCapacity" class="inline-form right">
          <button type="button" class="secondary" id="decreaseCapacity">−</button>
          <input name="maxTeams" type="number" min="${teamResult.teamCount}" max="500" value="${teamResult.maxTeams}" aria-label="最大队伍数量">
          <button type="button" class="secondary" id="increaseCapacity">＋</button>
          <button>保存名额</button>
        </form>
      </div>
      <div class="table-wrap"><table><thead><tr><th>队伍</th><th>人数</th><th>成员</th><th>操作</th></tr></thead><tbody>${teamRows || '<tr><td colspan="4">尚未创建队伍</td></tr>'}</tbody></table></div>
    </section>
    <section class="grid admin-tools">
      <div class="card">
        <h2>创建队伍</h2>
        <form id="createTeam">
          <label>队伍名称</label><input name="name" required>
          <label>人数限制</label><input name="memberLimit" type="number" min="1" max="20" value="4" required>
          <button ${teamResult.teamCount >= teamResult.maxTeams ? 'disabled' : ''}>创建队伍</button>
        </form>
      </div>
      <div class="card">
        <h2>Excel 统一导入队伍</h2>
        <p class="muted">支持每行“队伍名称、成员1学号～成员4学号、队长学号”。队长学号可选，也可导入后在队伍列表中指定。</p>
        <form id="importTeams">
          <input name="file" type="file" accept=".xlsx" required>
          <button>导入并自动编队</button>
        </form>
      </div>
      <div class="card">
        <h2>创建活动任务</h2>
        <p class="muted">先选择任务类型，两种设置流程完全分开。</p>
        <div class="task-type-choices">
          <button id="createSingleTask" class="task-type-card" type="button"><span>单次任务</span><small>指定一次开始和截止时间</small></button>
          <button id="createPeriodicTask" class="task-type-card secondary" type="button"><span>周期任务</span><small>按星期和每日时段自动生成</small></button>
        </div>
      </div>
      <div class="card">
        <h2>创建最终截图证明任务</h2>
        <form id="createMaterialTask">
          <label>标题</label><input name="title" required>
          <label>描述</label><textarea name="description"></textarea>
          <label>截止时间</label><input name="deadline" type="datetime-local" required>
          <label>允许图片类型</label><input name="fileTypes" value="jpg, jpeg, png, webp" readonly required>
          <label>图片数量限制</label><input name="fileLimit" type="number" min="1" max="8" value="8" required>
          <input name="submissionMode" type="hidden" value="individual">
          <label><input name="summaryRequired" type="checkbox"> 需要文字总结</label>
          <button>创建材料任务</button>
        </form>
      </div>
      <div class="card">
        <h2>添加用户</h2>
        <form id="addUser">
          <label>姓名</label><input name="name" required>
          <label>学号</label><input name="studentId" required>
          <label>校区</label><input name="campus" required>
          <label>所属赛道</label><select name="trackId" required>${tracks.map((track) => `<option value="${track.id}">${escapeHtml(track.name)}</option>`).join('')}</select>
          <label>初始密码</label><input name="password" required>
          <label>账号状态</label><select name="status"><option value="active">启用</option><option value="disabled">禁用</option></select>
          <button>创建账号</button>
        </form>
      </div>
      <div class="card">
        <h2>Excel 导入名单</h2>
        <p class="muted">第一行必须包含：姓名、学号、校区、所属赛道、初始密码；可选“账号状态”。仅支持 .xlsx。</p>
        <form id="importUsers">
          <input name="file" type="file" accept=".xlsx" required>
          <button>导入名单</button>
        </form>
      </div>
      <div class="card">
        <h2>打卡时段设置</h2>
        <form id="settings">
          <label>活动名称</label><input name="activityName" value="${escapeHtml(config.activityName)}">
          ${config.slots.map((slot) => `<div class="row"><label class="slot-label">${escapeHtml(slot.label)}</label><input name="${slot.id}Start" type="time" value="${slot.start}"><span>至</span><input name="${slot.id}End" type="time" value="${slot.end}"></div>`).join('')}
          <button>保存设置</button>
        </form>
      </div>
    </section>
    <div id="modalRoot"></div>`;

  enhanceAdminSections();
  prepareDynamicContent(app);
  document.querySelector('#out').onclick = logout;
  document.querySelector('#ranking').onclick = () => rankings();
  document.querySelector('#plaza').onclick = () => plaza();
  document.querySelector('#commentAdmin').onclick = () => adminComments();
  document.querySelector('#changeAdminPassword').onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    if (values.newPassword !== values.confirmPassword) {
      alert('两次输入的新密码不一致');
      return;
    }
    try {
      await api('/api/admin/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword
        })
      });
      event.target.reset();
      alert('管理员密码已修改');
    } catch (error) { alert(error.message); }
  };
  if (document.querySelector('#createAdmin')) {
    document.querySelector('#createAdmin').onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      try {
        await api('/api/admin/admins', { method: 'POST', body: JSON.stringify(values) });
        alert('管理员账号已创建');
        admin(date);
      } catch (error) { alert(error.message); }
    };
  }
  document.querySelectorAll('.reject-admin-action').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm('是否驳回该管理员操作？', '补卡记录将被撤销；审核结果将恢复为待审核状态。')) return;
      try {
        await api(`/api/admin/governance/${button.dataset.id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ note: '最高管理员驳回' })
        });
        alert('该管理员操作已驳回');
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelector('#reload').onclick = () =>
    admin(document.querySelector('#date').value);
  document.querySelectorAll('.completion-summary').forEach((button) => {
    button.onclick = () => {
      adminCompletionTrack = button.dataset.track;
      adminUserPage = 1;
      sessionStorage.adminCompletionTrack = adminCompletionTrack;
      sessionStorage.adminUserPage = '1';
      admin(date);
    };
  });
  document.querySelector('#adminUserSearch').onsubmit = (event) => {
    event.preventDefault();
    adminUserQuery = new FormData(event.target).get('query').trim();
    adminUserPage = 1;
    sessionStorage.adminUserQuery = adminUserQuery;
    sessionStorage.adminUserPage = '1';
    admin(date);
  };
  document.querySelectorAll('.user-filter').forEach((button) => {
    button.onclick = () => {
      adminUserFilter = button.dataset.filter;
      adminUserPage = 1;
      sessionStorage.adminUserFilter = adminUserFilter;
      sessionStorage.adminUserPage = '1';
      admin(date);
    };
  });
  document.querySelector('#adminUserPrev').onclick = () => {
    adminUserPage = Math.max(1, adminUserPage - 1);
    sessionStorage.adminUserPage = String(adminUserPage);
    admin(date);
  };
  document.querySelector('#adminUserNext').onclick = () => {
    adminUserPage += 1;
    sessionStorage.adminUserPage = String(adminUserPage);
    admin(date);
  };
  document.querySelectorAll('.admin-user-tile').forEach((button) => {
    button.onclick = () => openAdminUserDrawer(
      users.find((item) => item.id === button.dataset.id),
      teamResult.teams,
      date,
      taskAdminResult.tasks
    );
  });
  document.querySelector('#materialCampus').onchange = (event) => {
    materialAdminCampus = event.target.value;
    materialAdminPage = 1;
    admin(date);
  };
  document.querySelector('#materialPrev').onclick = () => { materialAdminPage = Math.max(1, materialAdminPage - 1); admin(date); };
  document.querySelector('#materialNext').onclick = () => { materialAdminPage += 1; admin(date); };
  const capacityForm = document.querySelector('#teamCapacity');
  const capacityInput = capacityForm.maxTeams;
  document.querySelector('#decreaseCapacity').onclick = () => {
    capacityInput.value = Math.max(teamResult.teamCount, Number(capacityInput.value) - 1);
  };
  document.querySelector('#increaseCapacity').onclick = () => {
    capacityInput.value = Math.min(500, Number(capacityInput.value) + 1);
  };
  capacityForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/team-capacity', {
        method: 'PATCH',
        body: JSON.stringify({ maxTeams: Number(capacityInput.value) })
      });
      alert('队伍名额已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#createTeam').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/teams', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('队伍创建成功');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#importTeams').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const encoded = await readRawFile(event.target.file.files[0]);
      const result = await api('/api/admin/teams/import', { method: 'POST', body: JSON.stringify({ file: encoded }) });
      alert(`成功导入 ${result.importedTeams} 个队伍、${result.importedMembers} 名成员`);
      admin(date);
    } catch (error) { alert(error.message); }
  };
  document.querySelector('#addUser').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('账号创建成功');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#importUsers').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const file = event.target.file.files[0];
      const encoded = await readRawFile(file);
      const result = await api('/api/admin/users/import', {
        method: 'POST',
        body: JSON.stringify({ file: encoded })
      });
      alert(`成功导入 ${result.imported} 个用户`);
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#settings').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const slots = config.slots.map((slot) => ({
      ...slot,
      start: form.get(`${slot.id}Start`),
      end: form.get(`${slot.id}End`)
    }));
    try {
      await api('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ activityName: form.get('activityName'), slots })
      });
      alert('设置已保存');
      home();
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelectorAll('.edit-user').forEach((button) => {
    button.onclick = () => editUser(users.find((item) => item.id === button.dataset.id), date);
  });
  document.querySelectorAll('.edit-team').forEach((button) => {
    button.onclick = () =>
      editTeam(teamResult.teams.find((team) => team.id === button.dataset.id), date);
  });
  document.querySelectorAll('.remove-member').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm(
        '是否将该成员踢出队伍？',
        '踢出后，该成员将退出当前队伍。',
        { cancelText: '取消踢出队伍', confirmText: '确定踢出队伍' }
      )) return;
      try {
        await api(`/api/admin/teams/${button.dataset.team}/members/${button.dataset.user}`, {
          method: 'DELETE'
        });
        admin(date);
      } catch (error) {
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.add-team-member').forEach((button) => {
    button.onclick = async () => {
      const studentId = await askText('加入队伍成员', '请输入要加入该队伍的学生学号。', '学生学号');
      if (!studentId) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/members`, { method: 'POST', body: JSON.stringify({ studentId }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.set-captain').forEach((button) => {
    button.onclick = async () => {
      const studentId = await askText('指定队长', '该学生必须已经在当前队伍中。', '队长学号');
      if (!studentId) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: JSON.stringify({ studentId }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.clear-captain').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm('是否取消队长？', '取消后，该队伍将暂时没有队长。')) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: '{}' });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.dissolve-team').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm(
        '是否解散该队伍？',
        '确认后将解除全部成员关系并解散队伍，此操作不可恢复。',
        { cancelText: '取消解散', confirmText: '确定解散' }
      )) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}`, { method: 'DELETE' });
        await admin(date);
        alert('队伍已解散');
      } catch (error) {
        alert(`解散失败：${error.message}`);
      }
    };
  });
  document.querySelectorAll('.toggle-user').forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.status === 'disabled' ? '禁用' : '启用';
      if (!await askConfirm(`是否${action}该用户？`, `${action}后将立即影响该账号的登录状态。`)) return;
      try {
        await api(`/api/admin/users/${button.dataset.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: button.dataset.status })
        });
        admin(date);
      } catch (error) {
        alert(error.message);
      }
    };
  });
  document.querySelector('#switches').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    await api('/api/admin/activity-switches', { method: 'PATCH', body: JSON.stringify({ activityEnabled: form.activityEnabled.checked, trackEnabled: { interaction: form.interaction.checked, health: form.health.checked } }) });
    home();
  };
  document.querySelector('#createSingleTask').onclick = () => openTaskCreator('single', date);
  document.querySelector('#createPeriodicTask').onclick = () => openTaskCreator('periodic', date);
  document.querySelector('#createMaterialTask').onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    try {
      await api('/api/admin/material-tasks', { method: 'POST', body: JSON.stringify({ ...values, fileLimit: Number(values.fileLimit), summaryRequired: event.target.summaryRequired.checked }) });
      alert('材料任务创建成功');
      admin(date);
    } catch (error) { alert(error.message); }
  };
  document.querySelectorAll('.edit-task').forEach((button) => {
    button.onclick = () => editTask(taskAdminResult.tasks.find((task) => task.id === button.dataset.id), date);
  });
  document.querySelectorAll('.approve-submission,.return-submission').forEach((button) => {
    button.onclick = async () => {
      const returning = button.classList.contains('return-submission');
      const reviewNote = returning ? await askText('退回任务提交', '请填写退回原因。', '退回原因') : '';
      if (returning && !reviewNote) return;
      try {
        await api(`/api/admin/submissions/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: returning ? 'returned' : 'approved', reviewNote }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.delete-submission').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm('是否删除该提交？', '关联的广场帖子也会删除，此操作不可恢复。')) return;
      await api(`/api/admin/submissions/${button.dataset.id}`, { method: 'DELETE' });
      admin(date);
    };
  });
  document.querySelectorAll('.toggle-post').forEach((button) => {
    button.onclick = async (event) => {
      const restoreButton = beginButtonLoading(event.currentTarget, '处理中…');
      try {
        await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
        plazaViewCache.clear();
        rankingViewCache.clear();
        admin(date);
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.delete-post').forEach((button) => {
    button.onclick = async (event) => {
      if (!await askConfirm('是否永久删除该广场帖子？', '任务提交记录不会删除，此操作不可恢复。')) return;
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
        await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'DELETE' });
        plazaViewCache.clear();
        rankingViewCache.clear();
        admin(date);
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.exclude-post').forEach((button) => {
    button.onclick = async (event) => {
      const restoreButton = beginButtonLoading(event.currentTarget, '处理中…');
      try {
        await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ excludedFromRanking: button.dataset.excluded === 'true' }) });
        plazaViewCache.clear();
        rankingViewCache.clear();
        admin(date);
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  document.querySelectorAll('.export-data').forEach((button) => {
    button.onclick = async () => {
      const exportDate = document.querySelector('#exportDate').value;
      const exportMonth = document.querySelector('#exportMonth').value;
      try {
        await downloadApiFile(`/api/admin/exports/${button.dataset.type}?date=${exportDate}&month=${exportMonth}`);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.admin-material-download').forEach((button) => {
    button.onclick = () => downloadProtectedFile(button.dataset.url, button.dataset.name).catch((error) => alert(error.message));
  });
  document.querySelectorAll('.return-material').forEach((button) => {
    button.onclick = async () => {
      const reviewNote = await askText('退回最终截图证明', '请填写需要修改的原因。', '退回原因');
      if (!reviewNote) return;
      await api(`/api/admin/material-submissions/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ reviewNote }) });
      admin(date);
    };
  });
  document.querySelectorAll('.missing-material').forEach((button) => {
    button.onclick = () => downloadApiFile(`/api/admin/material-tasks/${button.dataset.id}/missing-export`).catch((error) => alert(error.message));
  });
  requestAnimationFrame(() => window.scrollTo(0, Number(sessionStorage.adminScrollY || 0)));
}

function enhanceAdminSections() {
  const sections = [...document.querySelectorAll('#app > section.card, .admin-tools > .card')];
  sections.forEach((section, index) => {
    if (section.classList.contains('admin-user-section')) return;
    const title = section.querySelector('h2');
    if (!title) return;
    const key = `adminSection:${title.textContent.trim()}`;
    const primary = title.textContent.includes('每日提交');
    const expanded = sessionStorage.getItem(key) === null
      ? primary
      : sessionStorage.getItem(key) === 'open';
    const first = section.firstElementChild;
    const body = document.createElement('div');
    body.className = 'admin-collapsible-body';
    [...section.children].filter((child) => child !== first).forEach((child) => body.append(child));
    section.append(body);
    section.classList.add('admin-collapsible');
    section.classList.toggle('is-open', expanded);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-section-toggle secondary';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.innerHTML = `<span>${expanded ? '收起' : '展开'}</span><b aria-hidden="true">⌄</b>`;
    first.classList.add('admin-collapsible-heading');
    first.append(toggle);
    toggle.onclick = () => {
      const open = section.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('span').textContent = open ? '收起' : '展开';
      sessionStorage.setItem(key, open ? 'open' : 'closed');
    };
  });
}

function openAdminUserDrawer(studentUser, teams, date, tasks = []) {
  const root = document.querySelector('#modalRoot');
  const team = teams.find((item) => item.members.some((member) => member.id === studentUser.id));
  const isHealth = studentUser.trackId === 'health';
  const interactionTasks = tasks.filter((task) => task.trackId === 'interaction');
  const sectionState = new Map();
  root.innerHTML = `<div class="drawer-backdrop" id="userDrawerBackdrop">
    <section class="bottom-drawer" role="dialog" aria-modal="true" aria-labelledby="userDrawerTitle">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">用户详情</small><h2 id="userDrawerTitle">${escapeHtml(studentUser.name)}</h2></div>
        <button class="secondary right" id="closeUserDrawer">关闭</button>
      </div>
      <div class="drawer-summary">
        <div><span>学号</span><strong>${escapeHtml(studentUser.studentId)}</strong></div>
        <div><span>账号状态</span><strong>${studentUser.status === 'active' ? '启用' : '禁用'}</strong></div>
        <div><span>所属赛道</span><strong>${escapeHtml(trackName(studentUser.trackId))}</strong></div>
        <div><span>最近状态</span><strong>${studentUser.completed ? '已完成' : '未完成'}</strong></div>
      </div>
      <div class="drawer-accordions">
        ${[
          ['records', '最近打卡记录', studentUser.submittedAt ? formatDate(studentUser.submittedAt) : '暂无提交', true],
          ['profile', '基本资料', `${studentUser.campus || '未设置'} · 累计 ${Number(studentUser.totalCompletedDays || 0)} 天`, false],
          ['team', '所属队伍', team?.name || '未加入队伍', false],
          ['makeup', '补卡权限', '点击查看当前状态', false],
          ['adminMakeup', '管理员代为补卡', '按需展开', false],
          ['manage', '管理操作', '编辑或禁用账号', false]
        ].map(([key, label, summary, open]) => `
          <section class="drawer-accordion ${open ? 'is-open' : ''}" data-drawer-section="${key}">
            <button class="drawer-accordion-toggle" type="button" aria-expanded="${open}">
              <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(summary)}</small></span><b aria-hidden="true">›</b>
            </button>
            <div class="drawer-accordion-panel" ${open ? '' : 'hidden'}><div class="drawer-panel-inner" data-panel-content="${key}"></div></div>
          </section>`).join('')}
      </div>
    </section>
  </div>`;

  const backdrop = root.querySelector('#userDrawerBackdrop');
  const drawer = root.querySelector('.bottom-drawer');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeUserDrawer').onclick = close;
  backdrop.onclick = (event) => { if (event.target === backdrop) close(); };
  let touchStartY = null;
  drawer.addEventListener('touchstart', (event) => {
    if (event.target.closest('.drawer-handle')) touchStartY = event.touches[0].clientY;
  }, { passive: true });
  drawer.addEventListener('touchend', (event) => {
    if (touchStartY !== null && event.changedTouches[0].clientY - touchStartY > 80) close();
    touchStartY = null;
  }, { passive: true });

  const renderImages = (images, label) => images.length
    ? `<div class="drawer-photo-grid compact">${images.map((media, index) => {
      const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl;
      const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
      return `
        <button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
          data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
          data-image-alt="${escapeHtml(label)}">
          <span class="image-shell"><img data-src="${escapeHtml(thumbUrl)}" data-priority="${index === 0 ? 'high' : ''}"
            loading="${index === 0 ? 'eager' : 'lazy'}" fetchpriority="${index === 0 ? 'high' : 'auto'}"
            width="480" height="360" decoding="async" alt="${escapeHtml(label)}"
            onload="this.parentElement.classList.add('loaded')"
            onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败，点击重试</span></span>
        </button>`;
    }).join('')}</div>` : '';

  const loadRecords = async (panel, force = false) => {
    if (sectionState.get('records') && !force) return;
    sectionState.set('records', 'loading');
    panel.innerHTML = '<p class="muted">正在读取最近打卡记录…</p>';
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/checkins?date=${encodeURIComponent(date)}`);
      const bySlot = new Map(result.records.map((item) => [item.slotId, item]));
      const records = isHealth ? config.slots.map((slot) => {
        const record = bySlot.get(slot.id);
        return record ? { ...record, taskName: slot.label } : null;
      }).filter(Boolean) : result.records;
      panel.innerHTML = records.length ? `<div class="meal-status-grid">${records.map((record) => `
        <article class="meal-status-card completed">
          <div class="row"><strong>${escapeHtml(record.taskName || record.slotId || '打卡')}</strong><span class="pill done">${escapeHtml(record.status || '已提交')}</span></div>
          <small>${escapeHtml(formatDate(record.submittedAt))}</small>
          ${renderImages(record.images || [], `${record.taskName || record.slotId || '打卡'}图片`)}
          ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ''}
        </article>`).join('')}</div>` : '<p class="muted">当日暂无提交</p>';
      prepareDynamicContent(panel);
      const firstImageMedia = result.records.flatMap((item) => item.images || [])[0];
      const firstImage = typeof firstImageMedia === 'string'
        ? firstImageMedia
        : firstImageMedia?.displayUrl || firstImageMedia?.thumbUrl;
      if (firstImage) {
        const preload = new Image();
        preload.decoding = 'async';
        preload.fetchPriority = 'low';
        preload.src = firstImage;
      }
      sectionState.set('records', 'loaded');
    } catch (error) {
      panel.innerHTML = `<button class="secondary retry-drawer-records">读取失败，点击重试</button>`;
      panel.querySelector('.retry-drawer-records').onclick = () => loadRecords(panel, true);
      sectionState.delete('records');
    }
  };

  const loadSection = async (key, panel) => {
    if (key === 'records') return loadRecords(panel);
    if (sectionState.get(key)) return;
    sectionState.set(key, 'loaded');
    if (key === 'profile') {
      panel.innerHTML = `<dl class="user-detail-list">
        <div><dt>姓名</dt><dd>${escapeHtml(studentUser.name)}</dd></div>
        <div><dt>学号</dt><dd>${escapeHtml(studentUser.studentId)}</dd></div>
        <div><dt>校区</dt><dd>${escapeHtml(studentUser.campus || '未设置')}</dd></div>
        <div><dt>创建时间</dt><dd>${escapeHtml(formatDate(studentUser.createdAt))}</dd></div>
        <div><dt>累计完成</dt><dd>${Number(studentUser.totalCompletedDays || 0)} 天</dd></div>
      </dl>`;
    } else if (key === 'team') {
      panel.innerHTML = team
        ? `<p><strong>${escapeHtml(team.name)}</strong></p><p class="muted">${team.memberCount}/${team.memberLimit} 人</p>`
        : '<p class="muted">该用户尚未加入队伍</p>';
    } else if (key === 'makeup') {
      panel.innerHTML = '<p class="muted">正在读取补卡权限…</p>';
      try {
        const permission = await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup-permission?date=${encodeURIComponent(date)}`);
        let enabled = Boolean(permission.enabled);
        panel.innerHTML = `<div class="row"><p class="muted">仅对 ${escapeHtml(date)} 生效；默认关闭。</p>
          <button class="${enabled ? 'danger' : 'secondary'} right" id="toggleMakeupPermission">${enabled ? '关闭用户补卡' : '允许用户补卡'}</button></div>`;
        panel.querySelector('#toggleMakeupPermission').onclick = async (event) => {
          event.currentTarget.disabled = true;
          try {
            await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup-permission?date=${encodeURIComponent(date)}`, {
              method: 'PUT', body: JSON.stringify({ enabled: !enabled })
            });
            enabled = !enabled;
            event.currentTarget.textContent = enabled ? '关闭用户补卡' : '允许用户补卡';
            event.currentTarget.className = enabled ? 'danger right' : 'secondary right';
          } catch (error) { alert(error.message); }
          finally { event.currentTarget.disabled = false; }
        };
      } catch (error) {
        panel.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
      }
    } else if (key === 'adminMakeup') {
      panel.innerHTML = `<form id="adminMakeupForm">
        ${isHealth
          ? `<label>餐次</label><select name="slotId">${config.slots.map((slot) => `<option value="${slot.id}">${escapeHtml(slot.label)}</option>`).join('')}</select>`
          : `<label>活动任务</label><select name="taskId" required>${interactionTasks.map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`).join('')}</select>`}
        <label>补卡图片</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" required>
        ${isHealth ? '<label>备注（可选）</label><textarea name="note"></textarea>' : ''}
        <button>确认管理员补卡</button>
      </form>`;
      panel.querySelector('#adminMakeupForm').onsubmit = async (event) => {
        event.preventDefault();
        const form = event.target;
        const submit = form.querySelector('button');
        submit.disabled = true;
        try {
          const photos = await readFiles(form.photos.files, {
            taskId: isHealth ? null : form.taskId.value,
            businessType: 'admin-makeup',
            limit: isHealth ? 3 : 1
          });
          await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup`, {
            method: 'POST',
            body: JSON.stringify(isHealth
              ? { date, slotId: form.slotId.value, mediaIds: photos.map((item) => item.mediaId), note: form.note.value }
              : { date, taskId: form.taskId.value, mediaIds: photos.map((item) => item.mediaId) })
          });
          const recordsPanel = root.querySelector('[data-panel-content="records"]');
          sectionState.delete('records');
          await loadRecords(recordsPanel, true);
          alert('补卡已完成');
        } catch (error) { alert(error.message); }
        finally { submit.disabled = false; }
      };
    } else if (key === 'manage') {
      panel.innerHTML = `<div class="drawer-actions">
        <button class="secondary" id="editDrawerUser">编辑用户</button>
        <button class="${studentUser.status === 'active' ? 'danger' : 'secondary'}" id="toggleDrawerUser">${studentUser.status === 'active' ? '禁用用户' : '启用用户'}</button>
      </div>`;
      panel.querySelector('#editDrawerUser').onclick = () => editUser(studentUser, date);
      panel.querySelector('#toggleDrawerUser').onclick = async (event) => {
        const next = studentUser.status === 'active' ? 'disabled' : 'active';
        const action = next === 'disabled' ? '禁用' : '启用';
        if (!await askConfirm(`是否${action}该用户？`, `${action}后将立即影响该账号的登录状态。`)) return;
        event.currentTarget.disabled = true;
        try {
          await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: next })
          });
          studentUser.status = next;
          event.currentTarget.textContent = next === 'active' ? '禁用用户' : '启用用户';
          event.currentTarget.className = next === 'active' ? 'danger' : 'secondary';
        } catch (error) { alert(error.message); }
        finally { event.currentTarget.disabled = false; }
      };
    }
  };

  root.querySelectorAll('.drawer-accordion-toggle').forEach((toggle) => {
    toggle.onclick = () => {
      const section = toggle.closest('.drawer-accordion');
      const key = section.dataset.drawerSection;
      const shouldOpen = !section.classList.contains('is-open');
      root.querySelectorAll('.drawer-accordion').forEach((item) => {
        item.classList.remove('is-open');
        item.querySelector('.drawer-accordion-toggle').setAttribute('aria-expanded', 'false');
        item.querySelector('.drawer-accordion-panel').hidden = true;
      });
      if (!shouldOpen) return;
      section.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      const panel = section.querySelector('.drawer-accordion-panel');
      panel.hidden = false;
      void loadSection(key, panel.querySelector('.drawer-panel-inner'));
    };
  });
  const initialRecords = root.querySelector('[data-panel-content="records"]');
  void loadRecords(initialRecords);
}

function taskFormFields(task = {}, requestedType = '') {
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const nextWeek = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const type = requestedType || (task.scheduleType === 'oneTime' ? 'single' : 'periodic');
  const formId = task.id ? 'editTask' : 'createTask';
  const commonStart = `<form id="${formId}" data-task-type="${type}">
    <input type="hidden" name="scheduleType" value="${type === 'single' ? 'oneTime' : 'weekly'}">
    <label>${type === 'single' ? '任务名称' : '任务模板名称'}</label><input name="name" value="${escapeHtml(task.name || '')}" required>
    <label>描述</label><textarea name="description">${escapeHtml(task.description || '')}</textarea>
    <label>所属赛道</label><select name="trackId">${tracks.map((track) => `<option value="${track.id}" ${track.id === task.trackId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select>`;
  const scheduleFields = type === 'single'
    ? `<label>开始日期和时间</label><input name="startAt" type="datetime-local" value="${escapeHtml((task.startAt || '').slice(0, 16))}" required>
       <label>截止日期和时间</label><input name="endAt" type="datetime-local" value="${escapeHtml((task.endAt || '').slice(0, 16))}" required>`
    : `<label>周期开始日期</label><input name="activeStartDate" type="date" value="${escapeHtml(task.activeStartDate || todayKey)}" required>
       <label>周期结束日期</label><input name="activeEndDate" type="date" value="${escapeHtml(task.activeEndDate || nextWeek)}" required>
       <fieldset class="weekday-picker"><legend>周一至周日多选</legend>${['一','二','三','四','五','六','日'].map((label, index) =>
         `<label><input type="checkbox" name="weekdays" value="${index + 1}" ${(task.weekdays || [1,3,5]).includes(index + 1) ? 'checked' : ''}><span>周${label}</span></label>`).join('')}</fieldset>
       <label>每日开放时间</label><input name="dailyStart" type="time" value="${task.dailyStart || '00:00'}" required>
       <label>每日截止时间</label><input name="dailyEnd" type="time" value="${task.dailyEnd || '23:59'}" required>`;
  return `${commonStart}${scheduleFields}
    <label>图片数量限制</label><input name="imageLimit" type="number" min="1" max="3" value="${Math.min(task.imageLimit || 3, 3)}" required>
    <label>文案要求</label><textarea name="copyRequirement">${escapeHtml(task.copyRequirement || '')}</textarea>
    ${task.id ? `<label>任务状态</label><select name="status">${[['draft','草稿'],['published','发布'],['closed','关闭'],['archived','归档']].map(([value,label]) => `<option value="${value}" ${task.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` : '<input type="hidden" name="status" value="published">'}
    <button>${task.id ? '保存修改' : type === 'single' ? '发布任务' : '保存周期任务'}</button>
  </form>`;
}

function taskPayload(form) {
  const values = Object.fromEntries(new FormData(form));
  const weekdays = [...form.querySelectorAll('input[name="weekdays"]:checked')].map((input) => Number(input.value));
  if (form.dataset.taskType === 'periodic' && !weekdays.length) throw new Error('周期任务至少选择一个星期');
  if (form.dataset.taskType === 'periodic' && values.dailyStart >= values.dailyEnd) {
    throw new Error('每日截止时间必须晚于每日开放时间');
  }
  return {
    ...values,
    allowLate: false,
    imageLimit: Number(values.imageLimit),
    weekdays,
    refreshDays: [],
    activeStartDate: values.activeStartDate || '',
    activeEndDate: values.activeEndDate || '',
    dailyStart: values.dailyStart || '',
    dailyEnd: values.dailyEnd || '',
    startAt: values.startAt || '',
    endAt: values.endAt || ''
  };
}

function openTaskCreator(type, date) {
  const root = document.querySelector('#modalRoot');
  const title = type === 'single' ? '创建单次任务' : '创建周期任务';
  root.innerHTML = `<div class="modal-backdrop task-page-backdrop"><section class="card modal task-editor">
    <div class="row"><div><small class="muted">活动任务</small><h2>${title}</h2></div><button id="closeTask" class="secondary right">关闭</button></div>
    ${taskFormFields({}, type)}
  </section></div>`;
  document.querySelector('#closeTask').onclick = () => { root.innerHTML = ''; };
  document.querySelector('#createTask').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify(taskPayload(event.target)) });
      root.innerHTML = '';
      await admin(date);
      alert(type === 'single' ? '单次任务已发布' : '周期任务已保存');
    } catch (error) { alert(error.message); }
  };
}

function editTask(task, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><section class="card modal"><div class="row"><h2>编辑任务</h2><button id="closeTask" class="secondary right">关闭</button></div>${taskFormFields(task)}</section></div>`;
  document.querySelector('#closeTask').onclick = () => { root.innerHTML = ''; };
  document.querySelector('#editTask').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(taskPayload(event.target)) });
      admin(date);
    } catch (error) { alert(error.message); }
  };
}

function editTeam(team, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>修改队伍</h2><button class="secondary right" id="closeTeamModal">关闭</button></div>
        <form id="editTeam">
          <label>队伍名称</label><input name="name" value="${escapeHtml(team.name)}" required>
          <label>人数限制</label><input name="memberLimit" type="number" min="${team.memberCount}" max="20" value="${team.memberLimit}" required>
          <p class="muted">当前 ${team.memberCount} 名成员，人数限制不能低于当前成员数。</p>
          <button>保存修改</button>
        </form>
      </section>
    </div>`;
  document.querySelector('#closeTeamModal').onclick = () => {
    root.innerHTML = '';
  };
  document.querySelector('#editTeam').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/teams/${team.id}`, {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('队伍已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
}

function editUser(studentUser, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>编辑用户</h2><button class="secondary right" id="closeModal">关闭</button></div>
        <form id="editUser">
          <label>姓名</label><input name="name" value="${escapeHtml(studentUser.name)}" required>
          <label>学号</label><input name="studentId" value="${escapeHtml(studentUser.studentId)}" required>
          <label>校区</label><input name="campus" value="${escapeHtml(studentUser.campus)}" required>
          <label>所属赛道</label><select name="trackId">${tracks.map((track) => `<option value="${track.id}" ${track.id === studentUser.trackId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select>
          <label>账号状态</label><select name="status"><option value="active" ${studentUser.status === 'active' ? 'selected' : ''}>启用</option><option value="disabled" ${studentUser.status === 'disabled' ? 'selected' : ''}>禁用</option></select>
          <label>新密码（不修改请留空）</label><input name="password" type="password">
          <button>保存修改</button>
        </form>
      </section>
    </div>`;
  document.querySelector('#closeModal').onclick = () => {
    root.innerHTML = '';
  };
  document.querySelector('#editUser').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/users/${studentUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('用户资料已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
}

function reviewCheckin(students, checkinId, date) {
  let checkin;
  for (const studentUser of students) {
    checkin = studentUser.slots.find((item) => item && item.id === checkinId);
    if (checkin) break;
  }
  const root = document.querySelector('#modalRoot');
  const reviewImage = (media, index, alt) => {
    const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl;
    const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
    return `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
      data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
      data-image-alt="${escapeHtml(alt)}"><span class="image-shell">
      <img data-src="${escapeHtml(thumbUrl)}" loading="${index === 0 ? 'eager' : 'lazy'}"
        data-priority="${index === 0 ? 'high' : ''}" fetchpriority="${index === 0 ? 'high' : 'low'}"
        decoding="async" width="480" height="360" alt="${escapeHtml(alt)}"
        onload="this.parentElement.classList.add('loaded')"
        onerror="this.hidden=true;this.parentElement.classList.add('failed')">
      <span class="image-error">图片加载失败</span></span></button>`;
  };
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>审核材料</h2><button class="secondary right" id="closeReview">关闭</button></div>
    <div class="photos">${checkin.photos.map((photo, index) => reviewImage(photo, index, '打卡截图')).join('')}${checkin.summary ? reviewImage(checkin.summary, checkin.photos.length, '汇总截图') : ''}</div>
        <p>${escapeHtml(checkin.note || '无备注')}</p>
        <button id="approve">通过</button> <button class="danger" id="reject">驳回</button>
      </section>
    </div>`;
  prepareDynamicContent(root);
  document.querySelector('#closeReview').onclick = () => {
    root.innerHTML = '';
  };
  const update = async (status) => {
    try {
      await api(`/api/admin/checkins/${checkinId}`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#approve').onclick = () => update('approved');
  document.querySelector('#reject').onclick = () => update('rejected');
}

window.__ADMIN_CLIENT_RENDER__ = (selectedDate, pageEpoch) => admin(selectedDate, pageEpoch);
