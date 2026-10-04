import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFixtureEvents } from '../../fixtures/plugins/session-seeder/lib/index.js';

test('fixture events are contiguous and cover user/assistant/tool', () => {
  const events = buildFixtureEvents(1000);
  assert.deepEqual(events.map((event) => event.seq), [...events.keys()]);
  const types = new Set(events.map((event) => event.type));
  assert.equal(types.has('user/message'), true);
  assert.equal(types.has('assistant/message'), true);
  assert.equal(types.has('tool/result'), true);
  assert.equal(events.find((event) => event.type === 'turn/end').data.reason.kind, 'completed');
});
