import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { seederPluginDir } from '../../src/fixture-manager.js';
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
    const html = fs.readFileSync(path.join(report.runDir, 'report.html'), 'utf8');
    assert.equal(html.startsWith('<!doctype html>'), true);
    assert.equal(html.includes('DSH Plugin Effect Lab'), true);
    assert.equal((html.match(/data:image\/png;base64,/g) ?? []).length >= 1, true);
    // Installing a local-directory plugin must never delete its source tree.
    assert.equal(fs.existsSync(path.join(seederPluginDir(), 'lib', 'index.js')), true, 'fixture source must survive the run');
    assert.equal(fs.existsSync(path.join(seederPluginDir(), 'package.json')), true);
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
