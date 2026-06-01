// Central place for app directories and external binary locations.
// electron is required lazily so pure helpers (and unit tests) can import this
// module without an Electron runtime.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function getApp() {
  // eslint-disable-next-line global-require
  return require('electron').app;
}

const MODEL_FILE = 'ggml-large-v3-turbo.bin';
const VAD_MODEL_FILE = 'ggml-silero-v5.1.2.bin';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function userData() {
  return getApp().getPath('userData');
}

const dirs = {
  models: () => ensureDir(path.join(userData(), 'models')),
  library: () => ensureDir(path.join(userData(), 'library')), // stored audio copies
  whisper: () => ensureDir(path.join(userData(), 'whisper')), // downloaded whisper-cli + dylibs
  db: () => path.join(ensureDir(userData()), 'note-pilot.db'),
};

function whisperCliPath() {
  return path.join(dirs.whisper(), 'whisper-cli');
}

function modelPath() {
  return path.join(dirs.models(), MODEL_FILE);
}

function vadModelPath() {
  return path.join(dirs.models(), VAD_MODEL_FILE);
}

// whisper-cli is not yet bundled (that's M5/packaging). For M1 we resolve it
// from, in order: an explicit env var, the M0 spike build, or PATH (brew).
function resolveWhisperCli() {
  const appPath = getApp().getAppPath();
  const candidates = [
    process.env.WHISPER_CLI,
    whisperCliPath(),                 // first-run auto-downloaded bundle (end users)
    path.join(appPath, '.spike-whisper', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
    path.join(appPath, '.spike-whisper', 'whisper.cpp', 'build', 'bin', 'main'),
    '/opt/homebrew/bin/whisper-cli', // brew install whisper-cpp (dev)
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch (_) { /* ignore */ }
  }
  // Last resort: rely on PATH.
  try {
    const found = execFileSync('which', ['whisper-cli'], { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch (_) { /* not on PATH */ }

  throw new Error(
    'whisper-cli not found. Build it via the M0 spike (npm run spike:whisper) ' +
    'or `brew install whisper-cpp`, or set WHISPER_CLI to its path.'
  );
}

// ffmpeg ships as a prebuilt binary via the ffmpeg-static package.
function resolveFfmpeg() {
  // eslint-disable-next-line global-require
  let ffmpegPath = require('ffmpeg-static');
  // In a packaged app the path lands inside app.asar; ffmpeg-static handles the
  // unpacked path, but guard the common asar case just in case.
  if (ffmpegPath && ffmpegPath.includes('app.asar') && !ffmpegPath.includes('app.asar.unpacked')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error('ffmpeg-static binary not found. Run `npm install`.');
  }
  return ffmpegPath;
}

module.exports = {
  MODEL_FILE, VAD_MODEL_FILE, dirs, modelPath, vadModelPath, whisperCliPath,
  resolveWhisperCli, resolveFfmpeg, ensureDir,
};
