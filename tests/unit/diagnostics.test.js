import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLogDiagnostics, latestReportFile } from '../../src/commands/diagnose.js';
import { redactText, summarizeDiagnostics, writeDiagnosticsBundle } from '../../src/diagnostics.js';

function fakeReport(overrides = {}) {
  return {
    runId: 'run-1',
    ok: false,
    mode: 'web',
    runtime: { version: '0.2.0-rc.2', compat: { status: 'verified' } },
    checks: [
      { name: 'boot-listening', pass: false, detail: 'port not accepting connections', informational: false },
      { name: 'console-errors', pass: false, detail: '1 console error', informational: true },
      { name: 'runtime-version', pass: true, detail: 'ok' },
    ],
    signatureHits: [
      {
        code: 'LAB-BOOT-002',
        id: 'port-in-use',
        category: 'boot',
        severity: 'fatal',
        matched: 'EADDRINUSE',
        rootCause: 'port busy',
        fix: 'use port 0',
      },
    ],
    bootTail: ['listening on 127.0.0.1:5555?token=abcdef123456', 'apiKey: supersecretvalue123'],
    artifacts: { reportJson: 'C:\\Users\\someone\\artifacts\\run-1\\report.json' },
    ...overrides,
  };
}

test('summarizeDiagnostics turns a report into stable error codes and failed checks', () => {
  const diagnostics = summarizeDiagnostics(fakeReport());
  assert.equal(diagnostics.primaryCode, 'LAB-BOOT-002');
  assert.deepEqual(diagnostics.errorCodes, ['LAB-BOOT-002']);
  assert.equal(diagnostics.unknown, false);
  assert.equal(diagnostics.signatures[0].id, 'port-in-use');
  assert.deepEqual(diagnostics.failedChecks.map((check) => check.name), ['boot-listening']);
  assert.equal(diagnostics.checks.length, 3);
  assert.equal(diagnostics.exclusions.credentials, false);
});

test('an unmatched failure reports LAB-UNKNOWN with evidence', () => {
  const diagnostics = summarizeDiagnostics(fakeReport({ signatureHits: [], bootTail: ['SomethingWeirdError: widget exploded'] }));
  assert.equal(diagnostics.primaryCode, 'LAB-UNKNOWN');
  assert.deepEqual(diagnostics.errorCodes, ['LAB-UNKNOWN']);
  assert.equal(diagnostics.unknown, true);
  assert.equal(diagnostics.bootTail.length, 1);
});

test('a clean run carries LAB-OK and no error codes', () => {
  const diagnostics = summarizeDiagnostics(fakeReport({ ok: true, checks: [], signatureHits: [], bootTail: [] }));
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.primaryCode, 'LAB-OK');
  assert.deepEqual(diagnostics.errorCodes, []);
  assert.equal(diagnostics.unknown, false);
});

test('redaction removes tokens, keys, and absolute home paths', () => {
  const text = redactText(
    'boot http://127.0.0.1:1/?token=abcdef123456 apiKey: supersecretvalue123 '
      + `Authorization: Bearer abcdefghijklmnop ${path.join(os.homedir(), '.dsh', 'profiles', 'web')}`,
  );
  assert.equal(text.includes('abcdef123456'), false, text);
  assert.equal(text.includes('supersecretvalue123'), false, text);
  assert.equal(text.includes('abcdefghijklmnop'), false, text);
  assert.equal(text.includes(os.homedir()), false, text);
});

test('writeDiagnosticsBundle writes a redacted JSON bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-diag-'));
  try {
    const target = path.join(root, 'nested', 'diagnostics.json');
    const written = writeDiagnosticsBundle(fakeReport(), target);
    assert.equal(written.path, path.resolve(target));
    const bundle = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(bundle.diagnostics.primaryCode, 'LAB-BOOT-002');
    assert.equal(JSON.stringify(bundle).includes('supersecretvalue123'), false);
    assert.equal(JSON.stringify(bundle).includes('abcdef123456'), false);
    assert.equal(bundle.diagnostics.exclusions.sessions, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildLogDiagnostics maps a bare log to signatures', () => {
  const diagnostics = buildLogDiagnostics('Error: EADDRINUSE: address already in use 127.0.0.1:5566\nfunction foo');
  assert.equal(diagnostics.primaryCode, 'LAB-BOOT-002');
  assert.equal(diagnostics.ok, false);
  assert.equal(diagnostics.mode, 'log');
});

test('latestReportFile finds the newest report.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-latest-report-'));
  try {
    const older = path.join(root, 'a', 'report.json');
    const newer = path.join(root, 'b', 'report.json');
    fs.mkdirSync(path.dirname(older), { recursive: true });
    fs.mkdirSync(path.dirname(newer), { recursive: true });
    fs.writeFileSync(older, '{}', 'utf8');
    fs.writeFileSync(newer, '{}', 'utf8');
    const past = Date.now() - 60_000;
    fs.utimesSync(older, new Date(past), new Date(past));
    assert.equal(latestReportFile(root), newer);
    assert.equal(latestReportFile(path.join(root, 'missing')), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
