// Renderer: transcribe pipeline + course-organized library with lifecycle actions.
const api = window.notePilot;
const $ = (id) => document.getElementById(id);

const fill = $('fill');
const statusEl = $('status');
const chosen = $('chosen');

let courses = [];
let lectures = [];
let selectedId = null;
let activeTab = 'transcript';

// ---------- helpers ----------
function fmtTime(ms) {
  if (ms == null) return '--:--';
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtElapsed(totalSec) {
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}
function setProgress(pct) { fill.style.width = `${Math.max(0, Math.min(100, pct))}%`; }
function setStatus(msg) { statusEl.textContent = msg || ''; }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
// renderMarkdown is provided globally by markdown.js (loaded before this script).

// modal text prompt (Electron disables window.prompt)
function askText(title, initial = '') {
  return new Promise((resolve) => {
    $('modalTitle').textContent = title;
    const input = $('modalInput');
    input.value = initial;
    $('overlay').classList.remove('hidden');
    input.focus(); input.select();
    const done = (val) => {
      $('overlay').classList.add('hidden');
      $('modalOk').onclick = null; $('modalCancel').onclick = null; input.onkeydown = null;
      resolve(val);
    };
    $('modalOk').onclick = () => done(input.value.trim() || null);
    $('modalCancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    };
  });
}

// ---------- live timer (transcription phase only) ----------
let timerId = null, tStart = 0, currentPct = 0;
function startTimer() {
  if (timerId) return;
  tStart = Date.now();
  timerId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - tStart) / 1000);
    setStatus(`Transcribing… ${currentPct}% · ${fmtElapsed(elapsed)}`);
  }, 1000);
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

// ---------- model note ----------
async function refreshModelNote() {
  const m = await api.modelStatus();
  $('modelNote').textContent = m.present ? 'model ready' : 'model downloads on first transcription';
}

// ---------- library rendering ----------
async function refreshLibrary() {
  [courses, lectures] = await Promise.all([api.listCourses(), api.listLectures()]);
  const wrap = $('courses');
  wrap.innerHTML = '';
  if (!lectures.length && courses.length <= 1) {
    wrap.innerHTML = '<small style="color:var(--muted)">No lectures yet.</small>';
  }
  for (const c of courses) {
    const inCourse = lectures.filter((l) => l.courseId === c.id);
    if (c.name === 'Uncategorized' && inCourse.length === 0 && courses.length > 1) continue;

    const group = document.createElement('div');
    group.className = 'course';
    const isUncat = c.name === 'Uncategorized';
    group.innerHTML = `
      <div class="course-hd">
        <span class="name">${esc(c.name)}</span>
        <span class="count">${inCourse.length}</span>
        <span class="course-actions">
          ${isUncat ? '' : `<button class="link" data-act="rename-course" data-id="${c.id}">edit</button>
                            <button class="link danger" data-act="delete-course" data-id="${c.id}">del</button>`}
        </span>
      </div>`;
    for (const l of inCourse) {
      const mins = l.durationSec ? `${Math.round(l.durationSec / 60)} min` : '';
      const row = document.createElement('div');
      row.className = 'lect' + (l.id === selectedId ? ' active' : '');
      row.dataset.id = l.id;
      row.innerHTML = `${esc(l.title)}<small>${(l.lang || '').toUpperCase()} ${mins}</small>`;
      row.onclick = () => openLecture(l.id);
      group.appendChild(row);
    }
    wrap.appendChild(group);
  }

  // course action buttons
  wrap.querySelectorAll('[data-act="rename-course"]').forEach((b) =>
    b.onclick = async (e) => {
      e.stopPropagation();
      const name = await askText('Rename course', courses.find((c) => c.id == b.dataset.id)?.name);
      if (name) { await api.renameCourse(+b.dataset.id, name); refreshLibrary(); }
    });
  wrap.querySelectorAll('[data-act="delete-course"]').forEach((b) =>
    b.onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Delete this course? Its lectures move to Uncategorized.')) {
        await api.deleteCourse(+b.dataset.id); refreshLibrary();
      }
    });
}

