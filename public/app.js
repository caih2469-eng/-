const app = document.querySelector('#app');
let token = localStorage.token;
let user = JSON.parse(localStorage.user || 'null');
let config;
let tracks = [];
let materialAdminPage = 1;
let materialAdminCampus = '';

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

const compressImage = (file) => new Promise((resolve, reject) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return reject(new Error('仅支持 JPG、PNG、WebP 图片'));
  if (file.size > 12 * 1024 * 1024) return reject(new Error('原图不能超过 12MB'));
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', 0.82));
  };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取')); };
  image.src = url;
});

const readFiles = async (files) => Promise.all([...files].map(compressImage));
const renderPreviews = (container, images) => {
  container.innerHTML = images.map((src, index) => `<figure><img src="${src}" alt="待上传图片 ${index + 1}"><figcaption>第 ${index + 1} 张</figcaption></figure>`).join('');
};
const readRawFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('文件读取失败'));
  reader.readAsDataURL(file);
});
const downloadApiFile = async (path) => {
  const file = await api(path);
  const bytes = Uint8Array.from(atob(file.file), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
};
const downloadProtectedFile = async (path, filename) => {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '文件下载失败');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

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
        <div class="hero-glow glow-one"></div><div class="hero-glow glow-two"></div>
        <div class="anniversary-mark parallax" data-depth="18"><i>JS</i><b>20</b><span>th</span><small>2006—2026</small></div>
        <div class="hero-tag tag-yellow parallax" data-depth="28"><span class="tag-hole"></span><b>JS 20<sup>th</sup></b><small>FAFU · DESIGN</small></div>
        <div class="hero-tag tag-pink parallax" data-depth="34"><span class="tag-hole"></span><b>20 YEARS</b><small>青春正当时</small></div>
        <div class="hero-content parallax" data-depth="8">
          <div class="eyebrow">庆福建农林大学金山学院建院20周年-设计学院</div>
          <div class="anniversary-line"><span></span>20TH ANNIVERSARY<span></span></div>
          <h1 class="calligraphy-title"><span>廿载同心</span><em>青春同行</em></h1>
          <p>一院三地四校区，共庆青春正当时。</p>
          <div class="hero-actions"><button id="join">进入系统</button><a href="#about">探索活动 <b>↓</b></a></div>
        </div>
        <div class="hero-ribbon" aria-hidden="true"></div>
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
      <footer>庆福建农林大学金山学院建院20周年-设计学院　|　廿载同心 · 青春同行</footer>
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
  const hero = document.querySelector('.landing-hero');
  const moveHero = (x, y) => {
    const rect = hero.getBoundingClientRect();
    const px = (x - rect.left) / rect.width - 0.5;
    const py = (y - rect.top) / rect.height - 0.5;
    hero.style.setProperty('--mx', px.toFixed(3));
    hero.style.setProperty('--my', py.toFixed(3));
    hero.querySelectorAll('.parallax').forEach((element) => {
      const depth = Number(element.dataset.depth || 10);
      element.style.transform = `translate3d(${px * depth}px, ${py * depth}px, 0)`;
    });
  };
  hero.onpointermove = (event) => moveHero(event.clientX, event.clientY);
  hero.onpointerleave = () => hero.querySelectorAll('.parallax').forEach((element) => { element.style.transform = ''; });
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
  const isInteraction = user.trackId === 'interaction';
  const [teamListResult, myTeamResult, taskResult, historyResult, materialResult] = await Promise.all([
    isInteraction ? api('/api/teams') : Promise.resolve(null),
    isInteraction ? api('/api/teams/me') : Promise.resolve(null),
    api('/api/tasks'),
    isInteraction ? Promise.resolve({ submissions: [] }) : api('/api/submissions/history'),
    api('/api/material-tasks')
  ]);
  const myTeam = myTeamResult?.team;
  const teamRows = teamListResult?.teams.map((team) => `
    <tr>
      <td>${escapeHtml(team.name)}</td>
      <td>${team.memberCount}/${team.memberLimit}</td>
      <td><span class="pill ${team.isFull ? '' : 'done'}">${team.isFull ? '已满员' : '可加入'}</span></td>
    </tr>`).join('');
  app.innerHTML = `
    <header class="hero">
      <div class="row">
        <div><h1>${escapeHtml(config.activityName)}</h1><div>你好，${escapeHtml(user.name)}</div></div>
        <button class="secondary right" id="ranking">排行榜</button><button class="secondary" id="plaza">活动广场</button><button class="secondary" id="out">退出</button>
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
    ${isInteraction ? `
      <section class="card">
        <div class="row"><h2>我的队伍</h2><span class="right muted">${teamListResult.teamCount}/${teamListResult.maxTeams} 个队伍</span></div>
        ${myTeam ? `
          <div class="team-summary">
            <div><span>队伍名称</span><strong>${escapeHtml(myTeam.name)}</strong></div>
            <div><span>邀请码</span><strong class="invite-code">${escapeHtml(myTeam.inviteCode)}</strong></div>
            <div><span>成员人数</span><strong>${myTeam.memberCount}/${myTeam.memberLimit}</strong></div>
          </div>
          <h3>队伍成员</h3>
          <div class="member-list">${myTeam.members.map((member) => `<span>${escapeHtml(member.name)}（${escapeHtml(member.campus)}）</span>`).join('')}</div>
        ` : `
          <p class="muted">你尚未被编入队伍。队伍由管理员统一导入和调整，请联系活动管理员。</p>`}
      </section>
      ` : ''}`;
  const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
  const submissionNames = { draft: '草稿', submitted: '已提交', returned: '退回', approved: '通过' };
  const taskCards = taskResult.tasks.map((task) => `
    <article class="slot">
      <div class="row"><h2>${escapeHtml(task.name)}</h2><span class="pill ${task.submission?.status === 'approved' ? 'done' : 'pending'}">${submissionNames[task.submission?.status] || '未提交'}</span></div>
      <p>${escapeHtml(task.description)}</p>
      <p class="muted">${task.scheduleType === 'activityDays' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 活动第 ${task.refreshDays.join('、')} 天自动刷新` : task.scheduleType === 'weekly' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 周${task.weekdays.join('、周')}自动刷新` : `${formatDate(task.startAt)} 至 ${formatDate(task.endAt)}`} · 最多 ${task.imageLimit} 张图 · ${task.allowLate ? '允许补交' : '不允许补交'}</p>
      ${task.copyRequirement ? `<div class="notice">文案要求：${escapeHtml(task.copyRequirement)}</div>` : ''}
      ${task.submission?.reviewNote ? `<p class="bad">审核意见：${escapeHtml(task.submission.reviewNote)}</p>` : ''}
      ${isInteraction ? `
        <div class="team-progress">
          <div class="row"><strong>队伍个人打卡</strong><span class="right">${task.teamProgress?.completed || 0}/${task.teamProgress?.total || 0}</span></div>
          <div class="member-list compact">${(task.teamProgress?.members || []).map((member) => `<span class="${member.checked ? 'checked-member' : ''}">${escapeHtml(member.name)} · ${escapeHtml(member.studentId)} ${member.checked ? '✓ 已打卡' : '未打卡'}</span>`).join('')}</div>
        </div>
        <button data-member-task="${task.id}" ${task.availabilityError ? 'disabled' : ''}>${task.memberCheckin ? '更新个人打卡' : '个人打卡'}</button>
        ${task.isCaptain ? `<button class="secondary" data-task="${task.id}" ${task.availabilityError || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑队伍作品' : '队长汇总提交'}</button>` : '<p class="muted">队伍作品由管理员指定的队长汇总提交。</p>'}
      ` : `<button data-task="${task.id}" ${task.availabilityError || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑' : '个人打卡'}</button>`}
      ${task.availabilityError ? `<p class="bad">${escapeHtml(task.availabilityError)}</p>` : ''}
    </article>`).join('');
  app.insertAdjacentHTML('beforeend', `
    <section class="card" id="activityTasks"><div class="row"><h2>今日打卡</h2><span class="right muted">${isInteraction ? '个人打卡后由队长汇总' : '个人提交'}</span></div>
      <div class="grid">${taskCards || '<p class="muted">当前没有已发布任务</p>'}</div>
    </section>
    ${!isInteraction ? `<section class="card"><h2>我的历史记录</h2><div class="history-list">${historyResult.submissions.map((item) => `<div><strong>${escapeHtml(item.task.name || '已归档任务')}</strong><span>${mealNames[item.mealType] || '未分类'} · ${submissionNames[item.status] || item.status} · ${formatDate(item.updatedAt)}</span></div>`).join('') || '<p class="muted">暂无历史记录</p>'}</div></section>` : ''}`);
  const materialStatus = { submitted: '已提交', returned: '退回修改' };
  app.insertAdjacentHTML('beforeend', `<section class="card"><div class="row"><h2>最终截图证明</h2><span class="right muted">最多 8 张 · 压缩后单张不超过 5MB</span></div>
    <div class="grid">${materialResult.tasks.map((task) => `<article class="slot">
      <div class="row"><h2>${escapeHtml(task.title)}</h2><span class="pill ${task.submission?.status === 'submitted' ? 'done' : 'pending'}">${materialStatus[task.submission?.status] || '未提交'}</span></div>
      <p>${escapeHtml(task.description)}</p><p class="muted">截止：${formatDate(task.deadline)} · 个人提交 · ${task.fileTypes.map((type) => `.${escapeHtml(type)}`).join('、')} · 最多 ${task.fileLimit} 张</p>
      ${task.submission?.reviewNote ? `<p class="bad">退回原因：${escapeHtml(task.submission.reviewNote)}</p>` : ''}
      ${task.submission?.files?.length ? `<div>${task.submission.files.map((file) => `<button class="secondary material-download" data-url="${file.downloadUrl}" data-name="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</button>`).join(' ')}</div>` : ''}
      <button data-material="${task.id}" ${task.submission?.status === 'submitted' ? 'disabled' : ''}>${task.submission?.status === 'returned' ? '修改并重新提交' : '提交材料'}</button>
    </article>`).join('') || '<p class="muted">暂无材料任务</p>'}</div></section>`);
  document.querySelector('#out').onclick = logout;
  document.querySelector('#ranking').onclick = () => rankings();
  document.querySelector('#plaza').onclick = () => plaza();
  document.querySelectorAll('[data-task]').forEach((button) => {
    button.onclick = () => taskSubmissionForm(taskResult.tasks.find((task) => task.id === button.dataset.task));
  });
  document.querySelectorAll('[data-member-task]').forEach((button) => {
    button.onclick = () => memberCheckinForm(taskResult.tasks.find((task) => task.id === button.dataset.memberTask));
  });
  document.querySelectorAll('[data-material]').forEach((button) => {
    button.onclick = () => materialSubmissionForm(materialResult.tasks.find((task) => task.id === button.dataset.material));
  });
  document.querySelectorAll('.material-download').forEach((button) => {
    button.onclick = () => downloadProtectedFile(button.dataset.url, button.dataset.name).catch((error) => alert(error.message));
  });
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 2, 0);
  setTimeout(() => {
    if (document.querySelector('#activityTasks')) home();
  }, Math.max(1000, nextMidnight.getTime() - Date.now()));
}

function memberCheckinForm(task) {
  app.innerHTML = `<header class="hero"><h1>个人打卡</h1><p>${escapeHtml(task.name)}</p></header>
    <section class="card"><form id="memberSend">
      <div class="notice">姓名和学号由账号自动带入，请上传本人当天截图。</div>
      <label>姓名</label><input value="${escapeHtml(user.name)}" readonly>
      <label>学号</label><input value="${escapeHtml(user.studentId)}" readonly>
      <label>校区</label><input value="${escapeHtml(user.campus)}" readonly>
      <label>图片</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" required>
      <div class="image-preview" id="memberPreview"></div>
      <div class="row"><button type="button" class="secondary" id="backMember">返回</button><button>确定打卡</button></div>
    </form></section>`;
  const form = document.querySelector('#memberSend');
  document.querySelector('#backMember').onclick = home;
  form.images.onchange = async () => {
    try { form._images = await readFiles(form.images.files); renderPreviews(document.querySelector('#memberPreview'), form._images); }
    catch (error) { alert(error.message); form.images.value = ''; }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const images = form._images || await readFiles(form.images.files);
      await api(`/api/tasks/${task.id}/member-checkin`, { method: 'PUT', body: JSON.stringify({ occurrenceDate: task.occurrenceDate, images }) });
      alert('个人打卡成功');
      home();
    } catch (error) { alert(error.message); }
  };
}

function materialSubmissionForm(task) {
  const current = task.submission;
  app.innerHTML = `<header class="hero"><h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(task.description)}</p></header>
    <section class="card"><form id="materialSend">
      <div class="notice">浏览器会自动压缩图片，最多 ${task.fileLimit} 张，压缩后单张最大 5MB。</div>
      <label>上传最终截图</label><input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp">
      <div class="image-preview" id="materialPreview"></div>
      <label>文字总结${task.summaryRequired ? '（必填）' : '（选填）'}</label><textarea name="summary">${escapeHtml(current?.summary || '')}</textarea>
      <div class="row"><button type="button" class="secondary" id="backMaterial">返回</button><button>提交材料</button></div>
    </form></section>`;
  document.querySelector('#backMaterial').onclick = home;
  const materialForm = document.querySelector('#materialSend');
  materialForm.files.onchange = async () => {
    try {
      if (materialForm.files.files.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 张图片`);
      materialForm._images = await readFiles(materialForm.files.files);
      renderPreviews(document.querySelector('#materialPreview'), materialForm._images);
    } catch (error) { alert(error.message); materialForm.files.value = ''; }
  };
  document.querySelector('#materialSend').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const selected = [...event.target.files.files];
      if (selected.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 个文件`);
      const images = event.target._images || await readFiles(selected);
      const files = images.map((data, index) => ({ name: `${selected[index].name.replace(/\.[^.]+$/, '')}.jpg`, data }));
      await api(`/api/material-tasks/${task.id}/submission`, { method: 'PUT', body: JSON.stringify({ version: current?.version || 0, files, summary: event.target.summary.value }) });
      alert('材料提交成功');
      home();
    } catch (error) { alert(error.message); }
  };
}

function taskSubmissionForm(task) {
  const current = task.submission;
  app.innerHTML = `
    <header class="hero"><h1>${escapeHtml(task.name)}</h1><p>${escapeHtml(task.description)}</p></header>
    <section class="card"><form id="taskSend">
      <div class="notice">上传前浏览器会自动压缩图片。支持 JPG、PNG、WebP，原图不超过 12MB，最多 ${task.imageLimit} 张。</div>
      <label>活动图片</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="image-preview" id="taskPreview"></div>
      ${user.trackId === 'health' ? `<label>餐次</label><select name="mealType" required><option value="">请选择</option><option value="breakfast" ${current?.mealType === 'breakfast' ? 'selected' : ''}>早餐</option><option value="lunch" ${current?.mealType === 'lunch' ? 'selected' : ''}>午餐</option><option value="dinner" ${current?.mealType === 'dinner' ? 'selected' : ''}>晚餐</option></select>` : ''}
      <label>活动文案${task.copyRequirement ? '（必填）' : '（选填）'}</label><textarea name="copy">${escapeHtml(current?.copy || '')}</textarea>
      ${user.trackId === 'interaction' ? `<label class="check-label"><input name="isPublic" type="checkbox" ${current?.isPublic ? 'checked' : ''}> 同意发布至活动广场</label>
      <div id="plazaCopyField" style="display:${current?.isPublic ? 'block' : 'none'}"><label>广场作品文案（发布时必填）</label><textarea name="plazaCopy">${escapeHtml(current?.plazaCopy || '')}</textarea></div>` : ''}
      <div class="row"><button type="button" class="secondary" id="back">返回</button><button type="button" class="secondary" data-intent="draft">保存草稿</button><button data-intent="submit">最终提交</button></div>
    </form></section>`;
  document.querySelector('#back').onclick = home;
  const form = document.querySelector('#taskSend');
  form.images.onchange = async () => {
    try {
      if (form.images.files.length > task.imageLimit) throw new Error(`最多上传 ${task.imageLimit} 张图片`);
      form._images = await readFiles(form.images.files);
      renderPreviews(document.querySelector('#taskPreview'), form._images);
    } catch (error) { alert(error.message); form.images.value = ''; }
  };
  if (form.isPublic) form.isPublic.onchange = () => {
    document.querySelector('#plazaCopyField').style.display = form.isPublic.checked ? 'block' : 'none';
  };
  form.querySelectorAll('[data-intent]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      try {
        if (form.images.files.length > task.imageLimit) throw new Error(`最多上传 ${task.imageLimit} 张图片`);
        const images = form.images.files.length ? (form._images || await readFiles(form.images.files)) : [];
        const result = await api(`/api/tasks/${task.id}/submission`, {
          method: 'PUT',
          body: JSON.stringify({
            intent: button.dataset.intent,
            version: current?.version || 0,
            occurrenceDate: task.occurrenceDate,
            images,
            copy: form.copy.value,
            plazaCopy: form.plazaCopy?.value || '',
            mealType: form.mealType?.value,
            isPublic: Boolean(form.isPublic?.checked)
          })
        });
        alert(result.submission.status === 'draft' ? '草稿已保存' : '最终提交成功');
        home();
      } catch (error) { alert(error.message); }
    };
  });
}

async function plaza(sort = 'latest', page = 1, month = '') {
  const result = await api(`/api/plaza?sort=${sort}&page=${page}&limit=6${month ? `&month=${month}` : ''}`);
  const cards = result.posts.map((post) => `
    <article class="plaza-card" data-post="${post.id}">
      <img loading="lazy" src="${escapeHtml(post.images[0] || '')}" alt="${escapeHtml(post.teamName)}活动图片">
      <div class="plaza-body">
        <span class="eyebrow dark">${escapeHtml(post.taskName)}</span>
        <h2>${escapeHtml(post.teamName)}</h2>
        <p class="muted">${post.members.map((member) => escapeHtml(member.name)).join('、')}</p>
        <p>${escapeHtml(post.copy)}</p>
        <div class="row muted"><span>${formatDate(post.publishedAt)}</span><span class="right">浏览 ${post.viewCount}　点赞 ${post.likeCount}</span></div>
      </div>
    </article>`).join('');
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>四校区活动广场</h1><p>内容仅来自公开的四校区任务提交</p></div><button class="secondary right" id="backHome">返回</button></div></header>
    <section class="card plaza-toolbar">
      <div class="row">
        <button class="${sort === 'latest' ? '' : 'secondary'}" data-sort="latest">最新发布</button>
        <button class="${sort === 'hot' ? '' : 'secondary'}" data-sort="hot">热门排行</button>
        <button class="${sort === 'monthly' ? '' : 'secondary'}" data-sort="monthly">月度排行</button>
        <label class="right">月份 <input id="plazaMonth" type="month" value="${escapeHtml(result.month)}"></label>
      </div>
    </section>
    <section class="plaza-grid">${cards || '<div class="card muted">当前没有公开内容</div>'}</section>
    <div class="row plaza-pager">
      <button class="secondary" id="prevPage" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} 页 · 共 ${result.total} 条</span>
      <button class="secondary" id="nextPage" ${!result.hasMore ? 'disabled' : ''}>下一页</button>
    </div>
    <div id="modalRoot"></div>`;
  document.querySelector('#backHome').onclick = home;
  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.onclick = () => plaza(button.dataset.sort, 1, document.querySelector('#plazaMonth').value);
  });
  document.querySelector('#plazaMonth').onchange = (event) => plaza('monthly', 1, event.target.value);
  document.querySelector('#prevPage').onclick = () => plaza(sort, page - 1, result.month);
  document.querySelector('#nextPage').onclick = () => plaza(sort, page + 1, result.month);
  document.querySelectorAll('[data-post]').forEach((card) => {
    card.onclick = () => openPlazaPost(card.dataset.post, sort, page, result.month);
  });
}

