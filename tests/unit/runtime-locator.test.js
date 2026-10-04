import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { findBrowser } from '../../src/browser-driver.js';
import { DEFAULT_RUNTIME_CMD } from '../../src/config.js';
import { locateRuntime, readRuntimeVersion } from '../../src/runtime-locator.js';

test('locateRuntime finds the official 0.2.0-rc.2 launcher', { skip: !fs.existsSync(DEFAULT_RUNTIME_CMD) }, () => {
  const runtime = locateRuntime();
  assert.equal(runtime.cmd, DEFAULT_RUNTIME_CMD);
  assert.equal(runtime.versions?.node, '24.18.1');
});

test('readRuntimeVersion reports 0.2.0-rc.2', { skip: !fs.existsSync(DEFAULT_RUNTIME_CMD), timeout: 60_000 }, async () => {
  const runtime = locateRuntime();
  const version = await readRuntimeVersion(runtime);
  assert.equal(version.version, '0.2.0-rc.2');
});

test('an explicit but missing runtime path is an error, not a fallback', () => {
  assert.throws(() => locateRuntime('D:\\does-not-exist\\dsh.cmd'), /explicit path/);
});

test('an explicit but missing browser path is an error, not a fallback', () => {
  assert.throws(() => findBrowser('D:\\does-not-exist\\msedge.exe'), /explicit path/);
});
