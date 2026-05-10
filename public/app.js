const state = {
  jobs: new Map(),
  events: new Map(),
  lastResolve: null,
  busy: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  queryForm: $('#queryForm'),
  queryInput: $('#queryInput'),
  processBtn: $('#processBtn'),
  settingsBtn: $('#settingsBtn'),
  authBtn: $('#authBtn'),
  topProgress: $('#topProgress'),
  emptyState: $('#emptyState'),
  downloadList: $('#downloadList'),
  downloadRows: $('#downloadRows'),
  modalLayer: $('#modalLayer'),
  modalCard: $('#modalCard'),
  toast: $('#toast')
};

function setBusy(value) {
  state.busy = value;
  els.processBtn.disabled = value;
  els.queryInput.disabled = value;
  els.topProgress.classList.toggle('busy', value);
}

function showToast(message, timeout = 3200) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), timeout);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
}

function api(path, options = {}) {
  return fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(async response => {
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(payload?.error || payload || `Request failed with status ${response.status}`);
    }
    return payload;
  });
}

function resizeTextarea() {
  const input = els.queryInput;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
}

function closeModal() {
  els.modalLayer.classList.add('hidden');
  els.modalLayer.setAttribute('aria-hidden', 'true');
  els.modalCard.innerHTML = '';
}

function openModal(fragment) {
  els.modalCard.innerHTML = '';
  els.modalCard.appendChild(fragment);
  els.modalLayer.classList.remove('hidden');
  els.modalLayer.setAttribute('aria-hidden', 'false');
  $$('[data-close]', els.modalCard).forEach(btn => btn.addEventListener('click', closeModal));
}

function option(label, value, selected = false) {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  item.selected = selected;
  return item;
}

function qualityLabel(value) {
  if (value === 'highest') return 'Highest';
  if (value === 'audio') return 'Audio only';
  return `${value}p`;
}

function statusText(job) {
  if (job.status === 'completed') return '✓ Done';
  if (job.status === 'failed') return job.error ? 'Failed — details' : 'Failed';
  if (job.status === 'canceled') return 'Canceled';
  if (job.status === 'queued') return 'Queued';
  const parts = [`${Math.round(job.progress || 0)}%`];
  if (job.speed) parts.push(job.speed);
  if (job.eta) parts.push(`ETA ${job.eta}`);
  return parts.join(' · ');
}

function statusClass(job) {
  return `status-${job.status || 'queued'}`;
}

function thumbnailHtml(job) {
  if (job.thumbnail) {
    return `<img class="thumb" src="${escapeHtml(job.thumbnail)}" alt="">`;
  }
  return `<div class="thumb"></div>`;
}

function addOrUpdateJob(job) {
  state.jobs.set(job.id, job);
  renderJobs();
}

