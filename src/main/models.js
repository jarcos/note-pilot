// Fetch the list of free OpenRouter models from the PUBLIC /models endpoint
// (no API key required) and filter to an allowed set of providers.
const https = require('https');

// Providers whose free models are offered to the user. Edit to taste.
// Note: Anthropic and most OpenAI models are paid, so those groups will often
// be empty in a free-only list (OpenAI's open `gpt-oss` models are the exception).
const ALLOWED_PROVIDERS = ['google', 'deepseek', 'meta-llama', 'openai', 'anthropic', 'qwen', 'mistralai'];

function isFree(pricing) {
  if (!pricing) return false;
  const zero = (v) => v === '0' || v === 0 || v === '0.0';
  return zero(pricing.prompt) && zero(pricing.completion);
}

// True only if the model produces TEXT output — excludes audio/image/video
// generators (e.g. Google Lyria, which is a music model) that have no business
// in a text-summarization picker.
function outputsText(m) {
  const arch = m.architecture || {};
  if (Array.isArray(arch.output_modalities)) return arch.output_modalities.includes('text');
  if (typeof arch.modality === 'string') {
    const out = arch.modality.includes('->') ? arch.modality.split('->').pop() : arch.modality;
    return out.includes('text');
  }
  return true; // unknown shape — don't over-filter
}

// Returns [{ id, name, provider, contextLength }] — never throws (offline => []).
function fetchFreeModels() {
  return new Promise((resolve) => {
    https.get({
      hostname: 'openrouter.ai', path: '/api/v1/models',
      headers: { 'User-Agent': 'NotePilot', Accept: 'application/json' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve([]); }
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try {
          const list = (JSON.parse(data).data) || [];
          const free = list
            .filter((m) => {
              const provider = String(m.id || '').split('/')[0];
              return isFree(m.pricing) && ALLOWED_PROVIDERS.includes(provider) && outputsText(m);
            })
            .map((m) => ({
              id: m.id,
              name: m.name || m.id,
              provider: String(m.id).split('/')[0],
              contextLength: m.context_length || null,
            }));
          free.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
          resolve(free);
        } catch (_) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

module.exports = { fetchFreeModels, ALLOWED_PROVIDERS, isFree, outputsText };
