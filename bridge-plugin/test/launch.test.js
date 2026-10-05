import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createGuiLauncher, launchArgs, sanitizeLaunchEnv } from '../lib/launch.js';

const labRoot = path.resolve('C:/lab');
const config = { labRoot, nodeExe: path.resolve('C:/node/node.exe') };

test('launchArgs is fixed to bin/lab.js gui with no caller argv', () => {
  const args = launchArgs(path.join(labRoot, 'bin', 'lab.js'));
  assert.deepEqual(args, [path.join(labRoot, 'bin', 'lab.js'), 'gui']);
});

test('sanitizeLaunchEnv strips Electron and real-home variables', () => {
  const env = sanitizeLaunchEnv({
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: 'C:/real',
    DSH_AGENTS_HOME: 'C:/real/agents',
    PATH: 'x',
  });
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false);
  assert.equal('DSH_HOME' in env, false);
  assert.equal('DSH_AGENTS_HOME' in env, false);
  assert.equal(env.PATH, 'x');
});

test('the GUI launcher spawns detached from the lab root and unrefs', () => {
  const calls = [];
  const child = { pid: 4242, unref() { calls.push(['unref']); } };
  const launcher = createGuiLauncher({
    getConfig: () => config,
    env: { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: 'C:/real', PATH: 'x' },
    exists: () => true,
    now: () => 1000,
    spawnImpl: (file, args, options) => {
      calls.push({ file, args, options });
      return child;
    },
  });
  const result = launcher();
  assert.equal(result.pid, 4242);
  const spawnCall = calls.find((call) => call.file);
  assert.equal(spawnCall.file, config.nodeExe);
  assert.deepEqual(spawnCall.args, [path.join(labRoot, 'bin', 'lab.js'), 'gui']);
  assert.equal(spawnCall.options.cwd, labRoot);
  assert.equal(spawnCall.options.detached, true);
  assert.equal(spawnCall.options.stdio, 'ignore');
  assert.equal('ELECTRON_RUN_AS_NODE' in spawnCall.options.env, false);
  assert.equal('DSH_HOME' in spawnCall.options.env, false);
  assert.deepEqual(calls.at(-1), ['unref']);
});

test('the GUI launcher throttles repeated clicks', () => {
  let now = 1000;
  const launcher = createGuiLauncher({
    getConfig: () => config,
    exists: () => true,
    spawnImpl: () => ({ pid: 1, unref() {} }),
    now: () => now,
    throttleMs: 5000,
  });
  launcher();
  assert.throws(() => launcher(), (error) => error.code === 'LAUNCH_THROTTLED');
  now += 6000;
  assert.doesNotThrow(() => launcher());
});
