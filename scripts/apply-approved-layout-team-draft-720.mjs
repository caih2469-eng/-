import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_LAYOUT_TEAM_DRAFT_720_V1 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    let next = source;

    next = replaceOnce(next, 'const MEDIA_THUMB_MAX_EDGE = 640;', 'const MEDIA_THUMB_MAX_EDGE = 720;', '720px前端缩略图尺寸');
    next = next.replace('const MEDIA_THUMB_MAX_SIZE_MB = 0.22;', 'const MEDIA_THUMB_MAX_SIZE_MB = 0.28;');
    next = next.replace('const MEDIA_THUMB_QUALITY = 0.82;', 'const MEDIA_THUMB_QUALITY = 0.84;');
    next = next.replace(/(data-perf-image="(?:history-thumb|plaza-thumb|plaza-detail-thumb|admin-checkin-thumb)"[\s\S]{0,260}?)width="640" height="480"/g, '$1width="720" height="540"');

    next = replaceOnce(
      next,
      '      <button id="historyCheckins"><span>✓</span><strong>历史打卡</strong><small>查看记录</small></button>',
      '      <button id="historyCheckins"><span>✓</span><strong>个人累计</strong><small>${Number(checkinStats.personalDays || 0)}天 · 查看</small></button>',
      '个人累计入口'
    );
    next = replaceOnce(
      next,
      '      <button id="teamCheckinStats"><span>◇</span><strong>队伍累计</strong><small>${dashboard.teamSummary?.team ? `${Number(checkinStats.teamDays || 0)}天` : \'未加入\'}</small></button>',
      '      <button id="teamCheckinStats"><span>◇</span><strong>队伍累计</strong><small>${dashboard.teamSummary?.team ? `${Number(checkinStats.teamDays || 0)}天 · 查看` : \'未加入\'}</small></button>',
      '队伍累计入口'
    );

    next = replaceOnce(
      next,
      [
        "  document.querySelector('#teamCheckinStats').onclick = () => void openDialog({",
        "    title: '队伍累计打卡',",
        "    message: dashboard.teamSummary?.team",
        "      ? `${dashboard.teamSummary.team.name} 已累计完成 ${Number(checkinStats.teamDays || 0)} 天队伍汇总提交。`",
        "      : '当前尚未加入队伍。',",
        "    notice: true,",
        "    confirmText: '知道了'",
        "  });"
      ].join('\n'),
      "  document.querySelector('#teamCheckinStats').onclick = () => void openTeamCheckinHistory();",
      '队伍累计历史入口事件'
    );

    next = replaceOnce(next, '<h2 id="historyDrawerTitle">历史打卡</h2>', '<h2 id="historyDrawerTitle">个人累计打卡</h2>', '个人累计抽屉标题');
    next = replaceOnce(next, "<p class=\"muted\">正在读取历史打卡…</p>", "<p class=\"muted\">正在读取个人打卡记录…</p>", '个人历史加载文字');

    const teamHistoryFunction = String.raw`
function openTeamCheckinHistory() {
  const root = document.querySelector('#modalRoot');
  if (!root) return;
  let page = 1;
  let loading = false;
  root.innerHTML = `<div class="drawer-backdrop" id="teamHistoryDrawerBackdrop">
    <section class="bottom-drawer history-drawer" role="dialog" aria-modal="true" aria-labelledby="teamHistoryDrawerTitle">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">队伍记录</small><h2 id="teamHistoryDrawerTitle">队伍累计打卡</h2></div>
        <button class="secondary right" id="closeTeamHistoryDrawer">关闭</button>
      </div>
      <div id="teamHistoryList"><p class="muted">正在读取队伍打卡记录…</p></div>
      <button class="secondary full-width" id="moreTeamHistory" hidden>加载更多</button>
    </section>
  </div>`;
  const list = root.querySelector('#teamHistoryList');
  const more = root.querySelector('#moreTeamHistory');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeTeamHistoryDrawer').onclick = close;
  root.querySelector('#teamHistoryDrawerBackdrop').onclick = (event) => {
    if (event.target.id === 'teamHistoryDrawerBackdrop') close();
  };

  const renderRecord = (record) => {
    const images = (record.images || []).map((media, index) => {
      const thumbUrl = media.thumbUrl || media.imageUrl || media.displayUrl || '';
      const displayUrl = media.displayUrl || thumbUrl;
      return `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
        data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
        data-image-alt="${escapeHtml(record.taskName || '队伍打卡')}图片">
        <span class="image-shell"><img data-perf-image="history-thumb" data-priority="${index ? 'low' : 'high'}"
          data-src="${escapeHtml(thumbUrl)}" loading="${index ? 'lazy' : 'eager'}" width="720" height="540"
          fetchpriority="${index ? 'low' : 'high'}" decoding="async" alt="${escapeHtml(record.taskName || '队伍打卡')}图片"
          onload="this.parentElement.classList.add('loaded')"
          onerror="this.hidden=true;this.parentElement.classList.add('failed')">
          <span class="image-error">图片加载失败，点击重试</span></span></button>`;
    }).join('');
    const members = (record.teamProgress?.members || []).map((member) =>
      `<span class="${member.checked ? 'checked-member' : ''}">${escapeHtml(member.name)} ${member.checked ? '✓' : '未完成'}</span>`
    ).join('');
    return `<article class="history-checkin-card">
      <div class="row"><div><strong>${escapeHtml(record.taskName || '队伍打卡')}</strong><small>${escapeHtml(record.date || '')}</small></div>
        <span class="pill done">已提交</span></div>
      <p class="muted">${escapeHtml(formatDate(record.submittedAt))}</p>
      <div class="team-progress compact"><div class="row"><strong>成员完成情况</strong><span class="right">${Number(record.teamProgress?.completed || 0)}/${Number(record.teamProgress?.total || 0)}</span></div>
        <div class="member-list compact">${members || '<span>暂无成员数据</span>'}</div></div>
      ${images ? `<div class="drawer-photo-grid compact">${images}</div>` : ''}
      ${record.copy ? `<p>${escapeHtml(record.copy)}</p>` : ''}
    </article>`;
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const result = await api(`/api/team-checkins/history?page=${page}&limit=20`);
      if (page === 1) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', (result.records || []).map(renderRecord).join(''));
      if (!(result.records || []).length && page === 1) list.innerHTML = '<p class="muted">暂无队伍打卡记录</p>';
      const loaded = Math.min(Number(result.total || 0), page * Number(result.limit || 20));
      prepareDynamicContent(list);
      more.hidden = loaded >= Number(result.total || 0);
      more.textContent = `加载更多（${loaded}/${Number(result.total || 0)}）`;
      page += 1;
    } catch (error) {
      if (page === 1) list.innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
      more.hidden = false;
      more.textContent = '读取失败，点击重试';
    } finally {
      loading = false;
      more.disabled = false;
    }
  };
  more.onclick = load;
  void load();
}

`;
    next = replaceOnce(next, 'function memberCheckinForm(task) {', teamHistoryFunction + 'function memberCheckinForm(task) {', '队伍累计历史函数位置');

    next = replaceOnce(
      next,
      "${task.isCaptain ? `<button class=\"secondary\" data-task=\"${task.id}\" ${task.availabilityError || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑队伍作品' : '队长汇总提交'}</button>` : '<p class=\"muted\">队伍作品由管理员指定的队长汇总提交。</p>'}",
      "${task.isCaptain ? `<button class=\"secondary\" data-task=\"${task.id}\" ${task.availabilityError || Number(task.teamProgress?.total || 0) === 0 || Number(task.teamProgress?.completed || 0) < Number(task.teamProgress?.total || 0) || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑队伍作品' : '队长汇总提交'}</button>${Number(task.teamProgress?.total || 0) > 0 && Number(task.teamProgress?.completed || 0) < Number(task.teamProgress?.total || 0) ? '<p class=\"bad\">所有队员完成当天个人打卡后，队长才能汇总提交。</p>' : ''}` : '<p class=\"muted\">队伍作品由管理员指定的队长汇总提交。</p>'}",
      '队伍全员完成前禁用汇总按钮'
    );

    next = replaceOnce(
      next,
      '<div class="image-preview" id="taskPreview"></div>',
      `<div class="image-preview" id="taskPreview">${(current?.images || []).map((image) => {
        const thumbUrl = image.thumbUrl || image.imageUrl || image.displayUrl || '';
        const displayUrl = image.displayUrl || thumbUrl;
        return \`<button type="button" class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}" data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}" data-image-alt="已保存队伍作品"><span class="image-shell"><img src="${escapeHtml(thumbUrl)}" width="720" height="540" loading="eager" decoding="async" alt="已保存队伍作品"></span></button>\`;
      }).join('')}</div>`,
      '草稿已保存图片回填'
    );
    next = replaceOnce(next, "  const form = document.querySelector('#taskSend');", "  const form = document.querySelector('#taskSend');\n  prepareDynamicContent(app);", '队伍草稿图片交互绑定');

    next = replaceOnce(
      next,
      "      ${user.trackId === 'interaction' ? `<label class=\"check-label\"><input name=\"isPublic\" type=\"checkbox\" ${current?.isPublic ? 'checked' : ''}> 同意发布至活动广场</label>\n      <div id=\"plazaCopyField\" style=\"display:${current?.isPublic ? 'block' : 'none'}\"><label>广场作品文案（发布时必填）</label><textarea name=\"plazaCopy\">${escapeHtml(current?.plazaCopy || '')}</textarea></div>` : ''}",
      "      ${user.trackId === 'interaction' ? `<label class=\"check-label\"><input name=\"isPublic\" type=\"checkbox\" ${current?.isPublic ? 'checked' : ''}> 同意发布至活动广场</label>` : ''}",
      '删除广场二次文案字段'
    );
    next = replaceOnce(
      next,
      "  if (form.isPublic) form.isPublic.onchange = () => {\n    document.querySelector('#plazaCopyField').style.display = form.isPublic.checked ? 'block' : 'none';\n  };\n",
      '',
      '删除广场二次文案显示事件'
    );
    next = next.replaceAll("plazaCopy: form.plazaCopy?.value || ''", 'plazaCopy: form.copy.value');

    next = replaceOnce(
      next,
      '<div class="admin-compact-list">${result.posts.map(compactPostRow).join(\'\') || \'<p class="muted">暂无广场帖子</p>\'}</div>',
      '<div class="admin-post-grid">${result.posts.map(compactPostRow).join(\'\') || \'<p class="muted">暂无广场帖子</p>\'}</div>',
      '管理端六列帖子容器'
    );

    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/student.js');
  if (!source.includes(marker)) {
    let next = source;

    next = replaceOnce(
      next,
      '    const plazaCopy = cleanText(body.plazaCopy, 2000);',
      '    const plazaCopy = cleanText(body.copy, 2000);',
      '广场文案复用活动文案'
    );
    next = replaceOnce(
      next,
      "    if (intent === 'submitted' && isPublic && !plazaCopy) return json({ error: '请填写广场作品文案' }, 400);\n",
      '',
      '删除广场二次文案后端校验'
    );

    const allMembersGuard = String.raw`
    if (intent === 'submitted' && owner.type === 'team' && user.role !== 'admin') {
      if (!owner.team || owner.team.captainId !== user.id) {
        return json({ error: '只有队长可以提交队伍作品' }, 403);
      }
      const [memberTotal, memberCompleted] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id=?1').bind(owner.id).first(),
        env.DB.prepare(
          `SELECT COUNT(DISTINCT user_id) AS completed FROM member_checkins
            WHERE team_id=?1 AND task_id=?2 AND occurrence_date=?3`
        ).bind(owner.id, task.id, occurrenceDate).first()
      ]);
      const total = Number(memberTotal?.total || 0);
      const completed = Number(memberCompleted?.completed || 0);
      if (!total || completed < total) {
        return json({ error: `需所有队员完成当天个人打卡后才能汇总提交（${completed}/${total}）` }, 409);
      }
    }
`;
    next = replaceOnce(
      next,
      "    const intent = body.intent === 'draft' ? 'draft' : 'submitted';\n",
      "    const intent = body.intent === 'draft' ? 'draft' : 'submitted';\n" + allMembersGuard,
      '队伍全员完成后端校验'
    );

    const teamHistoryRoute = String.raw`
  if (route === '/api/team-checkins/history' && request.method === 'GET') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可查看队伍记录' }, 403);
    const team = await teamForUser(env, user.id);
    if (!team) return json({ page: 1, limit: 20, total: 0, hasMore: false, records: [] });
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const offset = (page - 1) * limit;
    const [count, pageResult, members] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM task_submissions WHERE owner_type='team' AND owner_id=?1 AND status IN ('submitted','approved')").bind(team.id).first(),
      env.DB.prepare(
        `SELECT s.id,s.task_id AS taskId,t.name AS taskName,s.occurrence_date AS date,
                s.copy_text AS copy,s.status,s.submitted_at AS submittedAt
           FROM task_submissions s JOIN tasks t ON t.id=s.task_id
          WHERE s.owner_type='team' AND s.owner_id=?1 AND s.status IN ('submitted','approved')
          ORDER BY s.occurrence_date DESC,s.submitted_at DESC LIMIT ?2 OFFSET ?3`
      ).bind(team.id, limit, offset).all(),
      membersForTeam(env, team.id)
    ]);
    const records = pageResult.results;
    const imagesBySubmission = await submissionImagesForIds(env, records.map((record) => record.id), user);
    let checkinRows = [];
    if (records.length) {
      const values = [team.id];
      const conditions = records.map((record, index) => {
        values.push(record.taskId, record.date || '');
        const start = 2 + index * 2;
        return `(task_id=?${start} AND occurrence_date=?${start + 1})`;
      }).join(' OR ');
      const result = await env.DB.prepare(
        `SELECT task_id AS taskId,occurrence_date AS date,user_id AS userId
           FROM member_checkins WHERE team_id=?1 AND (${conditions})`
      ).bind(...values).all();
      checkinRows = result.results;
    }
    const completedByKey = new Map();
    for (const row of checkinRows) {
      const key = `${row.taskId}|${row.date || ''}`;
      if (!completedByKey.has(key)) completedByKey.set(key, new Set());
      completedByKey.get(key).add(row.userId);
    }
    for (const record of records) {
      const completed = completedByKey.get(`${record.taskId}|${record.date || ''}`) || new Set();
      record.images = imagesBySubmission.get(record.id) || [];
      record.teamProgress = {
        total: members.length,
        completed: completed.size,
        members: members.map((member) => ({ ...member, checked: completed.has(member.id) }))
      };
    }
    const total = Number(count?.total || 0);
    return json({ page, limit, total, hasMore: offset + records.length < total, records });
  }

`;
    next = replaceOnce(next, '  const memberMatch = route.match(/^\\/api\\/tasks\\/([^/]+)\\/member-checkin$/);', teamHistoryRoute + '  const memberMatch = route.match(/^\\/api\\/tasks\\/([^/]+)\\/member-checkin$/);', '队伍历史接口位置');

    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    let next = replaceOnce(source, 'const THUMB_MAX_EDGE = 640;', 'const THUMB_MAX_EDGE = 720;', '720px服务端缩略图尺寸');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('public/style.css');
  if (!source.includes(marker)) {
    const css = `

${marker}
/* 仅覆盖本轮确认区域：四入口、打卡设置、管理端帖子网格与队伍历史。 */
.student-shortcuts-four {
  display: grid !important;
  grid-template-columns: repeat(4,minmax(0,1fr)) !important;
  gap: 7px !important;
}
.student-shortcuts-four button {
  grid-column: auto !important;
  min-width: 0 !important;
  min-height: 76px !important;
  padding: 8px 2px !important;
  border-radius: 14px !important;
}
.student-shortcuts-four button span { font-size: 1.15rem !important; line-height: 1; }
.student-shortcuts-four button strong { font-size: .72rem !important; line-height: 1.15; white-space: nowrap; }
.student-shortcuts-four button small { font-size: .58rem !important; line-height: 1.1; white-space: nowrap; }

.checkin-settings-form { gap: 9px !important; }
.checkin-settings-form .switch-line {
  display: inline-flex !important;
  width: auto !important;
  padding: 4px 0 !important;
  gap: 7px !important;
  font-size: .9rem;
}
.checkin-settings-form input[type="checkbox"],
.weekday-options input[type="checkbox"] {
  appearance: auto !important;
  width: 18px !important;
  height: 18px !important;
  min-height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  flex: 0 0 18px !important;
  box-shadow: none !important;
}
.checkin-settings-form .settings-grid {
  display: grid !important;
  grid-template-columns: repeat(2,minmax(0,1fr)) !important;
  gap: 8px !important;
}
.checkin-settings-form .settings-grid label { gap: 5px !important; font-size: .82rem; }
.checkin-settings-form .settings-grid input { min-height: 42px !important; padding: 8px 10px !important; }
.checkin-settings-form fieldset { padding: 8px !important; border-radius: 12px !important; }
.checkin-settings-form fieldset legend { padding: 0 4px; font-size: .82rem; }
.weekday-options {
  display: grid !important;
  grid-template-columns: repeat(7,minmax(0,1fr)) !important;
  gap: 4px !important;
}
.weekday-options label {
  justify-content: center;
  gap: 3px !important;
  min-width: 0;
  padding: 3px 1px;
  font-size: .68rem;
}

.admin-post-grid {
  display: grid;
  grid-template-columns: repeat(6,minmax(0,1fr));
  gap: 7px;
  margin-top: 10px;
}
.admin-post-grid .admin-post-row {
  min-width: 0;
  min-height: 108px;
  padding: 7px 5px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  gap: 5px;
  border: 1px solid var(--border,rgba(0,0,0,.12));
  border-radius: 13px;
}
.admin-post-grid .admin-compact-primary strong,
.admin-post-grid .admin-compact-primary small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-post-grid .admin-compact-primary strong { font-size: .72rem; }
.admin-post-grid .admin-compact-primary small { font-size: .58rem; }
.admin-post-grid .admin-post-status { display: flex; flex-wrap: wrap; gap: 2px; }
.admin-post-grid .pill { padding: 2px 5px; font-size: .56rem; }
.admin-post-grid .admin-post-actions { width: 100%; min-height: 30px; padding: 4px 2px; font-size: .62rem; }

@media (max-width: 430px) {
  .student-hero { padding: 15px 14px 14px !important; }
  .student-user-card { padding: 13px 14px !important; }
  .student-shortcuts-four { gap: 5px !important; }
  .student-shortcuts-four button { min-height: 70px !important; padding: 7px 1px !important; }
  .student-shortcuts-four button strong { font-size: .67rem !important; }
  .student-shortcuts-four button small { font-size: .53rem !important; }
  .checkin-settings-form .settings-grid { grid-template-columns: repeat(2,minmax(0,1fr)) !important; }
  .admin-post-grid { grid-template-columns: repeat(6,minmax(0,1fr)) !important; gap: 4px; }
  .admin-post-grid .admin-post-row { min-height: 96px; padding: 5px 3px; border-radius: 10px; }
  .admin-post-grid .admin-compact-primary strong { font-size: .64rem; }
  .admin-post-grid .admin-compact-primary small { font-size: .5rem; }
  .admin-post-grid .admin-post-actions { min-height: 27px; font-size: .56rem; }
}
`;
    write(file, source + css);
  }
}

console.log('Applied approved compact layouts, restored team workflow and upgraded thumbnails to 720px WebP.');
