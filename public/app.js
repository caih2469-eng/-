const app = document.querySelector('#app');
let token = localStorage.token;
let user = JSON.parse(localStorage.user || 'null');
let config;
let tracks = [];

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
};

const escapeHtml = (value) =>
  String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

const readFiles = async (files) =>
  Promise.all(
    [...files].map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        })
    )
  );

const trackName = (trackId) =>
  tracks.find((track) => track.id === trackId)?.name || '未分配';

const statusLabel = (status) => (status === 'active' ? '启用' : '禁用');

const formatDate = (value) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';

function logout() {
  localStorage.clear();
  token = null;
  user = null;
  login();
}

function login() {
  app.innerHTML = `
    <section class="landing">
      <div class="landing-hero">
        <div class="eyebrow">福建农林大学金山学院设计学院 · 建院20周年</div>
        <h1>廿载同心<br><em>青春同行</em></h1>
        <p>一院三地四校区，共庆青春正当时。</p>
        <button id="join">进入系统</button>
        <a href="#about">了解活动 ↓</a>
      </div>
      <section id="about" class="intro">
        <div>
          <span class="eyebrow dark">双赛道活动</span>
          <h2>选择属于你的青春同行方式</h2>
          <p>四校区互动赛道连接不同校区伙伴，自律健康赛道记录规律生活。登录后可查看自己的身份资料和所属赛道。</p>
        </div>
        <div class="data">
          <b>2</b><span>活动赛道</span>
          <b>4</b><span>校区同步参与</span>
          <b>20</b><span>周年同行</span>
        </div>
      </section>
      <section class="feature-grid">
        <article><span>01</span><h3>四校区互动赛道</h3><p>跨校区组队、共同创作，记录四校区的校园风貌。</p></article>
        <article><span>02</span><h3>自律健康赛道</h3><p>按照规定时段记录三餐，培养规律健康的生活习惯。</p></article>
        <article><span>03</span><h3>专属账号</h3><p>每位参与者使用自己的学号登录，只能查看个人身份与活动资料。</p></article>
      </section>
      <footer>廿载同心 · 青春同行　|　福建农林大学金山学院设计学院</footer>
    </section>
    <section class="card login" id="loginCard">
      <div class="row">
        <h2>账号登录</h2>
        <button class="secondary right" id="closeLogin">返回宣传页</button>
      </div>
      <p class="muted">使用管理员创建的学号和密码登录。</p>
      <form id="login">
        <label>学号</label><input name="studentId" required>
        <label>密码</label><input name="password" type="password" required>
        <button>登录</button>
      </form>
    </section>`;
  document.querySelector('#loginCard').style.display = 'none';
  document.querySelector('#join').onclick = () => {
    document.querySelector('#loginCard').style.display = 'block';
    document.querySelector('#loginCard').scrollIntoView({ behavior: 'smooth' });
  };
  document.querySelector('#closeLogin').onclick = () => {
    document.querySelector('#loginCard').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  document.querySelector('#login').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.target);
      const result = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form))
      });
      token = result.token;
      user = result.user;
      config = result.config;
      tracks = result.tracks;
      localStorage.token = token;
      localStorage.user = JSON.stringify(user);
      home();
    } catch (error) {
      alert(error.message);
    }
  };
}

async function home() {
  const result = await api('/api/me');
  config = result.config;
  tracks = result.tracks;
  user = result.user;
  localStorage.user = JSON.stringify(user);
  return user.role === 'admin' ? admin() : student(result);
}

