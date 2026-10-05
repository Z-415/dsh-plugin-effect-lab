import assert from 'node:assert/strict';
import test from 'node:test';
import { describeShellRun } from '../../src/electron-shell/shell-runner.js';

test('a missing shell result is described as shell-result missing, not a TypeError', () => {
  const described = describeShellRun(null, { exitCode: 1, stderr: 'first line\nfatal: electron exploded' });
  assert.equal(described.pass, false);
  assert.match(described.detail, /shell-result 缺失/);
  assert.match(described.detail, /exitCode=1/);
  assert.match(described.detail, /fatal: electron exploded/);
  assert.equal(described.detail.includes('Cannot read properties of null'), false);
});

test('a missing shell result with empty stderr still reads clearly', () => {
  const described = describeShellRun(null, { exitCode: null, stderr: '' });
  assert.equal(described.pass, false);
  assert.match(described.detail, /stderr=空/);
});

test('a written shell result passes the shell-run description', () => {
  const described = describeShellRun({ ok: true }, { exitCode: 0, stderr: '' });
  assert.equal(described.pass, true);
  assert.match(described.detail, /written/);
});
