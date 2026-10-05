import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { latestRunLogs } from '../../src/commands/scan.js';

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
