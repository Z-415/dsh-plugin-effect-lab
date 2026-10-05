import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildProcessQueryScript,
  extractLabTokens,
  isOrphanLabProcess,
  labProcessDirs,
  parseProcessLines,
  planLabProcesses,
  reapLabProcesses,
  reapProcessesByCommandLine,
} from '../../src/process-reaper.js';

test('buildProcessQueryScript filters by process name and escapes the target', () => {
  const script = buildProcessQueryScript("C:/tmp/dsh-lab-o'brien", { names: ['msedge.exe'], keepPid: 42 });
  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /\$_.Name -eq 'msedge\.exe'/);
  assert.match(script, /dsh-lab-o''brien/, 'single quotes must be doubled for PowerShell');
  assert.match(script, /ProcessId -ne 42/);
  assert.equal(script.includes('Stop-Process'), false, 'listing must not kill by default');

  const killing = buildProcessQueryScript('dsh-lab', { kill: true });
  assert.equal(killing.includes('Stop-Process'), true);
});

test('parseProcessLines reads pid|name|commandLine and skips junk', () => {
  const parsed = parseProcessLines([
    '1234|msedge.exe|"C:\\edge\\msedge.exe" --user-data-dir=C:\\tmp\\dsh-lab-browser-abc',
    'not-a-line',
    '|missing-pid|cmd',
    '99|DeepSeek Harness.exe|C:\\tmp\\dsh-lab-electron-44.0.0\\DeepSeek Harness.exe',
  ].join('\r\n'));
  assert.deepEqual(parsed.map((entry) => entry.pid), [1234, 99]);
  assert.equal(parsed[0].name, 'msedge.exe');
  assert.match(parsed[0].commandLine, /dsh-lab-browser-abc/);
  assert.equal(parsed[1].name, 'DeepSeek Harness.exe');
});

test('extractLabTokens ignores the reusable electron/gui caches', () => {
  const line = 'C:\\Temp\\dsh-lab-electron-44.0.0\\DeepSeek Harness.exe --user-data-dir=C:\\Temp\\dsh-lab-ab12cd\\electron-userdata';
  assert.deepEqual(extractLabTokens(line), ['dsh-lab-ab12cd']);
  assert.deepEqual(extractLabTokens('C:\\Temp\\dsh-lab-gui-44.0.0\\x.exe'), []);
  assert.deepEqual(extractLabTokens('no lab token here'), []);
});

test('labProcessDirs resolves tokens under the temp root', () => {
  const dirs = labProcessDirs('--user-data-dir=C:\\Temp\\dsh-lab-browser-xyz', 'C:\\Temp');
  assert.deepEqual(dirs, [path.join('C:\\Temp', 'dsh-lab-browser-xyz')]);
});

test('isOrphanLabProcess follows the run directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-test-'));
  const live = path.join(tempRoot, 'dsh-lab-live1');
  fs.mkdirSync(live, { recursive: true });
  const entry = (dir) => ({ pid: 1, name: 'msedge.exe', commandLine: `--user-data-dir=${dir}` });
  try {
    assert.equal(isOrphanLabProcess(entry(live), { tempRoot }), false, 'a live run directory means not orphaned');
    assert.equal(isOrphanLabProcess(entry(path.join(tempRoot, 'dsh-lab-gone1')), { tempRoot }), true);
    assert.equal(
      isOrphanLabProcess(entry(live), { tempRoot, plannedRemovals: [live] }),
      true,
      'a directory about to be removed counts as orphaned',
    );
    assert.equal(
      isOrphanLabProcess(entry(live), { tempRoot, olderThanMs: 1, now: Date.now() + 60_000 }),
      true,
      'an old directory counts as orphaned',
    );
    assert.equal(isOrphanLabProcess({ pid: 1, commandLine: 'dsh-lab but no token' }, { tempRoot }), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('planLabProcesses keeps live processes and reports orphans', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-test-'));
  const live = path.join(tempRoot, 'dsh-lab-live2');
  fs.mkdirSync(live, { recursive: true });
  const processes = [
    { pid: 10, name: 'msedge.exe', commandLine: `--user-data-dir=${live}` },
    { pid: 11, name: 'msedge.exe', commandLine: `--user-data-dir=${path.join(tempRoot, 'dsh-lab-gone2')}` },
  ];
  try {
    const plan = planLabProcesses({ tempRoot, listProcesses: () => processes });
    assert.equal(plan.matched, 2);
    assert.deepEqual(plan.orphans.map((entry) => entry.pid), [11]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('reapLabProcesses kills only the orphans and reports failures', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-test-'));
  const processes = [
    { pid: 21, name: 'msedge.exe', commandLine: `--user-data-dir=${path.join(tempRoot, 'dsh-lab-gone3')}` },
    { pid: 22, name: 'msedge.exe', commandLine: `--user-data-dir=${path.join(tempRoot, 'dsh-lab-gone4')}` },
  ];
  const killed = [];
  try {
    const result = reapLabProcesses({
      tempRoot,
      listProcesses: () => processes,
      killProcess: (pid) => {
        if (pid === 22) throw new Error('access denied');
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, [21]);
    assert.deepEqual(result.killed.map((entry) => entry.pid), [21]);
    assert.deepEqual(result.failed.map((entry) => entry.pid), [22]);
    assert.match(result.failed[0].error, /access denied/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('reapProcessesByCommandLine is a no-op off Windows or with an empty target', () => {
  assert.deepEqual(reapProcessesByCommandLine('dsh-lab', { platform: 'linux' }), {
    supported: false,
    matched: 0,
    processes: [],
    status: null,
  });
  const empty = reapProcessesByCommandLine('', { platform: 'win32' });
  assert.equal(empty.supported, true);
  assert.equal(empty.matched, 0);
});

test('reapProcessesByCommandLine matches nothing for a name that cannot exist', {
  skip: process.platform !== 'win32',
  timeout: 60_000,
}, () => {
  const result = reapProcessesByCommandLine('dsh-lab-nonexistent-target', { names: ['dsh-lab-no-such-process.exe'] });
  assert.equal(result.supported, true);
  assert.equal(result.matched, 0);
});
