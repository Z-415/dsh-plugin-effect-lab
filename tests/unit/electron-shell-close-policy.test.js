import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { APP_FILES } from '../../src/electron-shell/runtime-builder.js';

const require = createRequire(import.meta.url);
const { earlyCloseOutcome } = require('../../src/electron-shell/close-policy.cjs');

test('a hidden run closing before the probe is a failure, not a green result', () => {
  const outcome = earlyCloseOutcome({ keepOpen: false, show: false, probePayload: null });
  assert.equal(outcome.ok, false);
  assert.match(outcome.extra.error, /closed before the probe/);
});

test('keep-open closed before the probe writes a clean probeIncomplete result', () => {
  const outcome = earlyCloseOutcome({ keepOpen: true, show: true, probePayload: null });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.extra.closedByUser, true);
  assert.equal(outcome.extra.probeIncomplete, true);
});

test('a visible --show run closed early is also user-initiated success', () => {
  const outcome = earlyCloseOutcome({ keepOpen: false, show: true, probePayload: null });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.extra.probeIncomplete, true);
});

test('keep-open closed after the probe keeps the full payload', () => {
  const payload = { dom: { slotCount: 37 }, capture: { attempts: 1 } };
  const outcome = earlyCloseOutcome({ keepOpen: true, show: true, probePayload: payload });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.extra.dom.slotCount, 37);
  assert.equal(outcome.extra.closedByUser, true);
  assert.equal(outcome.extra.probeIncomplete, undefined);
});

test('the cached shell runtime copies close-policy.cjs', () => {
  const here = fileURLToPath(new URL('../../src/electron-shell/', import.meta.url));
  assert.equal(APP_FILES.includes('close-policy.cjs'), true, JSON.stringify(APP_FILES));
  for (const name of APP_FILES) {
    assert.equal(fs.existsSync(path.join(here, name)), true, `missing ${name}`);
  }
});
