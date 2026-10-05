import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('a published URL whose port never listens fails fast on boot-listening', {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-boot-listening-'));
  try {
    const fakeBoot = {
      port: 43210,
      url: 'http://127.0.0.1:43210/?token=test-token',
      origin: 'http://127.0.0.1:43210',
      listening: false,
      transport: 'stdout',
      transportRequested: 'stdout',
      fallbackReason: 'test seam',
      injections: null,
      injectionKinds: [],
      getOutput: () => ({ stdout: 'dsh web: http://127.0.0.1:43210/?token=test-token\n', stderr: 'boot stderr tail\n' }),
      stop: async () => ({ alreadyExited: true, portFreed: true }),
    };
    const report = await runLab({
      artifactsRoot,
      screenshots: [],
      fixture: false,
      bootWebImpl: async () => fakeBoot,
    });

    const urlCheck = report.checks.find((check) => check.name === 'boot-url');
    const listeningCheck = report.checks.find((check) => check.name === 'boot-listening');
    assert.equal(urlCheck?.pass, true, JSON.stringify(report.checks));
    assert.equal(listeningCheck?.pass, false);
    assert.match(listeningCheck.detail, /never accepted a connection/);
    assert.equal(report.boot?.listening, false);
    assert.equal(report.boot?.port, 43210);

    // Fail fast: the token/route/DOM probes must never run.
    assert.equal(report.checks.some((check) => check.name === 'token-mint'), false);
    assert.equal(report.checks.some((check) => check.name.startsWith('route:')), false);
    assert.equal(report.browser, null);
    assert.equal(report.ok, false);

    // The diagnostic context still carries the boot log tail.
    assert.match((report.failureContext?.bootTail ?? []).join('\n'), /test-token|boot stderr tail/);
    assert.equal(report.cleanup.homeRemoved, true);
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