function renderJobs() {
  const jobs = [...state.jobs.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  els.emptyState.classList.toggle('hidden', jobs.length > 0);
  els.downloadList.classList.toggle('hidden', jobs.length === 0);

  els.downloadRows.innerHTML = jobs.map(job => `
    <div class="download-row" data-job-id="${job.id}">
      <div>${thumbnailHtml(job)}</div>
      <div class="file-cell">
        <div class="file-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</div>
        <div class="file-subtitle">${escapeHtml(job.container?.toUpperCase() || '')} · ${escapeHtml(qualityLabel(job.quality || 'highest'))}</div>
      </div>
      <div class="status-cell">
        <span class="ring" style="--pct:${Math.max(0, Math.min(100, Number(job.progress || 0)))}"></span>
        <span class="status-text ${statusClass(job)} ${job.status === 'failed' ? 'clickable' : ''}" ${job.status === 'failed' ? 'data-action="details"' : ''} title="${escapeHtml(job.error || job.message || '')}">${escapeHtml(statusText(job))}</span>
      </div>
      <div class="action-row">
        <button class="row-btn" data-action="file" title="Download completed file" ${job.hasFile ? '' : 'disabled'}>⌕</button>
        <button class="row-btn" data-action="open" title="Open completed file" ${job.hasFile ? '' : 'disabled'}>▶</button>
        ${['queued', 'started'].includes(job.status)
          ? '<button class="row-btn" data-action="cancel" title="Cancel download">✕</button>'
          : '<button class="row-btn" data-action="restart" title="Restart download">↻</button>'}
        <button class="row-btn" data-action="remove" title="Remove from list">🗑</button>
      </div>
    </div>
  `).join('');
}

function showJobDetails(job) {
  const node = document.createElement('div');
  node.className = 'error-panel';
  const detail = job.error || job.message || 'No error details were returned.';
  node.innerHTML = `
    <button class="modal-x" data-close="1">×</button>
    <h2>Download failed</h2>
    <p class="error-title">${escapeHtml(job.title || 'Untitled video')}</p>
    <pre>${escapeHtml(detail)}</pre>
    <div class="fix-card">
      <strong>Common fixes</strong>
      <p>Update yt-dlp, install FFmpeg, then restart the Node server. For private, age-restricted, or bot-check videos, start with cookies.</p>
      <code>python -m pip install -U yt-dlp</code>
      <code>choco install ffmpeg</code>
      <code>set YTDLP_COOKIES_FROM_BROWSER=chrome && npm start</code>
    </div>
    <div class="button-row right">
      <button class="outline-btn primary" data-close="1">Close</button>
    </div>
  `;
  openModal(node);
}

function subscribeToJob(jobId) {
  if (state.events.has(jobId)) return;
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  state.events.set(jobId, source);
  source.onmessage = event => {
    const job = JSON.parse(event.data);
    addOrUpdateJob(job);
    if (['completed', 'failed', 'canceled'].includes(job.status)) {
      source.close();
      state.events.delete(job.id);
      if (job.status === 'completed') showToast(`Completed: ${job.title}`);
      if (job.status === 'failed') showToast(job.error || `Failed: ${job.title}`, 7500);
    }
  };
  source.onerror = () => {
    source.close();
    state.events.delete(jobId);
  };
}

async function startDownload(video, container, quality) {
  const job = await api('/api/download', {
    method: 'POST',
    body: {
      url: video.url,
      title: video.title,
      thumbnail: video.thumbnail,
      container,
      quality
    }
  });
  addOrUpdateJob(job);
  subscribeToJob(job.id);
}

function showSingleModal(result) {
  const template = $('#singleModalTemplate');
  const node = template.content.cloneNode(true);
  const video = result.video;

  $('[data-title]', node).textContent = video.title || 'Untitled video';
  $('[data-author]', node).textContent = video.author || 'Unknown';
  $('[data-duration]', node).textContent = video.duration || 'Live';
  $('[data-thumbnail]', node).src = video.thumbnail || '';

  const select = $('[data-format]', node);
  const options = result.options?.length ? result.options : [
    { label: 'Highest MP4', container: 'mp4', quality: 'highest' },
    { label: '720p MP4', container: 'mp4', quality: '720' },
    { label: 'Audio MP3', container: 'mp3', quality: 'audio' }
  ];
  for (const item of options) {
    select.appendChild(option(item.label, `${item.container}:${item.quality}`));
  }

  $('[data-download]', node).addEventListener('click', async () => {
    const [container, quality] = select.value.split(':');
    closeModal();
    try {
      await startDownload(video, container, quality);
      showToast('Download queued');
    } catch (error) {
      showToast(error.message, 6000);
    }
  });

  openModal(node);
}

function showMultipleModal(result) {
  const template = $('#multipleModalTemplate');
  const node = template.content.cloneNode(true);
  const videos = result.videos || [];
  const selected = new Set(videos.map((_, index) => index));

  $('[data-title]', node).textContent = result.title || 'Videos';
  const countText = $('[data-count]', node);
  const containerSelect = $('[data-container]', node);
  const qualitySelect = $('[data-quality]', node);
  const list = $('[data-videos]', node);
  const downloadBtn = $('[data-download]', node);

  function updateCount() {
    countText.textContent = `${selected.size} of ${videos.length} selected`;
    downloadBtn.textContent = `Download (${selected.size})`;
    downloadBtn.disabled = selected.size === 0;
  }

  for (const c of result.containers || ['mp4', 'webm', 'mp3']) {
    containerSelect.appendChild(option(c.toUpperCase(), c, c === 'mp4'));
  }

  function fillQuality() {
    const container = containerSelect.value;
    qualitySelect.innerHTML = '';
    if (container === 'mp3') {
      qualitySelect.appendChild(option('Audio only', 'audio'));
      qualitySelect.disabled = true;
    } else {
      qualitySelect.disabled = false;
      for (const q of result.qualities || ['highest', '1080', '720', '480', '360']) {
        qualitySelect.appendChild(option(qualityLabel(q), q));
      }
    }
  }

  videos.forEach((video, index) => {
    const row = document.createElement('label');
    row.className = 'video-choice selected';
    row.innerHTML = `
      <input type="checkbox" checked>
      <img src="${escapeHtml(video.thumbnail || '')}" alt="">
      <span>
        <span class="choice-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</span>
        <span class="choice-meta"><span>👤 ${escapeHtml(video.author || 'Unknown')}</span><span>◷ ${escapeHtml(video.duration || 'Live')}</span></span>
      </span>
      <span class="checkmark">✓</span>
    `;
    const checkbox = $('input', row);
    row.addEventListener('change', () => {
      if (checkbox.checked) selected.add(index);
      else selected.delete(index);
      row.classList.toggle('selected', checkbox.checked);
      updateCount();
    });
    list.appendChild(row);
  });

  containerSelect.addEventListener('change', fillQuality);
  fillQuality();
  updateCount();

  downloadBtn.addEventListener('click', async () => {
    const chosen = [...selected].map(i => videos[i]).filter(Boolean);
    const container = containerSelect.value;
    const quality = container === 'mp3' ? 'audio' : qualitySelect.value;
    closeModal();
    try {
      await Promise.all(chosen.map(video => startDownload(video, container, quality)));
      showToast(`${chosen.length} download${chosen.length === 1 ? '' : 's'} queued`);
    } catch (error) {
      showToast(error.message, 6000);
    }
  });

  openModal(node);
}

async function resolveQuery(query) {
  setBusy(true);
  try {
    const result = await api('/api/resolve', { method: 'POST', body: { query } });
    state.lastResolve = result;
    if (result.type === 'single') showSingleModal(result);
    else showMultipleModal(result);
  } catch (error) {
    showToast(error.message, 6500);
  } finally {
    setBusy(false);
  }
}

async function loadJobs() {
  try {
    const jobs = await api('/api/jobs');
    jobs.forEach(addOrUpdateJob);
    jobs.filter(job => ['queued', 'started'].includes(job.status)).forEach(job => subscribeToJob(job.id));
  } catch {}
}

async function showSettingsModal() {
  const template = $('#settingsModalTemplate');
  const node = template.content.cloneNode(true);
  openModal(node);

  const refresh = async () => {
    const box = $('#healthBox');
    box.className = 'health-box loading';
    box.textContent = 'Checking backend...';
    try {
      const health = await api('/api/health');
      const yt = health.ytDlp ? `${health.ytDlp.command} ${health.ytDlp.prefixArgs?.join(' ') || ''}`.trim() : 'Not found';
      box.className = `health-box ${health.ok ? 'ok' : 'bad'}`;
      box.innerHTML = `
        <strong>${health.ok ? 'Backend ready' : 'Backend needs setup'}</strong><br>
        yt-dlp: ${escapeHtml(yt)} ${health.ytDlp?.version ? `(${escapeHtml(health.ytDlp.version)})` : ''}<br>
        FFmpeg: ${health.ffmpeg ? 'Available' : 'Not detected'}<br>
        Demo mode: ${health.demoMode ? 'On' : 'Off'}<br>
        Downloads folder: <code>${escapeHtml(health.downloadsDir || 'downloads')}</code><br>
        ${health.note ? `<span>${escapeHtml(health.note)}</span>` : ''}
      `;
    } catch (error) {
      box.className = 'health-box bad';
      box.textContent = error.message;
    }
  };

  $('#refreshHealthBtn').addEventListener('click', refresh);
  refresh();
}

async function handleRowAction(row, action) {
  const id = row.dataset.jobId;
  const job = state.jobs.get(id);
  if (!job) return;

  try {
    if (action === 'details') {
      showJobDetails(job);
      return;
    }
    if (action === 'file' || action === 'open') {
      if (job.hasFile) window.open(`/api/jobs/${id}/file`, '_blank');
    }
    if (action === 'cancel') {
      const updated = await api(`/api/jobs/${id}/cancel`, { method: 'POST' });
      addOrUpdateJob(updated);
    }
    if (action === 'restart') {
      const newJob = await api(`/api/jobs/${id}/restart`, { method: 'POST' });
      addOrUpdateJob(newJob);
      subscribeToJob(newJob.id);
    }
    if (action === 'remove') {
      if (state.events.has(id)) {
        state.events.get(id).close();
        state.events.delete(id);
      }
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      state.jobs.delete(id);
      renderJobs();
    }
  } catch (error) {
    showToast(error.message, 6000);
  }
}

els.queryInput.addEventListener('input', resizeTextarea);
els.queryInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    els.queryForm.requestSubmit();
  }
});

els.queryForm.addEventListener('submit', event => {
  event.preventDefault();
  const query = els.queryInput.value.trim();
  if (!query) {
    showToast('Paste a video URL, playlist/channel URL, or search keywords.');
    return;
  }
  resolveQuery(query);
});

els.settingsBtn.addEventListener('click', showSettingsModal);
els.authBtn.addEventListener('click', () => {
  showToast('For auth/private content, set YTDLP_COOKIES_FILE or YTDLP_COOKIES_FROM_BROWSER before starting the server.', 6500);
});

els.modalLayer.addEventListener('click', event => {
  if (event.target === els.modalLayer) closeModal();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !els.modalLayer.classList.contains('hidden')) closeModal();
});

els.downloadRows.addEventListener('click', event => {
  const btn = event.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const row = btn.closest('[data-job-id]');
  handleRowAction(row, btn.dataset.action);
});

resizeTextarea();
loadJobs();

api('/api/health')
  .then(health => {
    if (!health.ok) {
      showToast('yt-dlp was not found. Open Settings for setup instructions.', 6500);
    }
  })
  .catch(() => {});
