import assert from 'node:assert/strict';
import test from 'node:test';
import { reapBrowserProcesses, removeDirWithRetry } from '../../src/browser-driver.js';

test('reapBrowserProcesses is a no-op off Windows', () => {
  const result = reapBrowserProcesses('C:/tmp/dsh-lab-browser-x', { platform: 'linux' });
  assert.deepEqual(result, { supported: false, matched: 0 });
});

test('reapBrowserProcesses ignores an empty target', () => {
  assert.deepEqual(reapBrowserProcesses(''), { supported: true, matched: 0 });
  assert.deepEqual(reapBrowserProcesses(null), { supported: true, matched: 0 });
});

test('reapBrowserProcesses matches nothing for a process name that cannot exist', {
  skip: process.platform !== 'win32',
  timeout: 60_000,
}, () => {
  const result = reapBrowserProcesses('C:/tmp/dsh-lab-browser-none', { name: 'dsh-lab-no-such-process.exe' });
  assert.equal(result.supported, true);
  assert.equal(result.matched, 0);
});

test('reapBrowserProcesses survives a target directory containing a quote', {
  skip: process.platform !== 'win32',
  timeout: 60_000,
}, () => {
  const result = reapBrowserProcesses("C:/tmp/dsh-lab-browser-o'brien", { name: 'dsh-lab-no-such-process.exe' });
  assert.equal(result.supported, true);
  assert.equal(result.matched, 0);
});

test('removeDirWithRetry retries a transient EBUSY and then removes the dir', async () => {
  const calls = [];
  let present = true;
  const removal = await removeDirWithRetry('C:/tmp/dsh-lab-browser-busy', {
    attempts: 5,
    delayMs: 1,
    rm: () => {
      calls.push('rm');
      if (calls.length < 3) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
      present = false;
    },
    exists: () => present,
  });
  assert.equal(removal.removed, true);
  assert.equal(removal.attempts, 3);
  assert.equal(calls.length, 3);
});

test('removeDirWithRetry reports a still-present dir instead of swallowing the error', async () => {
  const removal = await removeDirWithRetry('C:/tmp/dsh-lab-browser-locked', {
    attempts: 3,
    delayMs: 1,
    rm: () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    },
    exists: () => true,
  });
  assert.equal(removal.removed, false);
  assert.equal(removal.attempts, 3);
  assert.match(String(removal.error), /EPERM/);
});

test('removeDirWithRetry is a no-op when the dir is already gone', async () => {
  const removal = await removeDirWithRetry('C:/tmp/dsh-lab-browser-gone', {
    rm: () => {},
    exists: () => false,
  });
  assert.equal(removal.removed, true);
  assert.equal(removal.attempts, 1);
});