async function student(me) {
  const result = await api('/api/checkins');
  const completed = Object.fromEntries(
    result.checkins.map((checkin) => [checkin.slotId, checkin])
  );
  app.innerHTML = `
    <header class="hero">
      <div class="row">
        <div><h1>${escapeHtml(config.activityName)}</h1><div>你好，${escapeHtml(user.name)}</div></div>
        <button class="secondary right" id="out">退出</button>
      </div>
    </header>
    <section class="card">
      <h2>我的资料</h2>
      <div class="profile-grid">
        <div><span>姓名</span><strong>${escapeHtml(user.name)}</strong></div>
        <div><span>学号</span><strong>${escapeHtml(user.studentId)}</strong></div>
        <div><span>校区</span><strong>${escapeHtml(user.campus)}</strong></div>
        <div><span>所属赛道</span><strong>${escapeHtml(trackName(user.trackId))}</strong></div>
        <div><span>账号状态</span><strong>${escapeHtml(statusLabel(user.status))}</strong></div>
        <div><span>创建时间</span><strong>${escapeHtml(formatDate(user.createdAt))}</strong></div>
      </div>
      <p class="muted">关键身份资料仅可由管理员维护，如有错误请联系活动工作人员。</p>
    </section>
    ${user.trackId === 'health' ? `
      <section class="card">
        <div class="row"><h2>今日打卡</h2><span class="right muted">${me.date}　系统时间 ${me.time}</span></div>
        <div class="notice">请在规定时段提交含本人学号的水印截图。同一时段可更新，以最新记录为准。</div>
        <div class="grid" id="slots"></div>
      </section>` : `
      <section class="card">
        <h2>四校区互动赛道</h2>
        <p>你的账号属于四校区互动赛道。当前阶段请按照活动工作人员发布的组队与任务安排参与。</p>
      </section>`}`;
  document.querySelector('#out').onclick = logout;
  const slotContainer = document.querySelector('#slots');
  if (!slotContainer) return;
  config.slots.forEach((slot) => {
    const checkin = completed[slot.id];
    const active = me.time >= slot.start && me.time <= slot.end;
    const displayStatus = checkin?.status === 'approved'
      ? '已通过'
      : checkin?.status === 'rejected'
        ? '已驳回'
        : '待审核';
    slotContainer.insertAdjacentHTML('beforeend', `
      <article class="slot ${active ? 'active' : ''}">
        <h2>${escapeHtml(slot.label)}</h2><p>${slot.start}–${slot.end}</p>
        ${checkin ? `<p class="${checkin.status === 'approved' ? 'ok' : checkin.status === 'rejected' ? 'bad' : 'muted'}">已提交 · ${displayStatus}</p>` : '<p class="muted">尚未提交</p>'}
        <button ${active ? '' : 'disabled'} data-slot="${slot.id}">${checkin ? '更新材料' : '提交打卡'}</button>
      </article>`);
  });
  slotContainer.querySelectorAll('button').forEach((button) => {
    button.onclick = () => checkinForm(button.dataset.slot);
  });
}

function checkinForm(slotId) {
  const slot = config.slots.find((item) => item.id === slotId);
  app.innerHTML = `
    <header class="hero"><h1>${escapeHtml(slot.label)}打卡</h1><p>${slot.start}–${slot.end}，请上传水印相机截图。</p></header>
    <section class="card">
      <form id="send">
        <label>餐食水印截图（可多选）</label><input required name="photos" type="file" accept="image/*" multiple>
        <label>Elavatine 当日汇总截图（可选）</label><input name="summary" type="file" accept="image/*">
        <label>备注（可选）</label><textarea name="note"></textarea>
        <div class="row"><button type="button" class="secondary" id="back">返回</button><button>上传并提交</button></div>
      </form>
    </section>`;
  document.querySelector('#back').onclick = home;
  document.querySelector('#send').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const photos = await readFiles(form.photos.files);
      const summary = form.summary.files[0] ? (await readFiles(form.summary.files))[0] : null;
      await api('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({ slotId, photos, summary, note: form.note.value })
      });
      alert('提交成功');
      home();
    } catch (error) {
      alert(error.message);
    }
  };
}

