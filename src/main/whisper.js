// Run whisper.cpp's whisper-cli on a WAV and parse progress + timestamped segments.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Pure parsers (no I/O) — unit-tested in test/whisper.test.js ---

// whisper.cpp prints e.g. "whisper_print_progress_callback: progress = 42%"
function parseProgressLine(line) {
  const m = line.match(/progress\s*=\s*(\d+)\s*%/);
  return m ? Math.min(100, parseInt(m[1], 10)) : null;
}

// Parse the JSON written by whisper-cli's -oj flag into clean segments.
// offsets are in milliseconds.
function parseWhisperJson(jsonStr) {
  const data = JSON.parse(jsonStr);
  const raw = data.transcription || [];
  const segments = raw.map((s) => ({
    fromMs: s.offsets ? s.offsets.from : null,
    toMs: s.offsets ? s.offsets.to : null,
    text: (s.text || '').trim(),
  })).filter((s) => s.text.length > 0);
  const text = segments.map((s) => s.text).join(' ');
  const language = (data.result && data.result.language) || data.params?.language || null;
  return { language, segments, text };
}

// --- Process runner ---

/**
 * Transcribe a 16kHz mono WAV.
 * @param {object} o
 * @param {string} o.wavPath
 * @param {string} o.modelPath
 * @param {string} o.whisperCli   path to whisper-cli binary
 * @param {string} [o.lang='auto']
 * @param {string} [o.vadModelPath] if set, enable VAD to skip non-speech audio
 * @param {(percent:number)=>void} [o.onProgress]
 * @returns {Promise<{language:string|null, segments:Array, text:string}>}
 */
function transcribe({ wavPath, modelPath, whisperCli, lang = 'auto', vadModelPath = null, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    const outBase = path.join(os.tmpdir(), `notepilot-tr-${Date.now()}`);
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-l', lang,
      '-oj',                 // JSON output with timestamps
      '-of', outBase,
      '--print-progress',
      '--suppress-nst',      // suppress non-speech tokens (music/applause artifacts)
    ];
    // VAD strips silent/non-speech regions before decoding — kills the
    // "Gracias por ver el video" / repeated-filler hallucinations on silence.
    if (vadModelPath) {
      args.push('--vad', '-vm', vadModelPath);
    }

    const proc = spawn(whisperCli, args);
    let stderr = '';
    let lastPct = -1;

    const handleStream = (buf) => {
      const s = buf.toString();
      stderr += s;
      for (const line of s.split('\n')) {
        const pct = parseProgressLine(line);
        if (pct !== null && pct !== lastPct) {
          lastPct = pct;
          onProgress(pct);
        }
      }
    };
    proc.stderr.on('data', handleStream);
    proc.stdout.on('data', handleStream); // some builds print progress to stdout

    proc.on('error', reject);
    proc.on('close', (code) => {
      const jsonPath = `${outBase}.json`;
      if (code !== 0) {
        return reject(new Error(`whisper-cli failed (exit ${code}):\n${stderr.slice(-600)}`));
      }
      try {
        const jsonStr = fs.readFileSync(jsonPath, 'utf8');
        const parsed = parseWhisperJson(jsonStr);
        fs.unlink(jsonPath, () => {});
        if (!parsed.segments.length) {
          return reject(new Error('Transcription produced no text — check audio/model.'));
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Could not read transcription output: ${e.message}`));
      }
    });
  });
}

module.exports = { transcribe, parseProgressLine, parseWhisperJson };
