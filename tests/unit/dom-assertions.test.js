import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDomAssertions } from '../../src/dom-assertions.js';

const dom = {
  tokens: { '--dsw-alias-bg-base': '#fff', '--empty': '' },
  slots: ['root', 'conversation.composer'],
  slotCount: 2,
  bodyAttributes: { 'data-we-wallpaper': 'on', 'data-empty': '' },
};

test('evaluateDomAssertions passes present tokens, slots, empty-valued attributes, and minSlots', () => {
  const result = evaluateDomAssertions(dom, {
    tokens: ['--dsw-alias-bg-base'],
    slots: ['conversation.composer'],
    bodyAttributes: ['data-we-wallpaper', 'data-empty'],
    minSlots: 2,
  });
  assert.equal(result.ok, true);
  assert.deepStrictEqual(result.checks.map((check) => check.name), [
    'token:--dsw-alias-bg-base',
    'slot:conversation.composer',
    'body-attribute:data-we-wallpaper',
    'body-attribute:data-empty',
    'min-slots',
  ]);
});

test('evaluateDomAssertions reports empty tokens, missing slots, missing attributes, and a low slot count', () => {
  const result = evaluateDomAssertions(dom, {
    tokens: ['--empty'],
    slots: ['missing.slot'],
    bodyAttributes: ['data-nope'],
    minSlots: 5,
  });
  assert.equal(result.ok, false);
  assert.deepStrictEqual(result.checks.map((check) => check.name), [
    'token:--empty',
    'slot:missing.slot',
    'body-attribute:data-nope',
    'min-slots',
  ]);
  for (const check of result.checks) assert.equal(check.pass, false);
});

test('evaluateDomAssertions with no spec is vacuously ok', () => {
  assert.deepStrictEqual(evaluateDomAssertions(dom, {}), { checks: [], ok: true });
});
