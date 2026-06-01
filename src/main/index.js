// Note Pilot — Electron main process (M1: transcription pipeline).
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { initAutoUpdate } = require('./autoupdate');

const { dirs, modelPath, vadModelPath, resolveWhisperCli, ensureDir } = require('./paths');
const { decodeToWav, isSupported } = require('./audio');
const { transcribe } = require('./whisper');
const { downloadModel, modelExists, downloadVadModel, vadModelExists,
        downloadWhisperCli } = require('./model');
const { publicSettings, writeConfig, getApiKey, getModel } = require('./config');
const { generate } = require('./generate');
const { buildHtml, transcriptToMarkdown, exportPdf, exportDocx } = require('./export');
const db = require('./db');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    title: 'Note Pilot',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Copy the dropped file into the managed library so the app owns a stable copy.
function adoptAudio(srcPath) {
  const safe = path.basename(srcPath).replace(/[^\w.\- ]/g, '_');
  const dest = path.join(dirs.library(), `${Date.now()}-${safe}`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

// --- IPC: model ---
ipcMain.handle('model:status', () => ({ present: modelExists(), path: modelPath() }));

ipcMain.handle('model:download', async () => {
  await downloadModel((p) => send('model:progress', p));
  return { ok: true };
});

// --- IPC: file picker ---
ipcMain.handle('dialog:pickAudio', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'mp4', 'm4b'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

// --- IPC: the pipeline ---
ipcMain.handle('transcribe:file', async (_evt, { filePath, courseName, lang }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('No file provided.');
    if (!isSupported(filePath)) throw new Error('Unsupported audio format.');

    // 1) Ensure model is present.
    if (!modelExists()) {
      send('transcribe:progress', { stage: 'model', percent: 0, message: 'Downloading model (first run)…' });
      await downloadModel((p) => send('transcribe:progress', {
        stage: 'model', percent: p.percent, message: `Downloading model… ${Math.round(p.percent)}%`,
      }));
    }

    // 1b) Ensure the (tiny) VAD model is present — strips non-speech audio.
    if (!vadModelExists()) {
      send('transcribe:progress', { stage: 'model', percent: 0, message: 'Downloading VAD model…' });
      try {
        await downloadVadModel();
      } catch (e) {
        // Non-fatal: continue without VAD (still uses --suppress-nst).
        console.warn('VAD model download failed, continuing without VAD:', e.message);
      }
    }

    // 1c) Ensure whisper-cli. On a fresh install it isn't present, so download
    // the self-contained bundle (binary + Metal dylibs) from the GitHub Release.
    let whisperCli;
    try {
      whisperCli = resolveWhisperCli();
    } catch (_) {
      send('transcribe:progress', { stage: 'model', percent: 0, message: 'Downloading speech engine (first run)…' });
      await downloadWhisperCli((p) => send('transcribe:progress', {
        stage: 'model', percent: p.percent, message: `Downloading speech engine… ${Math.round(p.percent)}%`,
      }));
      whisperCli = resolveWhisperCli();
    }

    // 2) Adopt + decode audio.
    send('transcribe:progress', { stage: 'decode', percent: 0, message: 'Preparing audio…' });
    const audioPath = adoptAudio(filePath);
    const { wavPath, durationSec } = await decodeToWav(audioPath);

    // 3) Transcribe (timed).
    send('transcribe:progress', { stage: 'transcribe', percent: 0, message: 'Transcribing…' });
    const useVad = vadModelExists();
    const t0 = Date.now();
    const result = await transcribe({
      wavPath, modelPath: modelPath(), whisperCli, lang: lang || 'auto',
      vadModelPath: useVad ? vadModelPath() : null,
      onProgress: (pct) => send('transcribe:progress', {
        stage: 'transcribe', percent: pct, message: `Transcribing… ${pct}%`,
      }),
    });
    const transcribeMs = Date.now() - t0;

    // 4) Persist.
    send('transcribe:progress', { stage: 'save', percent: 100, message: 'Saving…' });
    const title = path.basename(filePath, path.extname(filePath));
    const lectureId = db.saveLecture({
      courseName: courseName || 'Uncategorized',
      title, lang: result.language, audioPath, durationSec, segments: result.segments,
    });

    try { fs.unlinkSync(wavPath); } catch (_) { /* temp cleanup */ }

    return {
      ok: true, lectureId, language: result.language,
      segmentCount: result.segments.length, transcribeMs, usedVad: useVad,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// --- IPC: library ---
ipcMain.handle('library:list', () => db.listLectures());
ipcMain.handle('lecture:get', (_evt, id) => db.getLecture(id));

// --- IPC: courses ---
ipcMain.handle('courses:list', () => db.listCourses());
ipcMain.handle('course:create', (_evt, name) => db.createCourse(name));
ipcMain.handle('course:rename', (_evt, { id, name }) => db.renameCourse(id, name));
ipcMain.handle('course:delete', (_evt, id) => db.deleteCourse(id));

// --- IPC: lecture lifecycle ---
ipcMain.handle('lecture:rename', (_evt, { id, title }) => db.renameLecture(id, title));
ipcMain.handle('lecture:move', (_evt, { id, courseId }) => db.moveLecture(id, courseId));
ipcMain.handle('lecture:delete', (_evt, id) => {
  const audioPath = db.deleteLecture(id);            // removes DB rows (segments cascade)
  if (audioPath) { try { fs.unlinkSync(audioPath); } catch (_) { /* file already gone */ } }
  return { ok: true };
});

// --- IPC: settings ---
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:setKey', (_evt, key) => {
  writeConfig({ openRouterKey: (key || '').trim() });
  return publicSettings();
});

// --- IPC: export (PDF / DOCX) ---
ipcMain.handle('export:run', async (_evt, { lectureId, kind, format }) => {
  try {
    const lec = db.getLecture(lectureId);
    if (!lec) throw new Error('Lecture not found.');

    let markdown;
    if (kind === 'summary') markdown = lec.summary;
    else if (kind === 'notes') markdown = lec.notes;
    else if (kind === 'transcript') markdown = transcriptToMarkdown(lec.segments);
    else throw new Error(`Unknown export kind: ${kind}`);
    if (!markdown) throw new Error(`No ${kind} to export — generate it first.`);

    const ext = format === 'pdf' ? 'pdf' : 'docx';
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    const safe = (lec.title || 'lecture').replace(/[^\w.\- ]/g, '_');
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${safe} — ${label}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };

    const html = buildHtml({ title: lec.title, subtitle: label, markdown });
    if (format === 'pdf') await exportPdf(html, res.filePath);
    else await exportDocx(html, res.filePath);
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// --- IPC: generation (Summary / Notes) ---
ipcMain.handle('generate:run', async (_evt, { lectureId, type }) => {
  try {
    const lec = db.getLecture(lectureId);
    if (!lec) throw new Error('Lecture not found.');
    const markdown = await generate({
      segments: lec.segments, type,
      apiKey: getApiKey(), model: getModel(), lang: lec.lang || 'es',
      onProgress: (p) => send('generate:progress', { type, ...p }),
    });
    db.saveGeneration(lectureId, type, markdown);
    return { ok: true, markdown };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => {
  ensureDir(app.getPath('userData'));
  db.init();
  createWindow();
  initAutoUpdate(send); // silent auto-update in packaged signed builds
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
