import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

function artifactsRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('a missing plugin source fails cleanly without residue', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = artifactsRoot('dsh-lab-fail-e2e-');
  try {
    const report = await runLab({ plugins: ['./fixtures/plugins/does-not-exist'], artifactsRoot: root });
    assert.equal(report.ok, false);
    assert.equal(report.cleanup.homeRemoved, true);
    assert.deepEqual(report.cleanup.portsLeft, []);
    assert.equal(report.cleanup.residue?.ok, true, JSON.stringify(report.cleanup.residue));
    assert.equal(report.realHome.diff.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate slot declarations fail before boot without residue', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = artifactsRoot('dsh-lab-dup-e2e-');
  try {
    const report = await runLab({
      plugins: ['./fixtures/plugins/dup-slot-one', './fixtures/plugins/dup-slot-two'],
      fixture: false,
      artifactsRoot: root,
    });
    assert.equal(report.ok, false);
    const blockers = report.pluginValidation?.summary?.blockers ?? [];
    assert.equal(blockers.some((item) => item.id === 'duplicate-slot-registration-id'), true, JSON.stringify(blockers));
    assert.equal(blockers.some((item) => item.id === 'duplicate-tool-name'), true);
    assert.equal(blockers.some((item) => item.id === 'duplicate-loader-id'), false);
    assert.equal(report.cleanup.homeRemoved, true);
    assert.equal(report.cleanup.residue?.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unreachable runtime path fails before creating a home', {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const root = artifactsRoot('dsh-lab-runtime-e2e-');
  try {
    const report = await runLab({ runtimePath: path.join(os.tmpdir(), 'dsh-lab-missing', 'dsh.cmd'), artifactsRoot: root });
    assert.equal(report.ok, false);
    assert.equal(report.isolation, null);
    assert.equal(report.cleanup.residue?.ok, true, JSON.stringify(report.cleanup.residue));
    assert.equal(report.realHome, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
