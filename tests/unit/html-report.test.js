import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renderHtmlReport, renderMatrixHtmlReport, writeHtmlReport } from '../../src/html-report.js';

function makeRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-html-'));
}

const baseReport = {
  ok: false,
  mode: 'web',
  runId: 'run-abc',
  startedAt: '2026-10-04T00:00:00.000Z',
  finishedAt: '2026-10-04T00:00:10.000Z',
  runtime: { version: '0.2.0-rc.2' },
  checks: [
    { name: 'host-boot', pass: true, detail: 'port 1234' },
    { name: 'console-errors', pass: false, detail: '1 error', informational: true },
    { name: 'cleanup-home', pass: false, detail: 'home left' },
  ],
  errors: ['<script>alert(1)</script>'],
};

test('renderHtmlReport renders checks, status, and escapes user text', () => {
  const html = renderHtmlReport(baseReport);
  assert.equal(html.startsWith('<!doctype html>'), true);
  assert.equal(html.includes('run-abc'), true);
  assert.equal(html.includes('host-boot'), true);
  assert.equal(html.includes('cleanup-home'), true);
  assert.equal(html.includes('class="status fail"'), true);
  assert.equal(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('共 3 项检查，1 项未通过'), true);
});

test('renderHtmlReport marks informational checks as INFO, not FAIL', () => {
  const html = renderHtmlReport(baseReport);
  assert.equal(html.includes('<span class="badge info">提示</span>'), true);
  assert.equal(html.includes('<span class="badge fail">失败</span>'), true);
});

test('writeHtmlReport embeds screenshots as data URIs', () => {
  const runDir = makeRunDir();
  try {
    const shot = path.join(runDir, 'screenshots', 'home.png');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    fs.writeFileSync(shot, Buffer.from('89504e470d0a1a0a', 'hex'));
    const file = writeHtmlReport(runDir, { ...baseReport, runDir, artifacts: { screenshots: { home: shot } } });
    const html = fs.readFileSync(file, 'utf8');
    assert.equal(html.includes('data:image/png;base64,'), true);
    assert.equal(html.includes('home.png'), true);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('renderHtmlReport shows the failure context when no signature matched', () => {
  const html = renderHtmlReport({
    ...baseReport,
    failureContext: {
      reason: 'no known failure signature matched',
      errors: ['boot failed <b>hard</b>'],
      bootTail: ['[dsh] booting', 'WeirdFailure: nope'],
      consoleErrors: ['Uncaught TypeError: x is not a function'],
      pageErrors: [],
    },
  });
  assert.equal(html.includes('未命中签名的失败上下文'), true);
  assert.equal(html.includes('WeirdFailure: nope'), true);
  assert.equal(html.includes('Uncaught TypeError: x is not a function'), true);
  assert.equal(html.includes('boot failed &lt;b&gt;hard&lt;/b&gt;'), true, 'context must be escaped');
  assert.equal(html.includes('boot failed <b>hard</b>'), false);
});

test('renderMatrixHtmlReport lists classification and conflicts', () => {
  const html = renderMatrixHtmlReport({
    ok: false,
    matrixId: 'matrix-1',
    runs: [{ id: 'base', ok: true, runDir: 'base' }, { id: 'theme', ok: true, runDir: 'theme' }],
    compared: [{ id: 'theme', classification: 'high-conflict', screenshotDiff: { changedRatio: 0.5 }, tokens: { changed: { '--x': {} }, added: {}, removed: {} }, bodyAttributes: { changed: {}, added: {}, removed: {} }, slots: { added: [] } }],
    conflicts: { tokens: [{ key: '--x', runs: ['theme', 'other'] }], bodyAttributes: [], layers: [], slots: [] },
  });
  assert.equal(html.includes('分类'), true);
  assert.equal(html.includes('high-conflict'), true);
  assert.equal(html.includes('冲突'), true);
  assert.equal(html.includes('--x'), true);
  assert.equal(html.includes('0.5'), true);
});
