import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runRuntimeMatrix } from '../../src/matrix-runner.js';

test('runRuntimeMatrix runs each supported runtime and skips the unsupported ones', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-runtime-matrix-'));
  const calls = [];
  const runMatrixImpl = async (options) => {
    calls.push(options);
    return {
      matrixId: options.matrixId,
      ok: true,
      runs: [{ id: 'baseline' }, { id: 'probe' }],
      conflicts: { tokens: [], bodyAttributes: [], slots: [], layers: [] },
      classification: { summary: { coexist: ['probe'], 'manual-review': [], 'high-conflict': [] } },
      root: path.join(options.artifactsRoot, options.matrixId),
    };
  };
  try {
    const summary = await runRuntimeMatrix({
      configFile: 'fixtures/matrix/effect-conflict.json',
      artifactsRoot: root,
      runtimes: [
        { cmd: 'C:\\a\\dsh.cmd', version: '0.2.0-rc.2', status: 'verified', supported: true },
        { cmd: 'C:\\b\\dsh.cmd', version: '0.2.1', status: 'untested', supported: true },
        { cmd: 'C:\\c\\dsh.cmd', version: '0.3.0', status: 'unsupported', supported: false },
      ],
      runMatrixImpl,
    });
    assert.equal(calls.length, 2, 'only supported runtimes are run');
    assert.deepEqual(calls.map((call) => call.runtimePath), ['C:\\a\\dsh.cmd', 'C:\\b\\dsh.cmd']);
    assert.equal(calls[0].matrixId.endsWith('-0.2.0-rc.2'), true, calls[0].matrixId);
    assert.equal(calls[1].matrixId.endsWith('-0.2.1'), true, calls[1].matrixId);
    assert.equal(summary.ok, true);
    assert.deepEqual(summary.runtimes.map((entry) => entry.version), ['0.2.0-rc.2', '0.2.1']);
    assert.deepEqual(summary.skipped.map((entry) => entry.version), ['0.3.0']);
    assert.equal(fs.existsSync(summary.artifacts.summaryJson), true);
    assert.equal(fs.existsSync(summary.artifacts.summaryMd), true);
    const written = JSON.parse(fs.readFileSync(summary.artifacts.summaryJson, 'utf8'));
    assert.equal(written.skipped.length, 1);
    assert.match(fs.readFileSync(summary.artifacts.summaryMd, 'utf8'), /版本矩阵/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runRuntimeMatrix reports a failed version as not ok', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-runtime-matrix-'));
  try {
    const summary = await runRuntimeMatrix({
      artifactsRoot: root,
      runtimes: [{ cmd: 'C:\\a\\dsh.cmd', version: '0.2.0-rc.2', status: 'verified', supported: true }],
      runMatrixImpl: async (options) => ({
        matrixId: options.matrixId,
        ok: false,
        runs: [{ id: 'baseline' }],
        conflicts: { tokens: [], bodyAttributes: [], slots: [], layers: [] },
        classification: { summary: { coexist: [], 'manual-review': [], 'high-conflict': [] } },
        root: options.artifactsRoot,
      }),
    });
    assert.equal(summary.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runRuntimeMatrix refuses to run when nothing is supported', async () => {
  await assert.rejects(
    () => runRuntimeMatrix({ runtimes: [{ cmd: 'x', version: '0.1.0', status: 'unsupported', supported: false }] }),
    /no supported dsh runtime/,
  );
});
