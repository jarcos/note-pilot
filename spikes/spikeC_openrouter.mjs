// Spike C — OpenRouter free-model call + rate-limit probe.
//
// Confirms: the chat/completions endpoint works with the shared key, the
// response shape we'll parse, and roughly how many requests the free tier
// allows before throttling (drives the map-reduce chunk-size decision).
//
// Setup:
//   export OPENROUTER_API_KEY="sk-or-..."        # the shared key
//   node spikes/spikeC_openrouter.mjs            # single call
//   node spikes/spikeC_openrouter.mjs --probe 15 # fire N calls, count until 429
//
// Optional: override the model. Default is OpenRouter's free auto-router, which
// selects from whatever free models are currently available (robust to churn):
//   export OPENROUTER_MODEL="openrouter/free"

const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const URL = 'https://openrouter.ai/api/v1/chat/completions';

if (!KEY) {
  console.error('Missing OPENROUTER_API_KEY. export it, then re-run.');
  process.exit(1);
}

async function call(prompt) {
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      // Optional attribution headers OpenRouter recommends:
      'HTTP-Referer': 'https://github.com/josearcos/note-pilot',
      'X-Title': 'Note Pilot',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    }),
  });
  const ms = Date.now() - t0;
  const remaining = res.headers.get('x-ratelimit-remaining');
  return { status: res.status, ms, remaining, json: await res.json().catch(() => null) };
}

const probeArg = process.argv.indexOf('--probe');

if (probeArg === -1) {
  // Single call: verify it works and inspect the response shape.
  const r = await call('Resume en una frase: la Edad Media en la historia de la música.');
  console.log('model        :', MODEL);
  console.log('status       :', r.status, ' latency:', r.ms + 'ms');
  if (r.status === 200) {
    console.log('reply        :', r.json?.choices?.[0]?.message?.content?.trim());
    console.log('usage        :', JSON.stringify(r.json?.usage));
    console.log('\nPASS — OpenRouter free model reachable and returns the expected shape.');
  } else {
    console.log('body         :', JSON.stringify(r.json, null, 2));
    console.log('\nFAIL — check the key, the model name (free models change), or credit.');
  }
} else {
  // Rate-limit probe: how many back-to-back calls before a 429?
  const n = parseInt(process.argv[probeArg + 1] || '15', 10);
  let ok = 0;
  for (let i = 1; i <= n; i++) {
    const r = await call(`Di el número ${i} en una palabra.`);
    console.log(`#${i}: status=${r.status} ${r.ms}ms remaining=${r.remaining ?? 'n/a'}`);
    if (r.status === 429) {
      console.log(`\nThrottled after ${ok} successful calls. body:`, JSON.stringify(r.json));
      break;
    }
    if (r.status === 200) ok++;
  }
  console.log(`\nSuccessful calls: ${ok}/${n}.`);
  console.log('Reminder: one 43-min lecture ≈ a dozen+ chunk calls. If this number is low,');
  console.log('chunk coarsely and/or add ~$10 credit to lift the free ceiling to ~1000/day.');
}