async function admin(selectedDate) {
  const date = selectedDate || new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai'
  });
  const [dashboard, userResult] = await Promise.all([
    api(`/api/admin/dashboard?date=${date}`),
    api('/api/admin/users')
  ]);
  const users = userResult.users;
  const slotHeaders = config.slots
    .map((slot) => `<th>${escapeHtml(slot.label)}<br><small>${slot.start}–${slot.end}</small></th>`)
    .join('');
  const dashboardRows = dashboard.students
    .map((studentUser) => `
      <tr>
        <td>${escapeHtml(studentUser.name)}<br><small>${escapeHtml(studentUser.studentId)}</small></td>
        <td>${escapeHtml(trackName(studentUser.trackId))}</td>
        ${studentUser.slots.map((checkin) => `
          <td>${checkin
            ? `<span class="pill ${checkin.status === 'approved' ? 'done' : 'pending'}">${checkin.status === 'approved' ? '通过' : checkin.status === 'rejected' ? '驳回' : '已交'}</span><br><button class="secondary review" data-id="${checkin.id}">查看</button>`
            : '<span class="muted">未交</span>'}</td>`).join('')}
      </tr>`).join('');
  const userRows = users.map((studentUser) => `
    <tr>
      <td>${escapeHtml(studentUser.name)}</td>
      <td>${escapeHtml(studentUser.studentId)}</td>
      <td>${escapeHtml(studentUser.campus)}</td>
      <td>${escapeHtml(trackName(studentUser.trackId))}</td>
      <td><span class="pill ${studentUser.status === 'active' ? 'done' : ''}">${statusLabel(studentUser.status)}</span></td>
      <td>${escapeHtml(formatDate(studentUser.createdAt))}</td>
      <td class="actions">
        <button class="secondary edit-user" data-id="${studentUser.id}">编辑</button>
        <button class="${studentUser.status === 'active' ? 'danger' : 'secondary'} toggle-user" data-id="${studentUser.id}" data-status="${studentUser.status === 'active' ? 'disabled' : 'active'}">${studentUser.status === 'active' ? '禁用' : '启用'}</button>
      </td>
    </tr>`).join('');

  app.innerHTML = `
    <header class="hero">
      <div class="row"><div><h1>活动管理后台</h1><div>${escapeHtml(config.activityName)}</div></div><button class="secondary right" id="out">退出</button></div>
    </header>
    <section class="card">
      <div class="row"><h2>每日提交总览</h2><label class="right">日期 <input id="date" type="date" value="${date}"></label><button class="secondary" id="reload">查询</button></div>
      <div class="table-wrap"><table><thead><tr><th>学生</th><th>赛道</th>${slotHeaders}</tr></thead><tbody>${dashboardRows || '<tr><td colspan="6">尚无学生</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><h2>用户列表</h2><span class="right muted">共 ${users.length} 个普通用户</span></div>
      <div class="table-wrap"><table><thead><tr><th>姓名</th><th>学号</th><th>校区</th><th>所属赛道</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${userRows || '<tr><td colspan="7">尚无用户</td></tr>'}</tbody></table></div>
    </section>
    <section class="grid admin-tools">
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

  document.querySelector('#out').onclick = logout;
  document.querySelector('#reload').onclick = () =>
    admin(document.querySelector('#date').value);
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
      const encoded = (await readFiles([file]))[0];
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
  document.querySelectorAll('.toggle-user').forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.status === 'disabled' ? '禁用' : '启用';
      if (!confirm(`确认${action}该用户？`)) return;
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
  document.querySelectorAll('.review').forEach((button) => {
    button.onclick = () => reviewCheckin(dashboard.students, button.dataset.id, date);
  });
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
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>审核材料</h2><button class="secondary right" id="closeReview">关闭</button></div>
        <div class="photos">${checkin.photos.map((photo) => `<a href="${photo}" target="_blank"><img src="${photo}" alt="打卡截图"></a>`).join('')}${checkin.summary ? `<a href="${checkin.summary}" target="_blank"><img src="${checkin.summary}" alt="汇总截图"></a>` : ''}</div>
        <p>${escapeHtml(checkin.note || '无备注')}</p>
        <button id="approve">通过</button> <button class="danger" id="reject">驳回</button>
      </section>
    </div>`;
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

if (token) home().catch(logout);
else login();
