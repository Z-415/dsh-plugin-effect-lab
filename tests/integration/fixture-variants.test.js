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

test('the empty fixture variant renders the UI with no conversation events', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = makeRoot('dsh-lab-empty-e2e-');
  try {
    const report = await runLab({ fixtureVariant: 'empty', artifactsRoot: root, screenshots: ['home'] });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(report.fixture.variant, 'empty');
    assert.equal(report.fixture.events, 0);
    assert.equal(report.browser.dom.slotCount > 0, true);
    assert.equal(report.cleanup.residue?.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the long fixture variant renders twelve turns and tool results', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = makeRoot('dsh-lab-long-e2e-');
  try {
    const report = await runLab({ fixtureVariant: 'long', artifactsRoot: root, screenshots: ['home'] });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(report.fixture.variant, 'long');
    assert.equal(report.fixture.types.includes('tool/result'), true);
    assert.equal(report.fixture.types.includes('turn/end'), true);
    assert.equal(report.browser.dom.slotCount > 0, true);
    assert.equal(report.cleanup.residue?.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the rich fixture renders a reasoning block and a fenced code block', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = makeRoot('dsh-lab-rich-e2e-');
  try {
    const report = await runLab({ fixtureVariant: 'rich', artifactsRoot: root, screenshots: ['home'] });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(report.fixture.variant, 'rich');
    assert.equal(report.fixture.reasoningBlocks >= 1, true, JSON.stringify(report.fixture));
    assert.equal(report.fixture.codeFences >= 1, true, JSON.stringify(report.fixture));
    assert.equal(report.fixture.contentBlockTypes.includes('reasoning'), true, JSON.stringify(report.fixture));
    assert.equal(report.fixture.streamTypes.includes('reasoning-chunks'), true, JSON.stringify(report.fixture));
    assert.equal(report.fixture.types.includes('tool/result'), true);
    assert.equal(report.fixture.textProbe?.reasoningFound, true, JSON.stringify(report.fixture.textProbe));
    assert.equal(report.fixture.textProbe?.codeFound, true, JSON.stringify(report.fixture.textProbe));
    assert.equal(report.browser.dom.slotCount > 0, true);
    assert.equal(report.cleanup.residue?.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
