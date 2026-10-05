import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runShell } from '../../src/electron-shell/shell-runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('a relative --artifacts root still lets the shell child write where the runner reads', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const relativeRoot = path.join('artifacts', `relative-artifacts-${process.pid}`);
  const absoluteRoot = path.resolve(relativeRoot);
  try {
    const report = await runShell({
      compareWeb: false,
      screenshots: [],
      artifactsRoot: relativeRoot,
    });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(path.isAbsolute(report.runDir), true, `runDir must be absolute: ${report.runDir}`);
    assert.equal(report.runDir.startsWith(absoluteRoot), true);
    assert.equal(fs.existsSync(path.join(report.runDir, 'shell-result.json')), true);
    assert.equal(report.shell?.result?.ok, true);
  } finally {
    fs.rmSync(absoluteRoot, { recursive: true, force: true });
  }
});
