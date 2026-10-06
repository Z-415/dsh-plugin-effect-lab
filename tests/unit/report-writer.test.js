import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareArtifacts, renderReportMarkdown } from '../../src/report-writer.js';

test('prepareArtifacts resolves a relative root to absolute', () => {
  const runId = `dsh-lab-relative-${process.pid}-${Date.now()}`;
  const root = path.join('.', 'dsh-lab-relative-artifacts-test');
  let runDir = null;
  try {
    runDir = prepareArtifacts(root, runId);
    assert.equal(path.isAbsolute(runDir), true, `expected absolute, got ${runDir}`);
    assert.equal(runDir, path.join(path.resolve(root), runId));
    assert.equal(fs.existsSync(path.join(runDir, 'screenshots')), true);
    assert.equal(fs.existsSync(path.join(runDir, 'dom')), true);
  } finally {
    if (runDir) fs.rmSync(path.dirname(runDir), { recursive: true, force: true });
  }
});

test('prepareArtifacts keeps an absolute root unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-abs-artifacts-'));
  try {
    const runDir = prepareArtifacts(root, 'run-1');
    assert.equal(runDir, path.join(path.resolve(root), 'run-1'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the markdown report echoes advertised spec -> resolved name@version', () => {
  const markdown = renderReportMarkdown({
    runId: 'run-1',
    ok: true,
    mode: 'web',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    checks: [],
    plugins: [
      {
        advertisedSpec: 'github:author/claimed#v2',
        spec: 'github:author/claimed#v2',
        resolvedSpec: 'dsh-real-name@2.3.4',
        resolved: 'dsh-real-name@2.3.4',
        source: 'github',
      },
    ],
    artifacts: {},
  });
  assert.match(markdown, /## 插件来源与真实包名/);
  assert.match(markdown, /github:author\/claimed#v2 -> dsh-real-name@2\.3\.4（来源：github）/);
});