// ---------- detail ----------
function setTab(tab) {
  activeTab = tab;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === tab);
  for (const name of ['transcript', 'summary', 'notes'])
    $(`tab-${name}`).classList.toggle('hidden', name !== tab);
}

function populateMoveSelect(currentCourseId) {
  const sel = $('moveCourse');
  sel.innerHTML = '';
  for (const c of courses) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name; if (c.id === currentCourseId) o.selected = true;
    sel.appendChild(o);
  }
}

let currentLecture = null;

function renderGen(type, markdown) {
  const out = $(`out-${type}`);
  const btn = document.querySelector(`.gen[data-type="${type}"]`);
  if (markdown) {
    out.innerHTML = renderMarkdown(markdown);
    btn.textContent = type === 'summary' ? 'Regenerate summary' : 'Regenerate notes';
  } else {
    out.innerHTML = `<div class="empty">Not generated yet.</div>`;
    btn.textContent = type === 'summary' ? 'Generate summary' : 'Generate notes';
  }
}

// ---------- synced audio player ----------
const player = $('player');
let currentBlobUrl = null;
let lastPlayingRow = null;

async function setupAudio(lectureId) {
  player.pause();
  lastPlayingRow = null;
  if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  player.classList.add('hidden');
  const r = await api.loadAudio(lectureId);
  if (!r || !r.ok) return; // no audio → player stays hidden
  currentBlobUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
  player.src = currentBlobUrl;
  player.classList.remove('hidden');
}

function seekTo(ms) {
  if (ms == null || !currentBlobUrl) return;
  player.currentTime = ms / 1000;
  player.play().catch(() => {});
}

function highlightAt(ms) {
  if (!currentLecture || !currentLecture.segments) return;
  const segs = currentLecture.segments;
  let idx = -1;
  for (let i = 0; i < segs.length; i++) {
    const f = segs[i].fromMs; const t = segs[i].toMs;
    if (f != null && ms >= f && (t == null || ms < t)) { idx = i; break; }
  }
  if (idx === -1) return;
  const row = $('segments').querySelector(`.seg[data-i="${idx}"]`);
  if (!row || row === lastPlayingRow) return;
  if (lastPlayingRow) lastPlayingRow.classList.remove('playing');
  row.classList.add('playing');
  row.scrollIntoView({ block: 'nearest' });
  lastPlayingRow = row;
}
player.ontimeupdate = () => highlightAt(player.currentTime * 1000);

async function openLecture(id) {
  const lec = await api.getLecture(id);
  if (!lec) return;
  selectedId = id;
  currentLecture = lec;
  $('detail').classList.remove('hidden');
  $('detailTitle').textContent = lec.title;
  populateMoveSelect(lec.course_id);
  setTab('transcript');

  setupAudio(id); // load audio into the player (async, non-blocking)
  const wrap = $('segments');
  wrap.innerHTML = '';
  if (!lec.segments.length) { wrap.innerHTML = '<div class="empty">No transcript.</div>'; }
  lec.segments.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'seg';
    row.dataset.i = i;
    row.title = 'Click to play from here';
    row.innerHTML = `<span class="ts">${fmtTime(s.fromMs)}</span><span>${esc(s.text)}</span>`;
    row.onclick = () => seekTo(s.fromMs);
    wrap.appendChild(row);
  });
  renderGen('summary', lec.summary);
  renderGen('notes', lec.notes);
  document.querySelectorAll('.gen-status').forEach((el) => (el.textContent = ''));
  // highlight in sidebar
  document.querySelectorAll('.lect').forEach((el) => el.classList.toggle('active', +el.dataset.id === id));
}

// ---------- transcription pipeline ----------
let busy = false;
async function run(filePath) {
  if (busy || !filePath) return;
  busy = true; setProgress(0);
  chosen.textContent = filePath.split('/').pop(); chosen.classList.remove('hidden');

  const res = await api.transcribeFile({ filePath, lang: $('lang').value, courseName: 'Uncategorized' });
  busy = false; stopTimer();

  if (!res.ok) { setStatus('Error: ' + res.error); setProgress(0); return; }
  setProgress(100);
  const took = res.transcribeMs ? ` in ${fmtElapsed(Math.round(res.transcribeMs / 1000))}` : '';
  setStatus(`Done${took} — ${res.segmentCount} segments (${(res.language || '').toUpperCase()}).`);
  await refreshLibrary();
  await openLecture(res.lectureId);
}

