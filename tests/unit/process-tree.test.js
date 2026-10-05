import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { childEnv, quoteForCmd, resolveCommand, spawnTracked, stopTracked } from '../../src/process-tree.js';

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

test('childEnv strips ELECTRON_RUN_AS_NODE but keeps the parent and overrides', () => {
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  process.env.DSH_LAB_CHILD_ENV_TEST = 'kept';
  try {
    const env = childEnv({ DSH_LAB_SHELL_CONFIG: 'config.json' });
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.DSH_LAB_CHILD_ENV_TEST, 'kept');
    assert.equal(env.DSH_LAB_SHELL_CONFIG, 'config.json');
    assert.equal(childEnv().ELECTRON_RUN_AS_NODE, undefined);
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previous;
    delete process.env.DSH_LAB_CHILD_ENV_TEST;
  }
});

test('childEnv can put ELECTRON_RUN_AS_NODE back for the host child', () => {
  assert.equal(childEnv({}, { runAsNode: true }).ELECTRON_RUN_AS_NODE, '1');
  assert.equal(childEnv({ ELECTRON_RUN_AS_NODE: '1' }).ELECTRON_RUN_AS_NODE, undefined);
});

test('spawnTracked with ipc delivers the child message and a Node-mode env', {
  timeout: 30_000,
}, async (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-ipc-'));
  const script = path.join(dir, 'child.mjs');
  fs.writeFileSync(script, [
    "process.send?.({",
    "  type: 'ready',",
    "  connected: process.connected,",
    "  runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,",
    "});",
    'setTimeout(() => process.exit(0), 500);',
    '',
  ].join('\n'), 'utf8');
  try {
    let timed;
    try {
      timed = spawnTracked(process.execPath, [script], { ipc: true, runAsNode: true });
    } catch (error) {
      // A sandbox that denies spawning with an ipc stdio entry reports EPERM.
      if (String(error?.code) === 'EPERM') {
        context.skip('this environment denies spawning with an ipc channel');
        return;
      }
      throw error;
    }
    const message = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 10_000);
      timed.child.on('message', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    assert.ok(message, 'the child message must arrive');
    assert.equal(message.type, 'ready');
    assert.equal(message.connected, true);
    assert.equal(message.runAsNode, '1', 'runAsNode must survive childEnv');
    await stopTracked(timed, { label: 'ipc child' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
