// Minimal OpenRouter chat client with retry/backoff on rate limits (429).
const URL = 'https://openrouter.ai/api/v1/chat/completions';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Single chat completion. Retries on 429 / 5xx with exponential backoff.
 * @returns {Promise<string>} assistant message content
 */
async function chat({ apiKey, model, messages, maxTokens = 1200, temperature = 0.2, maxRetries = 4 }) {
  // Strip anything that isn't a printable ASCII key character. Guards against
  // pasted whitespace / terminal glyphs (which otherwise crash header encoding).
  const key = String(apiKey || '').replace(/[^\x21-\x7E]/g, '');
  if (!key) throw new Error('No OpenRouter API key set. Add it in Settings.');

  let attempt = 0;
  for (;;) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/josearcos/note-pilot',
        'X-Title': 'Note Pilot',
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });

    if (res.status === 200) {
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenRouter returned an empty response.');
      return content.trim();
    }

    // Retryable: 429 (rate limit) and transient 5xx.
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 1000 * 2 ** attempt);
      attempt += 1;
      await sleep(backoff);
      continue;
    }

    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
}

module.exports = { chat };
