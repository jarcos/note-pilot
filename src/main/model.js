// Model downloads (whisper large-v3-turbo + silero VAD).
// Streams to a .part file, resumes interrupted downloads via HTTP Range,
// follows redirects (HuggingFace -> CDN), then verifies size before finalizing.
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const path = require('path');
const { URL } = require('url');
const { modelPath, vadModelPath, whisperCliPath, dirs } = require('./paths');

const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';
const VAD_MODEL_URL =
  'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin';

// Self-contained whisper-cli bundle (binary + Metal/ggml dylibs, rpath-fixed),
// hosted as a GitHub Release asset and built via scripts/package-whisper.sh.
// `releases/latest/download/...` always resolves to the newest release.
// Override with NOTEPILOT_WHISPER_URL if your repo path differs.
const WHISPER_CLI_URL = process.env.NOTEPILOT_WHISPER_URL
  || 'https://github.com/jarcos/note-pilot/releases/latest/download/whisper-cli-macos-arm64.tar.gz';

// SHA-256 integrity pins for the (stable, versioned) model files. When set, a
// download whose hash doesn't match is rejected. Leave null to fall back to a
// size check. Populate via: bash scripts/compute-model-hashes.sh
const MODEL_SHA256 = null; // ggml-large-v3-turbo.bin
const VAD_SHA256 = null;   // ggml-silero-v5.1.2.bin

function fileBigEnough(p, minBytes) {
  try { return fs.statSync(p).size >= minBytes; } catch { return false; }
}

function httpGet(url, headers, onResponse, onError) {
  const u = new URL(url);
  const req = https.get(
    { hostname: u.hostname, path: u.pathname + u.search, headers },
    (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return httpGet(res.headers.location, headers, onResponse, onError);
      }
      onResponse(res);
    }
  );
  req.on('error', onError);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Generic resumable download with progress.
 * @returns {Promise<string>} final path
 */
function downloadFile({ url, finalPath, minBytes = 1, expectedSha = null, onProgress = () => {} }) {
  const partPath = finalPath + '.part';
  return new Promise((resolve, reject) => {
    if (fileBigEnough(finalPath, minBytes)) return resolve(finalPath);

    let startByte = 0;
    try { startByte = fs.statSync(partPath).size; } catch { startByte = 0; }

    const headers = { 'User-Agent': 'NotePilot/0.1' };
    if (startByte > 0) headers.Range = `bytes=${startByte}-`;

    httpGet(url, headers, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(new Error(`Download failed: HTTP ${res.statusCode} (${url})`));
      }
      const isResume = res.statusCode === 206;
      const lenHeader = parseInt(res.headers['content-length'] || '0', 10);
      const totalBytes = (isResume ? startByte : 0) + lenHeader;
      let received = isResume ? startByte : 0;

      const out = fs.createWriteStream(partPath, { flags: isResume ? 'a' : 'w' });
      res.on('data', (chunk) => {
        received += chunk.length;
        const percent = totalBytes ? Math.min(100, (received / totalBytes) * 100) : 0;
        onProgress({ receivedBytes: received, totalBytes, percent });
      });
      res.pipe(out);
      out.on('error', reject);
      res.on('error', reject);
      out.on('finish', async () => {
        try {
          if (totalBytes && received < totalBytes) {
            return reject(new Error(`Incomplete download (${received}/${totalBytes}). Re-run to resume.`));
          }
          if (expectedSha) {
            const got = await sha256File(partPath);
            if (got.toLowerCase() !== expectedSha.toLowerCase()) {
              fs.unlinkSync(partPath);
              return reject(new Error(
                `Checksum mismatch for ${path.basename(finalPath)} `
                + `(expected ${expectedSha.slice(0, 12)}…, got ${got.slice(0, 12)}…). Re-run to retry.`));
            }
          }
          fs.renameSync(partPath, finalPath);
          resolve(finalPath);
        } catch (e) { reject(e); }
      });
    }, reject);
  });
}

// --- Public API ---

function modelExists() { return fileBigEnough(modelPath(), 100 * 1024 * 1024); }
function vadModelExists() { return fileBigEnough(vadModelPath(), 100 * 1024); }

function downloadModel(onProgress = () => {}) {
  return downloadFile({
    url: WHISPER_MODEL_URL, finalPath: modelPath(),
    minBytes: 100 * 1024 * 1024, expectedSha: MODEL_SHA256, onProgress,
  });
}

function downloadVadModel(onProgress = () => {}) {
  return downloadFile({
    url: VAD_MODEL_URL, finalPath: vadModelPath(),
    minBytes: 100 * 1024, expectedSha: VAD_SHA256, onProgress,
  });
}

function whisperCliExists() {
  try { return fs.statSync(whisperCliPath()).size > 0; } catch { return false; }
}

// Download + extract the self-contained whisper-cli bundle into userData/whisper/.
function downloadWhisperCli(onProgress = () => {}) {
  const dir = dirs.whisper();
  const tar = path.join(dir, 'whisper-cli.tar.gz');
  return downloadFile({ url: WHISPER_CLI_URL, finalPath: tar, minBytes: 1024, onProgress })
    .then(() => {
      const res = spawnSync('tar', ['-xzf', tar, '-C', dir]);
      if (res.status !== 0) {
        throw new Error('Failed to extract whisper-cli bundle: ' + (res.stderr || '').toString());
      }
      try { fs.chmodSync(whisperCliPath(), 0o755); } catch (_) { /* may be set in tar */ }
      // Make any bundled dylibs executable/readable too.
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.dylib') || f.endsWith('.so')) fs.chmodSync(path.join(dir, f), 0o755);
        }
      } catch (_) { /* ignore */ }
      fs.unlink(tar, () => {});
      if (!whisperCliExists()) throw new Error('whisper-cli missing after extraction.');
      return whisperCliPath();
    });
}

module.exports = {
  downloadModel, modelExists, downloadVadModel, vadModelExists,
  downloadWhisperCli, whisperCliExists,
  WHISPER_MODEL_URL, VAD_MODEL_URL, WHISPER_CLI_URL, sha256File,
};
