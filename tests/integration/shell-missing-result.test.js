import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runShell } from '../../src/electron-shell/shell-runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('a shell run whose child never writes shell-result.json fails readably instead of crashing', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-shell-missing-'));
  try {
    // A 1ms deadline means the runner stops waiting almost immediately, long
    // before Electron can write shell-result.json: exactly the null-result path.
    const report = await runShell({
      compareWeb: false,
      screenshots: [],
      shellTimeoutMs: 1,
      artifactsRoot,
    });
    assert.equal(report.shell !== null, true, 'the report must still carry the shell section');
    assert.equal(report.shell.result, null);
    assert.equal(report.ok, false);

    const resultCheck = report.checks.find((check) => check.name === 'shell-result');
    assert.ok(resultCheck, 'shell-result check must exist');
    assert.equal(resultCheck.pass, false);
    assert.equal(resultCheck.detail, 'missing');

    const runCheck = report.checks.find((check) => check.name === 'shell-run');
    assert.ok(runCheck, 'shell-run check must exist');
    assert.equal(runCheck.pass, false);
    assert.match(runCheck.detail, /shell-result 缺失/);
    assert.equal(runCheck.detail.includes('Cannot read properties of null'), false);

    assert.equal(Number.isInteger(report.shell.childExitCode) || report.shell.childExitCode === null, true);
    assert.equal(typeof report.shell.stderr, 'string');
    assert.equal(report.cleanup?.residue?.ok, true, JSON.stringify(report.cleanup));
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
