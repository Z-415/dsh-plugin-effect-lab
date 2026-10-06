import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const labEntry = path.resolve('bin', 'lab.js');
const MARKER = '\u001eLABPROG\u001e';

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('runLab reports the eight phases in order with structure and timing', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = makeRoot('dsh-lab-progress-e2e-');
  try {
    const events = [];
    const report = await runLab({
      fixture: false,
      screenshots: ['home'],
      artifactsRoot: root,
      html: false,
      onProgress: (event) => events.push(event),
    });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(events.length > 0, true);
    for (const event of events) {
      assert.equal(typeof event.phase, 'string');
      assert.equal(typeof event.index, 'number');
      assert.equal(event.total, 8);
      assert.equal(typeof event.detail, 'string');
    }
    const indexes = events.map((event) => event.index);
    assert.deepEqual([...indexes].sort((a, b) => a - b), indexes, 'phase index must never go backwards');
    const phases = new Set(events.map((event) => event.phase));
    for (const phase of ['locate-runtime', 'snapshot', 'isolated-home', 'install-plugins', 'boot-host', 'probe-ui', 'cleanup', 'write-report']) {
      assert.equal(phases.has(phase), true, `${phase} missing from ${[...phases].join(', ')}`);
    }
    const boot = events.find((event) => event.phase === 'boot-host');
    assert.match(boot.label, /启动宿主/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the GUI-structured CLI stream carries machine and human progress lines', {
  skip: !enabled,
  timeout: 180_000,
}, () => {
  const root = makeRoot('dsh-lab-progress-cli-');
  try {
    const stdout = execFileSync(process.execPath, [
      labEntry,
      'verify',
      '--no-fixture',
      '--no-html',
      '--screenshot', 'home',
      '--artifacts', root,
    ], {
      encoding: 'utf8',
      env: { ...process.env, DSH_LAB_GUI: '1' },
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(stdout.includes(MARKER), true, 'expected a machine progress line');
    assert.match(stdout, /\[1\/8\] 定位 runtime/);
    assert.match(stdout, /\[5\/8\] 启动宿主/);
    assert.match(stdout, /\[8\/8\] 写报告/);
    const machine = stdout.split('\n').find((line) => line.startsWith(MARKER));
    const event = JSON.parse(machine.slice(MARKER.length));
    assert.equal(event.total, 8);
    assert.equal(typeof event.index, 'number');
    assert.equal(typeof event.phaseMs, 'number');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
