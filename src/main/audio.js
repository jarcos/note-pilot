// Audio decode: any input (m4a/mp3/wav/…) -> 16 kHz mono PCM WAV for whisper.cpp.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveFfmpeg } = require('./paths');

const SUPPORTED = ['.m4a', '.mp3', '.wav', '.aac', '.flac', '.ogg', '.mp4', '.webm', '.m4b'];

function isSupported(filePath) {
  return SUPPORTED.includes(path.extname(filePath).toLowerCase());
}

// Probe duration (seconds) using ffmpeg's stderr — avoids needing ffprobe.
function probeDurationSeconds(stderr) {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

/**
 * Decode an audio file to a temporary 16kHz mono WAV.
 * @returns {Promise<{wavPath: string, durationSec: number|null}>}
 */
function decodeToWav(inputPath, ffmpegPath = null) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) return reject(new Error(`File not found: ${inputPath}`));
    if (!isSupported(inputPath)) {
      return reject(new Error(`Unsupported format: ${path.extname(inputPath)}. Supported: ${SUPPORTED.join(', ')}`));
    }

    const ffmpeg = ffmpegPath || resolveFfmpeg();
    const wavPath = path.join(os.tmpdir(), `notepilot-${Date.now()}.wav`);
    const args = ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath];

    const proc = spawn(ffmpeg, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed (exit ${code}):\n${stderr.slice(-500)}`));
      if (!fs.existsSync(wavPath)) return reject(new Error('ffmpeg produced no output WAV.'));
      resolve({ wavPath, durationSec: probeDurationSeconds(stderr) });
    });
  });
}

module.exports = { decodeToWav, isSupported, probeDurationSeconds, SUPPORTED };
