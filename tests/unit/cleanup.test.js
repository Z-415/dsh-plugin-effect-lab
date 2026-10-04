import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { diffResidue, listLabResidue, snapshotLabResidue, verifyNoResidue } from '../../src/cleanup.js';

function makeTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('diffResidue reports homes created and removed by a run', () => {
  const before = { homes: [{ path: 'C:\\tmp\\dsh-lab-a' }] };
  const after = { homes: [{ path: 'C:\\tmp\\dsh-lab-a' }, { path: 'C:\\tmp\\dsh-lab-b' }] };
  const diff = diffResidue(before, after);
  assert.deepStrictEqual(diff.newHomes.map((item) => item.path), ['C:\\tmp\\dsh-lab-b']);
  assert.deepStrictEqual(diff.removedHomes, []);
});

test('listLabResidue reports real lab homes and skips the electron cache', () => {
  const cache = makeTemp('dsh-lab-electron-');
  const home = makeTemp('dsh-lab-unit-');
  fs.mkdirSync(path.join(home, 'home'), { recursive: true });
  try {
    const residue = listLabResidue();
    const paths = residue.map((item) => item.path.toLowerCase());
    assert.equal(paths.includes(path.resolve(home).toLowerCase()), true);
    assert.equal(paths.includes(path.resolve(cache).toLowerCase()), false);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('verifyNoResidue passes when the root is gone and no port listens', async () => {
  const missing = path.join(os.tmpdir(), `dsh-lab-missing-${Date.now()}`);
  // Pin `after` to `before`: other test files create lab homes concurrently.
  const before = snapshotLabResidue();
  const result = await verifyNoResidue({
    isolatedRoot: missing,
    ports: [],
    before,
    after: before,
  });
  assert.equal(result.ok, true);
  assert.deepStrictEqual(result.failures, []);
});

test('verifyNoResidue fails when the isolated root still exists', async () => {
  const root = makeTemp('dsh-lab-verify-');
  const before = snapshotLabResidue();
  try {
    const result = await verifyNoResidue({
      isolatedRoot: root,
      ports: [],
      before,
      after: before,
    });
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.failures, ['isolated-root-removed']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a new lab home is advisory, not a hard failure', async () => {
  const missing = path.join(os.tmpdir(), `dsh-lab-missing-${Date.now()}`);
  const result = await verifyNoResidue({
    isolatedRoot: missing,
    ports: [],
    before: { homes: [] },
    after: { homes: [{ path: 'C:\\tmp\\dsh-lab-other' }] },
  });
  assert.equal(result.ok, true);
  assert.deepStrictEqual(result.advisory, { 'no-new-lab-homes': false });
  assert.deepStrictEqual(result.newHomes.map((item) => item.path), ['C:\\tmp\\dsh-lab-other']);
});
