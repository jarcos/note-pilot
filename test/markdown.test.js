// Tests for the Markdown renderer against the kinds of output the LLM actually
// produces (nested ordered lists, pipe tables, bold). Run: node test/markdown.test.js
const assert = require('assert');
const { renderMarkdown } = require('../src/renderer/markdown');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const R = (md) => renderMarkdown(md, esc);

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

console.log('renderMarkdown — nested lists');
const nested = `1. **Gran ópera francesa**
     - Género dominante
     - Compositor: Meyerbeer
2. **Ópera ligera**
     - Opereta`;
const h = R(nested);
t('top level is a single ordered list (no restart)', () => {
  assert.strictEqual((h.match(/<ol>/g) || []).length, 1);
  assert.strictEqual((h.match(/<\/ol>/g) || []).length, 1);
});
t('two ordered items present', () => {
  assert.strictEqual((h.match(/<li>/g) || []).length >= 4, true); // 2 ol + 3 sub
});
t('sub-bullets nest inside (ul appears after first li content)', () => {
  assert.ok(/Gran ópera francesa<\/strong><ul>/.test(h));
});
t('nested ul is closed before second ol item', () => {
  assert.ok(/<\/ul><\/li><li><strong>Ópera ligera/.test(h));
});

console.log('renderMarkdown — table');
const table = `| Aspecto | Wagner | Meyerbeer |
|---------|--------|-----------|
| Estructura | Fluida | Números |`;
const ht = R(table);
t('renders a table with header + body', () => {
  assert.ok(/<table><thead><tr><th>Aspecto<\/th>/.test(ht));
  assert.ok(/<tbody><tr><td>Estructura<\/td>/.test(ht));
  assert.ok(!ht.includes('|')); // no raw pipes leak through
});

console.log('renderMarkdown — safety & inline');
t('escapes raw HTML in source', () => {
  assert.ok(R('<script>alert(1)</script>').includes('&lt;script&gt;'));
});
t('bold renders', () => assert.ok(R('**hi**').includes('<strong>hi</strong>')));
t('heading without space still parses', () => assert.ok(/<h1>Notas/.test(R('#Notas'))));

console.log(`\nAll ${passed} markdown assertions passed.`);
