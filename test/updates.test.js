// Tests for update version comparison. Run: node test/updates.test.js
const assert = require('assert');
const { isNewer } = require('../src/main/updates');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

console.log('updates.isNewer');
t('minor bump is newer', () => assert.strictEqual(isNewer('v0.2.0', '0.1.0'), true));
t('patch bump is newer', () => assert.strictEqual(isNewer('0.1.1', '0.1.0'), true));
t('same version is not newer', () => assert.strictEqual(isNewer('v0.1.0', '0.1.0'), false));
t('older tag is not newer', () => assert.strictEqual(isNewer('v0.1.0', '0.2.0'), false));
t('major bump beats large minor', () => assert.strictEqual(isNewer('v1.0.0', '0.9.9'), true));
t('handles v-prefix on both sides', () => assert.strictEqual(isNewer('v0.1.2', 'v0.1.1'), true));

console.log(`\nAll ${passed} update assertions passed.`);
