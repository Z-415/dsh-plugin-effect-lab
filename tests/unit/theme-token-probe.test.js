import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEffectConflicts, diffStringMap } from '../../src/theme-token-probe.js';

test('diffStringMap reports changed, added, and removed keys', () => {
  const diff = diffStringMap({ a: '1', b: '2' }, { a: '9', c: '3' });
  assert.deepEqual(diff.changed.a, { before: '1', after: '9' });
  assert.equal(diff.added.c, '3');
  assert.equal(diff.removed.b, '2');
});

test('detectEffectConflicts flags a token touched by two runs', () => {
  const conflicts = detectEffectConflicts([
    { id: 'one', tokens: { changed: { '--x': { before: '', after: 'a' } }, added: {} }, bodyAttributes: { changed: {}, added: {} } },
    { id: 'two', tokens: { changed: { '--x': { before: '', after: 'b' } }, added: {} }, bodyAttributes: { changed: {}, added: {} } },
  ]);
  assert.deepEqual(conflicts.tokens, [{ key: '--x', runs: ['one', 'two'] }]);
});
