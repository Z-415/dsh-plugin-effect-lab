import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function portOf(report) {
  const check = (report.checks ?? []).find((item) => item.name === 'boot-url');
  const match = /port (\d+)/.exec(check?.detail ?? '');
  return match ? Number(match[1]) : null;
}

function assertClean(report) {
  const failed = (report.checks ?? [])
    .filter((check) => !check.pass && check.informational !== true)
    .map((check) => `${check.name}: ${check.detail}`);
  assert.deepEqual(failed, [], `${report.runId} failed checks`);
  assert.equal(report.cleanup.processesLeft, 0);
  assert.deepEqual(report.cleanup.portsLeft, []);
  assert.equal(report.cleanup.homeRemoved, true);
  assert.equal(report.cleanup.residue?.ok, true, JSON.stringify(report.cleanup.residue));
  assert.equal(report.realHome.diff.ok, true);
}

test('two concurrent runs get distinct ports and leave no residue', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const rootA = makeRoot('dsh-lab-race-a-');
  const rootB = makeRoot('dsh-lab-race-b-');
  try {
    const [a, b] = await Promise.all([
      runLab({ artifactsRoot: rootA, screenshots: ['home'] }),
      runLab({ artifactsRoot: rootB, screenshots: ['home'] }),
    ]);
    assertClean(a);
    assertClean(b);
    assert.notEqual(portOf(a), null);
    assert.notEqual(portOf(a), portOf(b));
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('the same run repeated three times is stable and leaks nothing', {
  skip: !enabled,
  timeout: 400_000,
}, async () => {
  const roots = [];
  const ports = [];
  const slotSets = [];
  const settleAfterMissing = [];
  const conversationMissing = [];
  try {
    for (let index = 0; index < 3; index += 1) {
      const root = makeRoot(`dsh-lab-stability-${index}-`);
      roots.push(root);
      const report = await runLab({ artifactsRoot: root, screenshots: ['home'] });
      assertClean(report);
      ports.push(portOf(report));
      // The element count is not an invariant (a transitional plateau can hold
      // a different count for a moment), so compare the sorted, deduplicated
      // slot-name set and require the probe to have read a settled DOM.
      const settleAfter = report.browser?.settleAfter;
      if (settleAfter?.stable !== true) settleAfterMissing.push(index);
      const slots = [...(report.browser?.dom?.slots ?? [])].sort();
      // The seeded fixture conversation must be the mounted state; the hero/
      // onboarding page (the old 37-slot drift) is a different slot set.
      if (!slots.includes('conversation.session') || !slots.includes('conversation.chat.node')) {
        conversationMissing.push(index);
      }
      slotSets.push(slots.join('|'));
    }
    assert.equal(new Set(ports).size, 3, `expected three distinct ports, got ${ports.join(', ')}`);
    assert.deepEqual(
      settleAfterMissing,
      [],
      `run(s) ${settleAfterMissing.join(', ')} never reached a settled DOM after the session click`,
    );
    assert.deepEqual(
      conversationMissing,
      [],
      `run(s) ${conversationMissing.join(', ')} never mounted the fixture conversation`,
    );
    assert.equal(new Set(slotSets).size, 1, `slot name set drifted across runs:\n${slotSets.join('\n')}`);
    assert.equal(slotSets[0].length > 0, true);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
});