// ---------- event wiring ----------
api.onTranscribeProgress((p) => {
  setProgress(p.percent || 0);
  if (p.stage === 'transcribe') { currentPct = Math.round(p.percent || 0); startTimer(); }
  else { stopTimer(); setStatus(p.message || ''); }
});

// tabs
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => setTab(t.dataset.tab));

// detail actions
$('renameLect').onclick = async () => {
  if (!selectedId) return;
  const cur = lectures.find((l) => l.id === selectedId)?.title || '';
  const name = await askText('Rename lecture', cur);
  if (name) { await api.renameLecture(selectedId, name); await refreshLibrary(); $('detailTitle').textContent = name; }
};
$('deleteLect').onclick = async () => {
  if (!selectedId) return;
  if (confirm('Delete this lecture and its audio? This cannot be undone.')) {
    await api.deleteLecture(selectedId);
    selectedId = null; $('detail').classList.add('hidden');
    await refreshLibrary();
  }
};
$('moveCourse').onchange = async (e) => {
  if (!selectedId) return;
  await api.moveLecture(selectedId, +e.target.value);
  await refreshLibrary();
};
$('newCourse').onclick = async () => {
  const name = await askText('New course');
  if (name) { await api.createCourse(name); refreshLibrary(); }
};

// settings: friendly OpenRouter key dialog
const settingsOverlay = $('settingsOverlay');
async function openSettings() {
  const s = await api.getSettings();
  const status = $('keyStatus');
  const removeBtn = $('settingsRemove');
  const getRow = $('getKeyRow');
  if (s.hasKey && s.keyHint === 'from env') {
    status.className = 'key-status set';
    status.textContent = 'Using a key from your environment (OPENROUTER_API_KEY). Enter a key below to override it.';
    removeBtn.classList.add('hidden');
    getRow.classList.add('hidden');
  } else if (s.hasKey) {
    status.className = 'key-status set';
    status.textContent = `A key is saved (ending ${s.keyHint}). Enter a new key to replace it, or remove it.`;
    removeBtn.classList.remove('hidden');
    getRow.classList.add('hidden');
  } else {
    status.className = 'key-status none';
    status.textContent = 'No API key set yet — you need one to generate summaries and notes.';
    removeBtn.classList.add('hidden');
    getRow.classList.remove('hidden');
  }
  const input = $('settingsKey');
  input.value = ''; input.type = 'password';
  $('settingsShow').checked = false;
  settingsOverlay.classList.remove('hidden');
  input.focus();

  populateModels(s.model);
}

