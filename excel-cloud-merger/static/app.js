const fileInput = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const fileList = document.querySelector('#fileList');
const startButton = document.querySelector('#startButton');
const downloadButton = document.querySelector('#downloadButton');
const deleteButton = document.querySelector('#deleteButton');
const progressCard = document.querySelector('#progressCard');
const resultCard = document.querySelector('#resultCard');
const errorCard = document.querySelector('#errorCard');
const errorText = document.querySelector('#errorText');
const stats = document.querySelector('#stats');
const deleteState = document.querySelector('#deleteState');
const accessKey = document.querySelector('#accessKey');

let selectedFiles = [];
let currentJob = null;

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function showFiles() {
  if (!selectedFiles.length) {
    fileList.className = 'file-list empty';
    fileList.textContent = '尚未选择文件';
    return;
  }
  fileList.className = 'file-list';
  fileList.innerHTML = selectedFiles.map(file => `
    <div class="file-item"><span>${escapeHtml(file.name)}</span><span>${humanSize(file.size)}</span></div>
  `).join('');
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function setFiles(files) {
  const allowed = ['xlsx', 'xls', 'csv', 'zip'];
  selectedFiles = [...files].filter(file => allowed.includes(file.name.split('.').pop().toLowerCase()));
  showFiles();
}

fileInput.addEventListener('change', () => setFiles(fileInput.files));
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  setFiles(event.dataTransfer.files);
});

function headers() {
  const value = accessKey.value.trim();
  if (value) sessionStorage.setItem('excelAccessKey', value);
  return value ? {'X-Access-Key': value} : {};
}

accessKey.value = sessionStorage.getItem('excelAccessKey') || '';

function resetPanels() {
  progressCard.classList.add('hidden');
  resultCard.classList.add('hidden');
  errorCard.classList.add('hidden');
  deleteState.textContent = '';
}

startButton.addEventListener('click', async () => {
  resetPanels();
  if (!selectedFiles.length) {
    errorText.textContent = '请先选择至少一个 Excel、CSV 或 ZIP 文件。';
    errorCard.classList.remove('hidden');
    return;
  }

  const form = new FormData();
  selectedFiles.forEach(file => form.append('files', file));
  form.append('dedupe_key', document.querySelector('#dedupeKey').value);

  startButton.disabled = true;
  progressCard.classList.remove('hidden');
  try {
    const response = await fetch('/api/jobs', {method: 'POST', headers: headers(), body: form});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `服务器错误：${response.status}`);
    currentJob = body;
    renderStats(body.stats);
    progressCard.classList.add('hidden');
    resultCard.classList.remove('hidden');
  } catch (error) {
    progressCard.classList.add('hidden');
    errorText.textContent = error.message || String(error);
    errorCard.classList.remove('hidden');
  } finally {
    startButton.disabled = false;
  }
});

function renderStats(data) {
  const items = [
    ['有效结果', data.result_rows],
    ['原始记录', data.original_rows],
    ['重复记录', data.duplicate_rows],
    ['异常记录', data.anomaly_rows],
    ['成功文件', data.success_files],
    ['失败文件', data.failed_files],
  ];
  stats.innerHTML = items.map(([label, value]) => `
    <div class="stat"><strong>${Number(value || 0).toLocaleString()}</strong><span>${label}</span></div>
  `).join('');
}

async function deleteCloudFiles() {
  if (!currentJob) return;
  const response = await fetch(`/api/jobs/${currentJob.job_id}/confirm-download`, {
    method: 'POST',
    headers: headers(),
    body: new URLSearchParams({token: currentJob.download_token}),
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || '云端文件删除失败，将由超时机制自动清理。');
  }
  currentJob = null;
  downloadButton.disabled = true;
  deleteButton.disabled = true;
  deleteState.textContent = '云端临时文件已删除。';
}

downloadButton.addEventListener('click', async () => {
  if (!currentJob) return;
  downloadButton.disabled = true;
  deleteState.textContent = '正在完整接收文件，请勿关闭页面……';
  try {
    const url = `/api/jobs/${currentJob.job_id}/download?token=${encodeURIComponent(currentJob.download_token)}`;
    const response = await fetch(url, {headers: headers(), cache: 'no-store'});
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || '下载失败');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = '总汇总表.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

    await deleteCloudFiles();
    deleteState.textContent = '下载已发起，云端临时文件已删除。';
  } catch (error) {
    downloadButton.disabled = false;
    deleteState.textContent = error.message || String(error);
  }
});

deleteButton.addEventListener('click', async () => {
  if (!currentJob) return;
  deleteButton.disabled = true;
  try {
    await deleteCloudFiles();
  } catch (error) {
    deleteButton.disabled = false;
    deleteState.textContent = error.message || String(error);
  }
});

window.addEventListener('beforeunload', () => {
  // Server TTL cleanup is the fallback for abandoned jobs.
});
