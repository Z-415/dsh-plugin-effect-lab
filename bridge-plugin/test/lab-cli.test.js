import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  buildShellArgs,
  buildVerifyArgs,
  killProcessTree,
  runLabVerify,
  sanitizeLabEnv,
  spawnLabShell,
} from '../lib/lab-cli.js';

test('buildVerifyArgs is offline by default and never passes --profile-lab', () => {
  const args = buildVerifyArgs({
    labEntry: 'C:/lab/bin/lab.js',
    pluginSpec: 'C:/plugins/foo',
    artifactsDir: 'C:/artifacts',
  });
  assert.deepEqual(args, [
    'C:/lab/bin/lab.js',
    'verify',
    '--plugin',
    'C:/plugins/foo',
    '--offline',
    '--json',
    '--artifacts',
    'C:/artifacts',
  ]);
  assert.equal(args.includes('--profile-lab'), false);
});

test('buildVerifyArgs switches to --online only when asked', () => {
  const args = buildVerifyArgs({
    labEntry: 'C:/lab/bin/lab.js',
    pluginSpec: 'some-plugin@1.0.0',
    online: true,
    artifactsDir: 'C:/artifacts',
  });
  assert.equal(args.includes('--online'), true);
  assert.equal(args.includes('--offline'), false);
  assert.equal(args.includes('--profile-lab'), false);
});

function fakeChild({ stdout = '', stderr = '', code = 0, onSpawn } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.exitCode = code;
  queueMicrotask(() => {
    onSpawn?.(child);
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    if (code !== null) child.emit('close', code);
  });
  return child;
}

test('a non-zero exit code still yields the report parsed from stdout', async () => {
  const report = { ok: false, runId: 'run-1', checks: [] };
  const outcome = await runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 5000,
    spawnImpl: () => fakeChild({ stdout: JSON.stringify(report), code: 1 }),
  });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.timedOut, false);
  assert.deepEqual(outcome.report, report);
});

test('non-JSON stdout is reported as an unparsed outcome', async () => {
  const outcome = await runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 5000,
    spawnImpl: () => fakeChild({ stdout: 'not json', stderr: 'boom', code: 2 }),
  });
  assert.equal(outcome.report, null);
  assert.equal(outcome.exitCode, 2);
  assert.equal(outcome.stderr, 'boom');
});

test('a hung child is killed and reported as timed out', async () => {
  let killedPid = null;
  const outcome = await runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 30,
    spawnImpl: () => {
      const child = fakeChild({ code: null });
      child.pid = 4242;
      return child;
    },
    killTreeImpl: (child) => { killedPid = child.pid; },
  });
  assert.equal(outcome.timedOut, true);
  assert.equal(killedPid, 4242);
});

test('killProcessTree uses taskkill /T /F on win32', () => {
  const calls = [];
  const result = killProcessTree({ pid: 9876 }, {
    platform: 'win32',
    spawnSyncImpl: (file, args, options) => {
      calls.push({ file, args, options });
      return { status: 0, stdout: 'SUCCESS', stderr: '' };
    },
  });
  assert.equal(result.killed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'taskkill');
  assert.deepEqual(calls[0].args, ['/PID', '9876', '/T', '/F']);
});

test('killProcessTree falls back to SIGKILL off win32', () => {
  let signal = null;
  const result = killProcessTree({ pid: 1, kill: (value) => { signal = value; } }, { platform: 'linux' });
  assert.equal(result.killed, true);
  assert.equal(signal, 'SIGKILL');
});

test('an already-aborted signal resolves aborted without spawning', async () => {
  let spawned = false;
  const controller = new AbortController();
  controller.abort();
  const outcome = await runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 1000,
    signal: controller.signal,
    spawnImpl: () => { spawned = true; return fakeChild({ code: 0 }); },
  });
  assert.equal(outcome.aborted, true);
  assert.equal(spawned, false);
});

test('aborting mid-run kills the process tree and resolves aborted', async () => {
  const controller = new AbortController();
  let killed = 0;
  const promise = runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 60_000,
    signal: controller.signal,
    spawnImpl: () => fakeChild({ code: null }),
    killTreeImpl: () => { killed += 1; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const outcome = await promise;
  assert.equal(outcome.aborted, true);
  assert.equal(killed, 1);
});

test('sanitizeLabEnv strips the real DSH home vars but keeps others', () => {
  const env = sanitizeLabEnv({
    DSH_HOME: 'C:/real',
    DSH_AGENTS_HOME: 'C:/real/agents',
    DSH_LAB_HOME: 'C:/lab',
    PATH: 'x',
  });
  assert.equal('DSH_HOME' in env, false);
  assert.equal('DSH_AGENTS_HOME' in env, false);
  assert.equal(env.DSH_LAB_HOME, 'C:/lab');
  assert.equal(env.PATH, 'x');
});

test('buildShellArgs opens a visible keep-open shell and never passes --profile-lab', () => {
  const args = buildShellArgs({ labEntry: 'C:/lab/bin/lab.js', pluginSpec: 'C:/plugins/foo', online: false });
  assert.deepEqual(args, [
    'C:/lab/bin/lab.js',
    'shell',
    '--offline',
    '--show',
    '--no-compare-web',
    '--plugin',
    'C:/plugins/foo',
    '--keep-open',
  ]);
  assert.equal(args.includes('--profile-lab'), false);
});

test('buildShellArgs supports a plain timed shell without a plugin', () => {
  const args = buildShellArgs({ labEntry: 'lab.js', holdMs: 20000 });
  assert.equal(args.includes('--plugin'), false);
  assert.deepEqual(args.slice(-2), ['--show-hold', '20000']);
  assert.equal(args.includes('--keep-open'), false);
});

test('spawnLabShell detaches, ignores stdio, and never inherits DSH_HOME', () => {
  const calls = [];
  const child = { pid: 4242, unref() { calls.push(['unref']); } };
  const result = spawnLabShell({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    cwd: 'C:/lab',
    env: { DSH_HOME: 'C:/real', DSH_AGENTS_HOME: 'C:/real/agents', PATH: 'x' },
    spawnImpl: (file, args, options) => {
      calls.push({ file, args, options });
      return child;
    },
  });
  assert.equal(result.pid, 4242);
  const spawnCall = calls.find((call) => call.file);
  assert.equal(spawnCall.options.detached, true);
  assert.equal(spawnCall.options.stdio, 'ignore');
  assert.equal('DSH_HOME' in spawnCall.options.env, false);
  assert.equal(spawnCall.options.env.PATH, 'x');
  assert.deepEqual(calls.at(-1), ['unref']);
});

test('runLabVerify strips the host DSH_HOME from the lab environment', async () => {
  let captured = null;
  await runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 5000,
    env: { DSH_HOME: 'C:/real', DSH_AGENTS_HOME: 'C:/real/agents', PATH: 'x' },
    spawnImpl: (file, args, options) => { captured = options; return fakeChild({ code: 0 }); },
  });
  assert.equal('DSH_HOME' in captured.env, false);
  assert.equal('DSH_AGENTS_HOME' in captured.env, false);
  assert.equal(captured.env.PATH, 'x');
});

test('a spawn failure resolves instead of throwing', async () => {
  const outcome = await runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 1000,
    spawnImpl: () => { throw new Error('spawn EPERM'); },
  });
  assert.equal(outcome.report, null);
  assert.equal(outcome.spawnError, true);
  assert.match(outcome.stderr, /spawn EPERM/);
});
