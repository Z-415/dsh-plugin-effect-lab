import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSlotConflicts, diffSlots } from '../../src/slot-probe.js';

test('diffSlots reports added and removed slots', () => {
  assert.deepEqual(diffSlots(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'] });
});

test('detectSlotConflicts flags a slot added by two runs', () => {
  assert.deepEqual(
    detectSlotConflicts([
      { id: 'one', slots: { added: ['x'] } },
      { id: 'two', slots: { added: ['x'] } },
    ]),
    [{ slot: 'x', runs: ['one', 'two'] }],
  );
});
