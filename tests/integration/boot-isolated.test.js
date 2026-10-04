import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('isolated web boot captures UI, cleans up, and leaves the real home unchanged', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-e2e-'));
  try {
    const report = await runLab({
      mode: 'web',
      screenshots: ['home'],
      assertTokens: ['--dsw-alias-bg-base'],
      artifactsRoot,
    });
    assert.equal(report.runtime.version, '0.2.0-rc.2');
    assert.equal(report.cleanup.homeRemoved, true);
    assert.deepEqual(report.cleanup.portsLeft, []);
    assert.equal(report.cleanup.processesLeft, 0);
    assert.equal(report.realHome.diff.ok, true);
    assert.equal(report.browser.dom.slotCount > 0, true);
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
