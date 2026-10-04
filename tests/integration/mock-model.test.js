import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('loopback mock model drives a real streamed tool turn', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-mock-e2e-'));
  try {
    const report = await runLab({
      mockModel: true,
      fixture: false,
      screenshots: ['home'],
      assertTokens: ['--dsw-alias-bg-base'],
      artifactsRoot,
    });
    assert.equal(report.mockModel.turnEnded, true, JSON.stringify(report.checks, null, 2));
    assert.equal(report.mockModel.eventTypes.includes('assistant/message'), true);
    assert.equal(report.mockModel.eventTypes.includes('tool/result'), true);
    assert.equal(report.mockModel.requests >= 2, true);
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
