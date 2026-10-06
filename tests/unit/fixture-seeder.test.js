import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildEventsFromSpec, buildFixtureEvents } from '../../fixtures/plugins/session-seeder/lib/index.js';
import {
  FIXTURE_VARIANTS,
  fixtureVariantPath,
  readFixtureSpec,
  resetLabWorkspaceState,
} from '../../src/fixture-manager.js';

test('resetLabWorkspaceState clears stale sessions/storages but keeps the rest of the lab home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-fixture-reset-'));
  try {
    const sessionFile = path.join(home, 'sessions', '--x--', 'session-a', 'session.v4.jsonl.zstd');
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, 'x', 'utf8');
    fs.mkdirSync(path.join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), '{"global":{}}\n', 'utf8');
    fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
    const result = resetLabWorkspaceState(home);
    assert.equal(result.removed.length, 2, JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(home, 'sessions')), false);
    assert.equal(fs.existsSync(path.join(home, 'storages')), false);
    assert.equal(fs.existsSync(path.join(home, 'agents')), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

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
  for (const variant of ['default', 'long', 'rich']) {
    for (const event of buildEventsFromSpec(readFixtureSpec(variant), 0)) {
      if (!surfaceTypes.has(event.type)) continue;
      assert.equal(event.surfaceOp, 'append', `${variant} ${event.type} seq=${event.seq}`);
    }
  }
});

test('the rich variant uses a reasoning content block, not a thinking event/type', () => {
  const events = buildEventsFromSpec(readFixtureSpec('rich'), 0);
  const types = new Set(events.map((event) => event.type));
  assert.equal(types.has('assistant/thinking'), false, '0.2.0-rc.2 has no assistant/thinking event');
  assert.equal(types.has('assistant/reasoning'), false);
  const blocks = events
    .filter((event) => event.type === 'assistant/message')
    .flatMap((event) => event.data.message.content);
  const reasoning = blocks.filter((block) => block.type === 'reasoning');
  assert.equal(reasoning.length, 1, 'the rich fixture must carry one reasoning block');
  assert.equal(typeof reasoning[0].text, 'string');
  assert.equal(reasoning[0].text.length > 0, true);
  assert.equal(blocks.some((block) => block.type === 'thinking'), false, 'a thinking type would not render');
  const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  assert.match(text, /```js/);
  assert.equal(events.filter((event) => event.type === 'tool/result').length, 1);
});

test('the rich variant streams reasoning-chunks with the official shape', () => {
  const events = buildEventsFromSpec(readFixtureSpec('rich'), 0);
  const streams = events
    .filter((event) => event.type === 'assistant/message')
    .flatMap((event) => event.data.stream);
  assert.deepEqual(streams.map((record) => record.type), ['reasoning-chunks', 'text-chunks', 'text-chunks']);
  const [reasoning] = streams;
  assert.equal(typeof reasoning.time0, 'number');
  assert.equal(typeof reasoning.index, 'number');
  assert.equal(Array.isArray(reasoning.dt), true);
  assert.equal(Array.isArray(reasoning.texts), true);
  assert.match(reasoning.texts.join(''), /thinking area/);
});
