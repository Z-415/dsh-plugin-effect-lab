import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildScanReport, latestRunLogs } from '../../src/commands/scan.js';

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-scan-'));
}

function makeRun(root, name, mtimeMs, files = []) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), 'x\n', 'utf8');
  fs.utimesSync(dir, new Date(mtimeMs), new Date(mtimeMs));
  return dir;
}

test('latestRunLogs returns null when artifacts/ has no run with logs', () => {
  const root = makeRoot();
  try {
    assert.equal(latestRunLogs(root), null);
    assert.equal(latestRunLogs(path.join(root, 'does-not-exist')), null);
    makeRun(root, 'no-logs', 1000);
    assert.equal(latestRunLogs(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('latestRunLogs returns the newest run that has boot logs', () => {
  const root = makeRoot();
  try {
    makeRun(root, 'older', 1000, ['boot.err.log']);
    const newer = makeRun(root, 'newer', 5000, ['boot.err.log', 'boot.out.log']);
    const latest = latestRunLogs(root);
    assert.equal(latest.runDir, newer);
    assert.deepEqual(latest.logs.map((file) => path.basename(file)), ['boot.err.log', 'boot.out.log']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('latestRunLogs skips the newest directory when it has no boot logs', () => {
  const root = makeRoot();
  try {
    const older = makeRun(root, 'with-logs', 1000, ['boot.err.log']);
    makeRun(root, 'empty-newest', 9000);
    assert.equal(latestRunLogs(root).runDir, older);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildScanReport carries the log tail when nothing matches', () => {
  const report = buildScanReport({ files: ['x.log'], text: 'line one\nweird failure xyz\n' });
  assert.deepEqual(report.hits, []);
  assert.equal(report.fatal, false);
  assert.equal(report.unknownFailure, true);
  assert.deepEqual(report.tail, ['line one', 'weird failure xyz']);
  assert.match(report.summary, /No known failure signatures matched/);
});

test('buildScanReport treats a clean log as clean, not as an unknown failure', () => {
  const empty = buildScanReport({ text: '' });
  assert.equal(empty.unknownFailure, false);
  assert.equal(empty.tail, undefined);

  const clean = buildScanReport({ text: '[dsh] booting\n[dsh] dsh web: http://127.0.0.1:1 (ready)\n' });
  assert.equal(clean.unknownFailure, false, 'a clean boot log must not be reported as an unknown failure');
  assert.equal(clean.tail, undefined);

  // Asking for an explanation always attaches the tail, even on a clean log.
  const explained = buildScanReport({ text: '[dsh] booting\n', explain: true });
  assert.equal(explained.unknownFailure, false);
  assert.deepEqual(explained.tail, ['[dsh] booting']);
});

test('buildScanReport adds surrounding lines for each hit only with explain', () => {
  const text = ['boot ok', 'Error: EADDRINUSE: address already in use', 'cleanup failed'].join('\n');
  const plain = buildScanReport({ text, explain: false });
  assert.equal(plain.fatal, true);
  assert.equal(plain.explanations, undefined);
  assert.equal(plain.tail, undefined);

  const explained = buildScanReport({ text, explain: true });
  assert.equal(explained.explanations.length, 1);
  assert.equal(explained.explanations[0].id, 'port-in-use');
  assert.deepEqual(explained.explanations[0].lines, [
    'boot ok',
    'Error: EADDRINUSE: address already in use',
    'cleanup failed',
  ]);
});
