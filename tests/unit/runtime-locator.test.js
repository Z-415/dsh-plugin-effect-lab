import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findBrowser } from '../../src/browser-driver.js';
import { DEFAULT_RUNTIME_CMD } from '../../src/config.js';
import {
  discoverRuntimes,
  extraRuntimeCandidates,
  locateRuntime,
  readRuntimeVersion,
} from '../../src/runtime-locator.js';

test('locateRuntime finds the official launcher', { skip: !fs.existsSync(DEFAULT_RUNTIME_CMD) }, () => {
  const runtime = locateRuntime();
  assert.equal(runtime.cmd, DEFAULT_RUNTIME_CMD);
});

test('readRuntimeVersion parses the installed runtime version', { skip: !fs.existsSync(DEFAULT_RUNTIME_CMD), timeout: 60_000 }, async () => {
  const runtime = locateRuntime();
  const version = await readRuntimeVersion(runtime);
  assert.match(String(version.version), /^\d+\.\d+\.\d+/, `got ${version.version}`);
});

test('an explicit but missing runtime path is an error, not a fallback', () => {
  assert.throws(() => locateRuntime('D:\\does-not-exist\\dsh.cmd'), /explicit path/);
});

test('an explicit but missing browser path is an error, not a fallback', () => {
  assert.throws(() => findBrowser('D:\\does-not-exist\\msedge.exe'), /explicit path/);
});

test('extraRuntimeCandidates accepts a launcher, an install dir, and a runtime dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-runtimes-'));
  try {
    const install = path.join(root, 'Install');
    const launcher = path.join(install, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, '@echo off\n', 'utf8');
    const runtimeDir = path.join(root, 'Runtime');
    const runtimeLauncher = path.join(runtimeDir, 'cli', 'bin', 'dsh.cmd');
    fs.mkdirSync(path.dirname(runtimeLauncher), { recursive: true });
    fs.writeFileSync(runtimeLauncher, '@echo off\n', 'utf8');

    const candidates = extraRuntimeCandidates({
      DSH_LAB_RUNTIMES: [launcher, install, runtimeDir, ''].join(';'),
    });
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0], launcher, 'an explicit dsh.cmd is used as-is');
    assert.equal(candidates[1], launcher, 'an install dir resolves to its launcher');
    assert.equal(candidates[2], runtimeLauncher, 'a runtime dir resolves to its launcher');
    assert.deepEqual(extraRuntimeCandidates({}), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverRuntimes reads the version and classifies an extra runtime', {
  skip: process.platform !== 'win32',
  timeout: 120_000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-fake-runtime-'));
  const launcher = path.join(root, 'bin', 'dsh.cmd');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  // A stand-in launcher: `dsh --version` only needs to print a version line.
  fs.writeFileSync(launcher, '@echo off\r\necho 0.9.9\r\n', 'utf8');
  const previous = process.env.DSH_LAB_RUNTIMES;
  process.env.DSH_LAB_RUNTIMES = root;
  try {
    const runtimes = await discoverRuntimes({ timeoutMs: 30_000 });
    const fake = runtimes.find((runtime) => runtime.cmd.toLowerCase() === path.resolve(launcher).toLowerCase());
    assert.ok(fake, JSON.stringify(runtimes));
    assert.equal(fake.version, '0.9.9');
    assert.equal(fake.status, 'unsupported', 'a 0.9.x runtime is outside the supported range');
    assert.equal(fake.supported, false);
    assert.equal(fake.isDefault, false);
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_RUNTIMES;
    else process.env.DSH_LAB_RUNTIMES = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