function rankingTable(items, metric, label) {
  return `<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>${label}</th></tr></thead><tbody>${items.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.teamName)}</td><td>${item[metric]}</td></tr>`).join('') || '<tr><td colspan="3">暂无数据</td></tr>'}</tbody></table></div>`;
}

async function rankings(period = 'day', key = '') {
  const result = await api(`/api/rankings?period=${period}${key ? `&key=${key}` : ''}`);
  const currentKey = key || (period === 'month' ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).slice(0, 7) : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));
  const teamTable = `<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>公开次数</th><th>点赞</th><th>浏览</th><th>综合热度</th></tr></thead><tbody>${result.teamRank.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.teamName)}</td><td>${item.publicCount}</td><td>${item.likeCount}</td><td>${item.viewCount}</td><td>${item.heatScore}</td></tr>`).join('') || '<tr><td colspan="6">暂无数据</td></tr>'}</tbody></table></div>`;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>活动排行榜</h1><p>${escapeHtml(result.formula)}</p></div><button class="secondary right" id="backRanking">返回</button></div></header>
    <section class="card"><div class="row">
      <button class="${period === 'day' ? '' : 'secondary'}" data-period="day">日榜</button>
      <button class="${period === 'week' ? '' : 'secondary'}" data-period="week">周榜</button>
      <button class="${period === 'month' ? '' : 'secondary'}" data-period="month">月榜</button>
      <label class="right">${period === 'month' ? '月份' : '日期'} <input id="rankingKey" type="${period === 'month' ? 'month' : 'date'}" value="${escapeHtml(currentKey)}"></label>
      ${result.frozen ? '<span class="pill done">最终排名已冻结</span>' : ''}
    </div></section>
    ${period === 'month' ? `<section class="card"><h2>队伍月榜</h2>${teamTable}</section>` : `
      <section class="grid ranking-grids">
        <div class="card"><h2>点赞榜</h2>${rankingTable(result.likeRank, 'likeCount', '点赞')}</div>
        <div class="card"><h2>浏览榜</h2>${rankingTable(result.viewRank, 'viewCount', '浏览')}</div>
        <div class="card"><h2>综合热度榜</h2>${rankingTable(result.heatRank, 'heatScore', '热度')}</div>
      </section>`}
    ${period === 'month' && user.role === 'admin' ? `<section class="card"><div class="row"><button id="freezeRanking" ${result.frozen ? 'disabled' : ''}>冻结最终排名</button><button class="secondary" id="exportRanking">导出 Excel</button></div></section>` : ''}`;
  document.querySelector('#backRanking').onclick = home;
  document.querySelectorAll('[data-period]').forEach((button) => { button.onclick = () => rankings(button.dataset.period); });
  document.querySelector('#rankingKey').onchange = (event) => rankings(period, event.target.value);
  const freeze = document.querySelector('#freezeRanking');
  if (freeze) freeze.onclick = async () => {
    if (!confirm(`冻结 ${currentKey} 最终排名后将不会随数据变化，确认继续？`)) return;
    await api('/api/admin/rankings/freeze', { method: 'POST', body: JSON.stringify({ month: currentKey }) });
    rankings('month', currentKey);
  };
  const exportButton = document.querySelector('#exportRanking');
  if (exportButton) exportButton.onclick = async () => {
    await downloadApiFile(`/api/admin/rankings/export?month=${currentKey}`);
  };
}

async function openPlazaPost(postId, sort, page, month, countView = true) {
  if (countView) await api(`/api/plaza/${postId}/view`, { method: 'POST' });
  const { post } = await api(`/api/plaza/${postId}`);
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><section class="card modal plaza-detail">
    <div class="row"><div><span class="eyebrow dark">${escapeHtml(post.taskName)}</span><h2>${escapeHtml(post.teamName)}</h2></div><button class="secondary right" id="closePost">关闭</button></div>
    <p class="muted">成员：${post.members.map((member) => `${escapeHtml(member.name)}（${escapeHtml(member.campus)}）`).join('、')}</p>
    <div class="plaza-photos">${post.images.map((url) => `<img loading="lazy" src="${escapeHtml(url)}" alt="活动图片">`).join('')}</div>
    <p>${escapeHtml(post.copy)}</p>
    <div class="row"><span class="muted">${formatDate(post.publishedAt)} · 浏览 ${post.viewCount} · 今日剩余 ${post.likeQuota.remaining}/5 个赞</span><button class="right ${post.liked ? '' : 'secondary'}" id="likePost">${post.liked ? '取消点赞' : '点赞'} ${post.likeCount}</button></div>
  </section></div>`;
  document.querySelector('#closePost').onclick = () => plaza(sort, page, month);
  document.querySelector('#likePost').onclick = async () => {
    await api(`/api/plaza/${postId}/like`, { method: 'POST', body: JSON.stringify({ liked: !post.liked }) });
    openPlazaPost(postId, sort, page, month, false);
  };
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
  const [dashboard, userResult, teamResult, taskAdminResult, plazaAdminResult, overview, materialAdmin] = await Promise.all([
    api(`/api/admin/dashboard?date=${date}`),
    api('/api/admin/users'),
    api('/api/admin/teams'),
    api('/api/admin/tasks'),
    api('/api/admin/plaza'),
    api('/api/admin/overview'),
    api(`/api/admin/material-tasks?page=${materialAdminPage}&limit=50&campus=${encodeURIComponent(materialAdminCampus)}`)
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
        <button class="danger dissolve-team" data-id="${team.id}" ${team.memberCount ? 'disabled title="请先移除全部成员"' : ''}>解散</button>
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
      <div class="row"><div><h1>活动管理后台</h1><div>${escapeHtml(config.activityName)}</div></div><button class="secondary right" id="ranking">排行榜</button><button class="secondary" id="plaza">活动广场</button><button class="secondary" id="out">退出</button></div>
    </header>
    <section class="metric-grid">
      ${[['用户数量',overview.userCount],['队伍数量',overview.teamCount],['今日提交',overview.todaySubmissions],['公开帖子',overview.publicPostCount],['点赞数量',overview.likeCount],['浏览数量',overview.viewCount]].map(([label,value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
    </section>
    <section class="card">
      <div class="row"><h2>每日提交总览</h2><label class="right">日期 <input id="date" type="date" value="${date}"></label><button class="secondary" id="reload">查询</button></div>
      <div class="table-wrap"><table><thead><tr><th>学生</th><th>赛道</th>${slotHeaders}</tr></thead><tbody>${dashboardRows || '<tr><td colspan="6">尚无学生</td></tr>'}</tbody></table></div>
    </section>
    <section class="card">
      <div class="row"><h2>用户列表</h2><span class="right muted">共 ${users.length} 个普通用户</span></div>
      <div class="table-wrap"><table><thead><tr><th>姓名</th><th>学号</th><th>校区</th><th>所属赛道</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${userRows || '<tr><td colspan="7">尚无用户</td></tr>'}</tbody></table></div>
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
        ${taskFormFields()}
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

  document.querySelector('#out').onclick = logout;
  document.querySelector('#ranking').onclick = () => rankings();
  document.querySelector('#plaza').onclick = () => plaza();
  document.querySelector('#reload').onclick = () =>
    admin(document.querySelector('#date').value);
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
      if (!confirm('确认将该成员移出队伍？')) return;
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
      const studentId = prompt('请输入要加入该队伍的学生学号');
      if (!studentId) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/members`, { method: 'POST', body: JSON.stringify({ studentId }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.set-captain').forEach((button) => {
    button.onclick = async () => {
      const studentId = prompt('请输入该队队长的学号（必须已经在队伍中）');
      if (!studentId) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: JSON.stringify({ studentId }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.clear-captain').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('确认取消该队伍的队长权限？')) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: '{}' });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.dissolve-team').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('确认解散这个空队伍？此操作不可恢复。')) return;
      try {
        await api(`/api/admin/teams/${button.dataset.id}`, { method: 'DELETE' });
        admin(date);
      } catch (error) {
        alert(error.message);
      }
    };
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
  document.querySelector('#switches').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    await api('/api/admin/activity-switches', { method: 'PATCH', body: JSON.stringify({ activityEnabled: form.activityEnabled.checked, trackEnabled: { interaction: form.interaction.checked, health: form.health.checked } }) });
    home();
  };
  document.querySelector('#createTask').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify(taskPayload(event.target)) });
      alert('任务创建成功');
      admin(date);
    } catch (error) { alert(error.message); }
  };
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
      const reviewNote = returning ? prompt('请输入退回原因') : '';
      if (returning && !reviewNote) return;
      try {
        await api(`/api/admin/submissions/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: returning ? 'returned' : 'approved', reviewNote }) });
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('.delete-submission').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('确认删除该提交及其关联广场帖子？此操作不可恢复。')) return;
      await api(`/api/admin/submissions/${button.dataset.id}`, { method: 'DELETE' });
      admin(date);
    };
  });
  document.querySelectorAll('.toggle-post').forEach((button) => {
    button.onclick = async () => {
      await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
      admin(date);
    };
  });
  document.querySelectorAll('.delete-post').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('确认永久删除该广场帖子？任务提交记录不会删除。')) return;
      await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'DELETE' });
      admin(date);
    };
  });
  document.querySelectorAll('.exclude-post').forEach((button) => {
    button.onclick = async () => {
      await api(`/api/admin/plaza/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ excludedFromRanking: button.dataset.excluded === 'true' }) });
      admin(date);
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
      const reviewNote = prompt('请输入退回修改原因');
      if (!reviewNote) return;
      await api(`/api/admin/material-submissions/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ reviewNote }) });
      admin(date);
    };
  });
  document.querySelectorAll('.missing-material').forEach((button) => {
    button.onclick = () => downloadApiFile(`/api/admin/material-tasks/${button.dataset.id}/missing-export`).catch((error) => alert(error.message));
  });
}

