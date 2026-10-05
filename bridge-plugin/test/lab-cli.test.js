import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { buildVerifyArgs, runLabVerify } from '../lib/lab-cli.js';

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
  let killed = false;
  const outcome = await runLabVerify({
    nodeExe: 'node',
    labEntry: 'lab.js',
    pluginSpec: 'p',
    artifactsDir: 'a',
    timeoutMs: 30,
    spawnImpl: () => {
      const child = fakeChild({ code: null });
      const originalKill = child.kill;
      child.kill = () => { killed = true; originalKill(); };
      return child;
    },
  });
  assert.equal(outcome.timedOut, true);
  assert.equal(killed, true);
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
