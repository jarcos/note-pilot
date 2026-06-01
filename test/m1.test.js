// Unit tests for M1 pure parsers (no native deps, no Electron).
// Run: node test/m1.test.js
const assert = require('assert');
const { parseProgressLine, parseWhisperJson } = require('../src/main/whisper');
const { probeDurationSeconds, isSupported } = require('../src/main/audio');
const { chunkSegments } = require('../src/main/generate');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

console.log('whisper.parseProgressLine');
t('parses a progress percent', () =>
  assert.strictEqual(parseProgressLine('whisper_print_progress_callback: progress = 42%'), 42));
t('caps at 100', () =>
  assert.strictEqual(parseProgressLine('progress = 130%'), 100));
t('returns null for non-progress lines', () =>
  assert.strictEqual(parseProgressLine('loading model...'), null));

console.log('whisper.parseWhisperJson');
const sample = JSON.stringify({
  result: { language: 'es' },
  transcription: [
    { offsets: { from: 0, to: 5000 }, text: ' En la Edad Media ' },
    { offsets: { from: 5000, to: 9000 }, text: ' la música era monódica.' },
    { offsets: { from: 9000, to: 9000 }, text: '   ' }, // blank -> dropped
  ],
});
t('extracts language', () => assert.strictEqual(parseWhisperJson(sample).language, 'es'));
t('drops empty segments', () => assert.strictEqual(parseWhisperJson(sample).segments.length, 2));
t('trims segment text', () =>
  assert.strictEqual(parseWhisperJson(sample).segments[0].text, 'En la Edad Media'));
t('keeps millisecond offsets', () =>
  assert.strictEqual(parseWhisperJson(sample).segments[1].fromMs, 5000));
t('joins full text', () =>
  assert.strictEqual(parseWhisperJson(sample).text, 'En la Edad Media la música era monódica.'));

console.log('audio.probeDurationSeconds');
const ffstderr = 'Input #0, mov,mp4...\n  Duration: 00:42:36.74, start: 0.000000, bitrate: 68 kb/s';
t('parses HH:MM:SS.ff to seconds', () =>
  assert.ok(Math.abs(probeDurationSeconds(ffstderr) - 2556.74) < 0.01));
t('returns null when absent', () =>
  assert.strictEqual(probeDurationSeconds('no duration here'), null));

console.log('audio.isSupported');
t('accepts m4a', () => assert.strictEqual(isSupported('/x/lecture.M4A'), true));
t('rejects pdf', () => assert.strictEqual(isSupported('/x/notes.pdf'), false));

console.log('generate.chunkSegments');
const seg = (text) => ({ text });
t('single short chunk stays whole', () => {
  const c = chunkSegments([seg('hola'), seg('mundo')], 100);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0], 'hola mundo');
});
t('splits when exceeding maxChars, never mid-segment', () => {
  const segs = [seg('a'.repeat(40)), seg('b'.repeat(40)), seg('c'.repeat(40))];
  const c = chunkSegments(segs, 50);
  assert.strictEqual(c.length, 3);                 // each ~40 chars, 50 cap -> one per chunk
  assert.ok(c.every((x) => /^(a+|b+|c+)$/.test(x))); // segments kept intact
});
t('drops empty segments', () => {
  const c = chunkSegments([seg('x'), seg('   '), seg('y')], 1000);
  assert.strictEqual(c[0], 'x y');
});
t('empty input -> no chunks', () => {
  assert.strictEqual(chunkSegments([], 1000).length, 0);
});

console.log(`\nAll ${passed} assertions passed.`);
