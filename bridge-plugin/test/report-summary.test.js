import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeDiagnosticsOutcome, summarizeReport } from '../lib/report-summary.js';

const REPORT = {
  ok: false,
  runId: 'run-42',
  mode: 'web',
  startedAt: '2026-10-05T00:00:00.000Z',
  finishedAt: '2026-10-05T00:01:00.000Z',
  runDir: 'C:/artifacts/run-42',
  checks: [
    { name: 'runtime-located', pass: true, detail: 'ok' },
    { name: 'boot-signatures', pass: false, detail: 'fatal plugin crash' },
    { name: 'cleanup-orphan-processes', pass: false, informational: true, detail: 'advisory' },
  ],
  signatureHits: [{ id: 'plugin-crash', severity: 'fatal' }],
  noise: [{ id: 'dep0180' }],
  artifacts: {
    runDir: 'C:/artifacts/run-42',
    reportHtml: 'C:/artifacts/run-42/report.html',
    reportJson: 'C:/artifacts/run-42/report.json',
  },
};

test('exit code 1 with a valid report is summarized, not discarded', () => {
  const summary = summarizeReport({ report: REPORT, exitCode: 1, timedOut: false });
  assert.equal(summary.parsed, true);
  assert.equal(summary.ok, false);
  assert.equal(summary.exitCode, 1);
  assert.equal(summary.runId, 'run-42');
  assert.equal(summary.checks.total, 3);
  assert.equal(summary.checks.passed, 1);
  assert.deepEqual(summary.failedChecks, [{ name: 'boot-signatures', detail: 'fatal plugin crash' }]);
  assert.deepEqual(summary.keywords.sort(), ['dep0180', 'plugin-crash']);
  assert.equal(summary.reportHtml, 'C:/artifacts/run-42/report.html');
});

test('informational failures do not count as failed checks', () => {
  const summary = summarizeReport({ report: { ...REPORT, checks: [REPORT.checks[2]] }, exitCode: 1 });
  assert.equal(summary.checks.failed, 0);
});

test('a missing report is reported as unparsed with the stderr tail', () => {
  const summary = summarizeReport({ report: null, exitCode: null, timedOut: true, stderr: 'x'.repeat(5000) });
  assert.equal(summary.parsed, false);
  assert.equal(summary.ok, false);
  assert.equal(summary.timedOut, true);
  assert.equal(summary.stderrTail.length, 4000);
});

test('summarizeDiagnosticsOutcome keeps the codes, failed checks, and a bounded tail', () => {
  const summary = summarizeDiagnosticsOutcome({
    report: {
      ok: false,
      runId: 'run-7',
      primaryCode: 'LAB-PLUGIN-004',
      errorCodes: ['LAB-PLUGIN-004', 'LAB-CLIENT-003'],
      unknown: false,
      signatures: [
        { code: 'LAB-PLUGIN-004', id: 'plugin-tree-failed', category: 'plugin', severity: 'fatal', matched: 'boom', rootCause: 'tree', fix: 'disable' },
      ],
      failedChecks: [{ name: 'plugin-postcheck', detail: 'blocker' }],
      bootTail: Array.from({ length: 30 }, (_, index) => `line ${index}`),
      evidence: { reportJson: 'C:/artifacts/run-7/report.json' },
      source: 'C:/artifacts/run-7/report.json',
    },
    exitCode: 1,
  });
  assert.equal(summary.parsed, true);
  assert.equal(summary.primaryCode, 'LAB-PLUGIN-004');
  assert.deepEqual(summary.errorCodes, ['LAB-PLUGIN-004', 'LAB-CLIENT-003']);
  assert.equal(summary.signatures[0].code, 'LAB-PLUGIN-004');
  assert.deepEqual(summary.failedChecks, [{ name: 'plugin-postcheck', detail: 'blocker' }]);
  assert.equal(summary.bootTail.length, 20);
  assert.equal(summary.reportJson, 'C:/artifacts/run-7/report.json');
});

test('summarizeDiagnosticsOutcome reports an unparsed diagnostic payload', () => {
  const summary = summarizeDiagnosticsOutcome({ report: null, exitCode: 2, stderr: 'boom' });
  assert.equal(summary.parsed, false);
  assert.equal(summary.exitCode, 2);
  assert.match(summary.stderrTail, /boom/);
});
