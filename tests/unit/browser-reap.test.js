import assert from 'node:assert/strict';
import test from 'node:test';
import { reapBrowserProcesses } from '../../src/browser-driver.js';

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
