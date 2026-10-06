import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const labEntry = path.resolve('bin', 'lab.js');

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('a passing verify writes a redacted bundle with LAB-OK', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = makeRoot('dsh-lab-diag-ok-');
  const bundlePath = path.join(root, 'diag', 'bundle.json');
  try {
    const report = await runLab({
      fixture: false,
      screenshots: ['home'],
      artifactsRoot: root,
      html: false,
      diagnosticsBundle: bundlePath,
    });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(report.errorCode, 'LAB-OK');
    assert.equal(report.diagnostics.primaryCode, 'LAB-OK');
    assert.deepEqual(report.diagnostics.errorCodes, []);
    assert.equal(report.artifacts.diagnosticsBundle, path.resolve(bundlePath));
    assert.equal(fs.existsSync(bundlePath), true);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    assert.equal(bundle.diagnostics.primaryCode, 'LAB-OK');
    assert.equal(bundle.diagnostics.exclusions.credentials, false);
    assert.equal(bundle.diagnostics.exclusions.sessions, false);
    assert.equal(bundle.diagnostics.exclusions.settings, false);
    const text = fs.readFileSync(bundlePath, 'utf8');
    assert.equal(text.includes(os.homedir()), false, 'the bundle must not leak the absolute home path');
    assert.equal(/token=[A-Za-z0-9]/.test(text), false, 'the bundle must not leak a launch token');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unmatched failure writes LAB-UNKNOWN with evidence', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const root = makeRoot('dsh-lab-diag-unknown-');
  const bundlePath = path.join(root, 'bundle.json');
  try {
    const report = await runLab({
      plugins: ['./fixtures/plugins/does-not-exist'],
      artifactsRoot: root,
      html: false,
      diagnosticsBundle: bundlePath,
    });
    assert.equal(report.ok, false);
    assert.equal(report.errorCode, 'LAB-UNKNOWN');
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    assert.equal(bundle.diagnostics.primaryCode, 'LAB-UNKNOWN');
    assert.deepEqual(bundle.diagnostics.errorCodes, ['LAB-UNKNOWN']);
    assert.equal(bundle.diagnostics.unknown, true);
    const hasEvidence = (bundle.diagnostics.bootTail ?? []).length > 0
      || (bundle.diagnostics.failureContext?.errors ?? []).length > 0;
    assert.equal(hasEvidence, true, JSON.stringify(bundle.diagnostics));
    assert.equal(fs.readFileSync(bundlePath, 'utf8').includes(os.homedir()), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lab scan --list and --explain print stable error codes', () => {
  const list = execFileSync(process.execPath, [labEntry, 'scan', '--list'], { encoding: 'utf8' });
  assert.match(list, /LAB-PLUGIN-001 duplicate-loader-id/);
  assert.match(list, /LAB-BOOT-002 port-in-use/);

  const root = makeRoot('dsh-lab-scan-explain-');
  const logFile = path.join(root, 'boot.err.log');
  fs.writeFileSync(logFile, 'Error: listen EADDRINUSE: address already in use 127.0.0.1:5566\n', 'utf8');
  try {
    let explain = null;
    try {
      explain = execFileSync(process.execPath, [labEntry, 'scan', '--log', logFile, '--explain'], { encoding: 'utf8' });
    } catch (error) {
      // A fatal hit makes scan exit 1 after printing the explanation.
      assert.equal(error.status, 1, String(error.status));
      explain = error.stdout;
    }
    assert.match(explain, /LAB-BOOT-002 port-in-use/);
    assert.match(explain, /context for LAB-BOOT-002 port-in-use/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lab diagnose --log maps a known signature to its code', () => {
  const root = makeRoot('dsh-lab-diagnose-log-');
  const logFile = path.join(root, 'boot.err.log');
  fs.writeFileSync(logFile, 'Error: listen EADDRINUSE: address already in use 127.0.0.1:5566\n', 'utf8');
  try {
    let stdout = null;
    try {
      stdout = execFileSync(process.execPath, [labEntry, 'diagnose', '--log', logFile, '--json'], { encoding: 'utf8' });
    } catch (error) {
      // A failing log makes diagnose exit 1 after printing the JSON payload.
      assert.equal(error.status, 1, String(error.status));
      stdout = error.stdout;
    }
    const diagnostics = JSON.parse(stdout);
    assert.equal(diagnostics.primaryCode, 'LAB-BOOT-002');
    assert.equal(diagnostics.unknown, false);
    assert.equal(diagnostics.source, path.resolve(logFile));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
