import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteForCmd, resolveCommand } from '../../src/process-tree.js';

test('quoteForCmd quotes paths with spaces', () => {
  assert.equal(quoteForCmd('D:\\DeepSeek Harness\\dsh.cmd'), '"D:\\DeepSeek Harness\\dsh.cmd"');
  assert.equal(quoteForCmd('--profile'), '--profile');
});

test('resolveCommand routes .cmd launchers through cmd.exe on Windows', () => {
  const resolved = resolveCommand('D:\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd', ['--version'], 'win32');
  assert.match(resolved.file, /cmd\.exe$/i);
  assert.equal(resolved.args[0], '/d');
  assert.match(resolved.args.at(-1), /dsh\.cmd/);
});

test('resolveCommand leaves ordinary executables alone', () => {
  const resolved = resolveCommand('node.exe', ['--version'], 'win32');
  assert.equal(resolved.file, 'node.exe');
  assert.deepEqual(resolved.args, ['--version']);
});