function taskFormFields(task = {}) {
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const nextWeek = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  return `<form id="${task.id ? 'editTask' : 'createTask'}">
    <label>任务名称</label><input name="name" value="${escapeHtml(task.name || '')}" required>
    <label>描述</label><textarea name="description">${escapeHtml(task.description || '')}</textarea>
    <label>所属赛道</label><select name="trackId">${tracks.map((track) => `<option value="${track.id}" ${track.id === task.trackId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select>
    <label>任务刷新方式</label><select name="scheduleType"><option value="activityDays" ${!task.scheduleType || task.scheduleType === 'activityDays' ? 'selected' : ''}>按活动第几天刷新</option><option value="weekly" ${task.scheduleType === 'weekly' ? 'selected' : ''}>按指定星期刷新</option><option value="oneTime" ${task.scheduleType === 'oneTime' ? 'selected' : ''}>单次任务</option></select>
    <label>活动开始日期</label><input name="activeStartDate" type="date" value="${escapeHtml(task.activeStartDate || todayKey)}">
    <label>活动结束日期</label><input name="activeEndDate" type="date" value="${escapeHtml(task.activeEndDate || nextWeek)}">
    <label>活动刷新日</label><input name="refreshDays" value="${escapeHtml((task.refreshDays || [1,3,5]).join(','))}" placeholder="1,3,5 表示活动第 1、3、5 天">
    <label>自动刷新星期（星期模式）</label><input name="weekdays" value="${escapeHtml((task.weekdays || [1,3,5]).join(','))}" placeholder="1,3,5 表示周一、周三、周五">
    <label>当天提交时间</label><div class="row"><input name="dailyStart" type="time" value="${task.dailyStart || '00:00'}"><span>至</span><input name="dailyEnd" type="time" value="${task.dailyEnd || '23:59'}"></div>
    <label>单次任务开始时间</label><input name="startAt" type="datetime-local" value="${escapeHtml((task.startAt || '').slice(0, 16))}">
    <label>单次任务截止时间</label><input name="endAt" type="datetime-local" value="${escapeHtml((task.endAt || '').slice(0, 16))}">
    <label>图片数量限制</label><input name="imageLimit" type="number" min="1" max="3" value="${Math.min(task.imageLimit || 3, 3)}" required>
    <label>文案要求</label><textarea name="copyRequirement">${escapeHtml(task.copyRequirement || '')}</textarea>
    <p class="muted">每天只可提交当天生成的任务，系统不允许补交。</p>
    <label>任务状态</label><select name="status">${[['draft','草稿'],['published','发布'],['closed','关闭'],['archived','归档']].map(([value,label]) => `<option value="${value}" ${task.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <button>${task.id ? '保存修改' : '创建任务'}</button>
  </form>`;
}

function taskPayload(form) {
  const values = Object.fromEntries(new FormData(form));
  return { ...values, allowLate: false, imageLimit: Number(values.imageLimit), weekdays: values.weekdays.split(/[,，\s]+/).map(Number), refreshDays: values.refreshDays.split(/[,，\s]+/).map(Number) };
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
