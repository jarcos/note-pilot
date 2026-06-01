// Summary + Structured Notes via map-reduce over segment-aware chunks.
const { chat } = require('./openrouter');

// --- Pure: group segments into coarse, sentence-safe chunks ---
// Coarse chunks keep the request count low (free-tier budget) while never
// slicing mid-segment (segments already end on whisper pause boundaries).
function chunkSegments(segments, maxChars = 5000) {
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const s of segments) {
    const t = (s.text || '').trim();
    if (!t) continue;
    if (len + t.length > maxChars && buf.length) {
      chunks.push(buf.join(' '));
      buf = []; len = 0;
    }
    buf.push(t);
    len += t.length + 1;
  }
  if (buf.length) chunks.push(buf.join(' '));
  return chunks;
}

const LANG_NAME = { es: 'Spanish', en: 'English' };
function langName(lang) { return LANG_NAME[lang] || 'the same language as the transcript'; }

// --- Prompts ---
const PROMPTS = {
  summary: {
    map: (lang) => `You are summarizing one part of a university lecture transcript. `
      + `Write a concise summary of the key points in ${langName(lang)}. `
      + `Only use information present in the text; do not invent anything.`,
    reduce: (lang) => `You are combining partial summaries of one lecture into a single, `
      + `cohesive summary in ${langName(lang)}. Remove redundancy, keep it concise and well-ordered. `
      + `Do not add facts that are not in the partial summaries.`,
  },
  notes: {
    map: (lang) => `You are turning one part of a university lecture transcript into structured study notes `
      + `in ${langName(lang)}, formatted as Markdown with headings, sub-points, and **key terms**. `
      + `Stay faithful to the transcript — do not invent facts, names, or dates. `
      + `If a part is small talk or logistics, omit it.`,
    reduce: (lang) => `You are merging partial study notes for one lecture into a single, coherent `
      + `Markdown study-notes document in ${langName(lang)}. Organize into logical sections with clear headings, `
      + `merge duplicates, preserve all substantive content and key terms. Do not invent anything.`,
  },
};

/**
 * Generate a 'summary' or 'notes' document from transcript segments.
 * @param {object} o
 * @param {Array} o.segments
 * @param {'summary'|'notes'} o.type
 * @param {string} o.apiKey
 * @param {string} o.model
 * @param {string} [o.lang]
 * @param {(p:{phase:string,done:number,total:number})=>void} [o.onProgress]
 * @returns {Promise<string>} Markdown
 */
async function generate({ segments, type, apiKey, model, lang = 'es', onProgress = () => {} }) {
  const prompts = PROMPTS[type];
  if (!prompts) throw new Error(`Unknown generation type: ${type}`);

  const chunks = chunkSegments(segments);
  if (!chunks.length) throw new Error('Nothing to generate from — empty transcript.');

  // MAP: summarize / extract per chunk.
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress({ phase: 'map', done: i, total: chunks.length });
    const out = await chat({
      apiKey, model,
      messages: [
        { role: 'system', content: prompts.map(lang) },
        { role: 'user', content: chunks[i] },
      ],
      maxTokens: type === 'notes' ? 1400 : 800,
    });
    partials.push(out);
  }

  // Single chunk → no reduce needed.
  if (partials.length === 1) {
    onProgress({ phase: 'done', done: 1, total: 1 });
    return partials[0];
  }

  // REDUCE: merge partials into the final document.
  onProgress({ phase: 'reduce', done: chunks.length, total: chunks.length });
  const merged = await chat({
    apiKey, model,
    messages: [
      { role: 'system', content: prompts.reduce(lang) },
      { role: 'user', content: partials.map((p, i) => `--- Part ${i + 1} ---\n${p}`).join('\n\n') },
    ],
    maxTokens: type === 'notes' ? 2200 : 1000,
  });
  onProgress({ phase: 'done', done: chunks.length, total: chunks.length });
  return merged;
}

module.exports = { generate, chunkSegments };
