import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveHostLauncher } from '../../src/boot-supervisor.js';

function makeLauncher(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-launcher-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, 'dsh.cmd');
  fs.writeFileSync(file, contents, 'utf8');
  return { dir, file };
}

test('resolveHostLauncher reads the exe and host entry out of an official dsh.cmd', () => {
  const launcher = makeLauncher([
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "ELECTRON_RUN_AS_NODE=1"',
    '"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*',
    'exit /b %errorlevel%',
    '',
  ].join('\r\n'));
  try {
    const resolved = resolveHostLauncher({ cmd: launcher.file });
    assert.ok(resolved, 'the official batch shape must resolve');
    const expectedExe = path.resolve(path.join(launcher.dir, 'bin', '..', '..', '..', '..', 'DeepSeek Harness.exe'));
    assert.equal(resolved.exe, expectedExe);
    assert.match(resolved.entry, /app\.asar[\\/]dsh[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]cli\.js$/);
  } finally {
    fs.rmSync(launcher.dir, { recursive: true, force: true });
  }
});

test('resolveHostLauncher refuses anything that is not the expected shape', () => {
  const plain = makeLauncher('@echo off\r\nnode somewhere\\cli.js %*\r\n');
  const noFlag = makeLauncher('@echo off\r\n"%~dp0\\x.exe" "%~dp0\\y.js" %*\r\n');
  try {
    assert.equal(resolveHostLauncher({ cmd: plain.file }), null, 'no --expose-internals means no IPC attempt');
    assert.equal(resolveHostLauncher({ cmd: noFlag.file }), null);
    assert.equal(resolveHostLauncher({ cmd: path.join(plain.dir, 'bin', 'nope.cmd') }), null);
    assert.equal(resolveHostLauncher(null), null);
  } finally {
    fs.rmSync(plain.dir, { recursive: true, force: true });
    fs.rmSync(noFlag.dir, { recursive: true, force: true });
  }
});
