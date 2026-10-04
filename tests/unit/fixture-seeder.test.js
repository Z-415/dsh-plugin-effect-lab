import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildEventsFromSpec, buildFixtureEvents } from '../../fixtures/plugins/session-seeder/lib/index.js';
import { FIXTURE_VARIANTS, fixtureVariantPath, readFixtureSpec } from '../../src/fixture-manager.js';

test('fixture events are contiguous and cover user/assistant/tool', () => {
  const events = buildFixtureEvents(1000);
  assert.deepEqual(events.map((event) => event.seq), [...events.keys()]);
  const types = new Set(events.map((event) => event.type));
  assert.equal(types.has('user/message'), true);
  assert.equal(types.has('assistant/message'), true);
  assert.equal(types.has('tool/result'), true);
  assert.equal(events.find((event) => event.type === 'turn/end').data.reason.kind, 'completed');
});

test('the committed default spec matches the inline default', () => {
  const spec = readFixtureSpec('default');
  const events = buildEventsFromSpec(spec, 1000);
  assert.deepEqual(events.map((event) => event.seq), [...events.keys()]);
  assert.equal(events.length, buildFixtureEvents(1000).length);
  assert.equal(spec.sessionId, 'session-00000000-0000-4000-8000-000000000001');
});

test('the empty variant produces no events', () => {
  const spec = readFixtureSpec('empty');
  assert.deepEqual(buildEventsFromSpec(spec, 0), []);
});

test('the long variant produces twelve turns with tool results on some', () => {
  const spec = readFixtureSpec('long');
  assert.equal(spec.turns.length, 12);
  const events = buildEventsFromSpec(spec, 0);
  assert.deepEqual(events.map((event) => event.seq), [...events.keys()]);
  const turnEnds = events.filter((event) => event.type === 'turn/end');
  assert.equal(turnEnds.length, 12);
  assert.equal(turnEnds.at(-1).data.turn, 12);
  assert.equal(events.filter((event) => event.type === 'tool/result').length, 4);
});

test('every committed variant file exists and has a distinct session id', () => {
  const ids = new Set();
  for (const variant of Object.keys(FIXTURE_VARIANTS)) {
    const file = fixtureVariantPath(variant);
    assert.equal(fs.existsSync(file), true, file);
    const spec = readFixtureSpec(variant);
    assert.equal(typeof spec.sessionId, 'string');
    ids.add(spec.sessionId);
  }
  assert.equal(ids.size, Object.keys(FIXTURE_VARIANTS).length);
});

test('every surface-eligible event carries an append surfaceOp', () => {
  const surfaceTypes = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);
  for (const variant of ['default', 'long']) {
    for (const event of buildEventsFromSpec(readFixtureSpec(variant), 0)) {
      if (!surfaceTypes.has(event.type)) continue;
      assert.equal(event.surfaceOp, 'append', `${variant} ${event.type} seq=${event.seq}`);
    }
  }
});
