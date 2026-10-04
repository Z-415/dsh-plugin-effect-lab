import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runShell } from '../../src/electron-shell/shell-runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('electron shell bridges the host stream and matches web DOM/tokens', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-shell-e2e-'));
  try {
    const report = await runShell({
      compareWeb: true,
      screenshots: ['shell'],
      assertTokens: ['--dsw-alias-bg-base'],
      artifactsRoot,
    });
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
    assert.equal(report.shell.probe.transport.present, true);
    assert.equal(report.shell.probe.transport.ownsHost, true);
    assert.match(report.shell.probe.transport.streamBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(
      (report.shell.result.consoleErrors ?? []).some((message) => String(message).includes('connection lost')),
      false,
      JSON.stringify(report.shell.result.consoleErrors),
    );
    assert.deepEqual(report.shell.shellVsWeb.slots.added, []);
    assert.deepEqual(report.shell.shellVsWeb.slots.removed, []);
    assert.equal(report.shell.shellVsWeb.tokens.changed['--dsw-alias-bg-base'], undefined);
    assert.equal(report.cleanup.homeRemoved, true);
    assert.deepEqual(report.cleanup.portsLeft, []);
    assert.equal(report.realHome.diff.ok, true);
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
