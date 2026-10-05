import assert from 'node:assert/strict';
import test from 'node:test';
import { BridgeBusyError, createVerifyController, publicJobView } from '../lib/verify-controller.js';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('start exposes a running job and resolves to a summarized done job', async () => {
  const gate = deferred();
  let received = null;
  const controller = createVerifyController({
    getConfig: () => ({ nodeExe: 'node', labEntry: 'lab.js', artifactsDir: 'a', timeoutMs: 1000, labRoot: '.' }),
    runVerify: (options) => { received = options; return gate.promise; },
    now: () => 42,
    idFactory: () => 'job-1',
  });
  const job = controller.start({ plugin: 'p', online: true });
  assert.equal(job.id, 'job-1');
  assert.equal(job.status, 'running');
  assert.equal(received.pluginSpec, 'p');
  assert.equal(received.online, true);
  assert.equal(received.signal instanceof AbortSignal, true);

  gate.resolve({ exitCode: 0, timedOut: false, aborted: false, report: { ok: true, runId: 'r1', checks: [] }, stderr: '' });
  await new Promise((resolve) => setImmediate(resolve));
  const view = publicJobView(controller.status());
  assert.equal(view.status, 'done');
  assert.equal(view.summary.ok, true);
  assert.equal(view.summary.runId, 'r1');
  assert.equal(view.finishedAt, 42);
  assert.equal('controller' in view, false);
  assert.equal('outcome' in view, false);
});

test('a second start while running is rejected as busy', () => {
  const controller = createVerifyController({
    getConfig: () => ({ nodeExe: 'node', labEntry: 'lab.js', artifactsDir: 'a', timeoutMs: 1000, labRoot: '.' }),
    runVerify: () => new Promise(() => {}),
  });
  controller.start({ plugin: 'p' });
  assert.throws(() => controller.start({ plugin: 'q' }), BridgeBusyError);
});

test('cancel aborts the running signal and marks the job cancelled', async () => {
  const gate = deferred();
  let signal = null;
  const controller = createVerifyController({
    getConfig: () => ({ nodeExe: 'node', labEntry: 'lab.js', artifactsDir: 'a', timeoutMs: 1000, labRoot: '.' }),
    runVerify: (options) => { signal = options.signal; return gate.promise; },
  });
  controller.start({ plugin: 'p' });
  assert.equal(signal.aborted, false);
  controller.cancel();
  assert.equal(signal.aborted, true);
  gate.resolve({ exitCode: null, timedOut: false, aborted: true, report: null, stderr: '' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.status().status, 'cancelled');
});

test('a rejected runner marks the job as error', async () => {
  const gate = deferred();
  const controller = createVerifyController({
    getConfig: () => ({ nodeExe: 'node', labEntry: 'lab.js', artifactsDir: 'a', timeoutMs: 1000, labRoot: '.' }),
    runVerify: () => gate.promise,
  });
  controller.start({ plugin: 'p' });
  gate.resolve(Promise.reject(new Error('boom')));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.status().status, 'error');
  assert.equal(controller.status().error, 'boom');
});