// Fill the model dropdown from OpenRouter's free models (no key needed).
async function populateModels(currentModel) {
  const sel = $('settingsModel');
  // reset to just the Auto option
  [...sel.querySelectorAll('optgroup, option:not([value="openrouter/free"])')].forEach((o) => o.remove());
  const models = await api.listModels();
  const byProvider = {};
  for (const m of models) (byProvider[m.provider] ||= []).push(m);
  for (const prov of Object.keys(byProvider)) {
    const og = document.createElement('optgroup');
    og.label = prov;
    for (const m of byProvider[prov]) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name + (m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}k ctx` : '');
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  // Preserve a previously-saved model even if it's not in the current free list.
  if (currentModel && currentModel !== 'openrouter/free'
      && ![...sel.options].some((o) => o.value === currentModel)) {
    const o = document.createElement('option');
    o.value = currentModel; o.textContent = `${currentModel} (saved)`;
    sel.appendChild(o);
  }
  sel.value = currentModel || 'openrouter/free';
}
function closeSettings() { settingsOverlay.classList.add('hidden'); }

$('settingsBtn').onclick = openSettings;
$('settingsCancel').onclick = closeSettings;
$('settingsShow').onchange = (e) => { $('settingsKey').type = e.target.checked ? 'text' : 'password'; };
$('getKeyLink').onclick = (e) => { e.preventDefault(); api.openExternal('https://openrouter.ai/keys'); };
$('settingsSave').onclick = async () => {
  const v = $('settingsKey').value.trim();
  if (v && !v.startsWith('sk-or-')) {
    const st = $('keyStatus');
    st.className = 'key-status none';
    st.textContent = 'That doesn’t look like an OpenRouter key — it should start with “sk-or-”. Paste only the key (tip: tick “Show key”).';
    return; // keep the dialog open
  }
  if (v) await api.setApiKey(v);
  await api.setModel($('settingsModel').value);
  setStatus('Settings saved.');
  closeSettings();
};
$('settingsRemove').onclick = async () => {
  await api.setApiKey('');
  setStatus('API key removed.');
  closeSettings();
};
$('settingsKey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('settingsSave').click();
  if (e.key === 'Escape') closeSettings();
});

// generation buttons (Summary / Notes)
let generating = false;
document.querySelectorAll('.gen').forEach((btn) => {
  btn.onclick = async () => {
    if (generating || !selectedId) return;
    const type = btn.dataset.type;
    const s = await api.getSettings();
    if (!s.hasKey) { await askSetKey(); return; }

    const statusEl2 = document.querySelector(`.gen-status[data-type="${type}"]`);
    const spinner = document.querySelector(`.spinner[data-type="${type}"]`);
    const out = $(`out-${type}`);
    const setBusy = (on) => {
      generating = on;
      spinner.classList.toggle('hidden', !on);
      document.querySelectorAll('.gen').forEach((b) => (b.disabled = on));
      out.classList.toggle('loading', on);
    };

    setBusy(true);
    statusEl2.textContent = 'Starting…';
    const res = await api.generate(selectedId, type);
    setBusy(false);

    if (!res.ok) { statusEl2.textContent = 'Error: ' + res.error; return; }
    statusEl2.textContent = 'Done.';
    renderGen(type, res.markdown);
    if (currentLecture) currentLecture[type] = res.markdown;
  };
});

// export current tab to PDF/DOCX
async function runExport(format) {
  if (!selectedId) return;
  const es = $('exportStatus');
  es.textContent = `Exporting ${activeTab} to ${format.toUpperCase()}…`;
  const res = await api.exportDoc(selectedId, activeTab, format);
  if (res.canceled) { es.textContent = ''; return; }
  es.textContent = res.ok ? `Saved: ${res.path.split('/').pop()}` : `Error: ${res.error}`;
}
$('exportPdf').onclick = () => runExport('pdf');
$('exportDocx').onclick = () => runExport('docx');

async function askSetKey() {
  await openSettings(); // opens the friendly Settings dialog; user saves then clicks Generate again
}

api.onGenerateProgress((p) => {
  const el = document.querySelector(`.gen-status[data-type="${p.type}"]`);
  if (!el) return;
  if (p.phase === 'map') el.textContent = `Summarizing chunk ${p.done + 1}/${p.total}…`;
  else if (p.phase === 'reduce') el.textContent = `Merging ${p.total} parts…`;
  else if (p.phase === 'done') el.textContent = 'Done.';
});

// drag + drop
const drop = $('drop');
['dragover', 'dragenter'].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('hot'); }));
['dragleave', 'drop'].forEach((e) =>
  drop.addEventListener(e, () => drop.classList.remove('hot')));
drop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const file = ev.dataTransfer.files[0];
  if (file) run(api.pathForFile(file));
});
drop.addEventListener('click', async () => { const p = await api.pickAudio(); if (p) run(p); });

// ---------- auto-update (electron-updater) ----------
const updBanner = $('updateBanner');
const updText = $('updateText');
const updRestart = $('updateRestart');
$('updateDismiss').onclick = () => updBanner.classList.add('hidden');
api.onUpdateAvailable((p) => {
  updBanner.classList.remove('hidden');
  updText.textContent = `Downloading update ${p.version}…`;
});
api.onUpdateProgress((p) => {
  updBanner.classList.remove('hidden');
  updText.textContent = `Downloading update… ${p.percent}%`;
});
api.onUpdateReady((p) => {
  updBanner.classList.remove('hidden');
  updText.textContent = `Update ${p.version} ready.`;
  updRestart.classList.remove('hidden');
  updRestart.onclick = () => api.installUpdate();
});

refreshModelNote();
refreshLibrary();
