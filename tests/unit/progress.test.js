import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHASES,
  PHASE_INDEX,
  PROGRESS_MARKER,
  TOTAL_PHASES,
  createProgressReporter,
  decodeProgressLine,
  encodeProgressLine,
  formatCliProgress,
  progressEvent,
} from '../../src/progress.js';

test('the eight phases are fixed and ordered', () => {
  assert.equal(TOTAL_PHASES, 8);
  assert.deepEqual(PHASES.map((phase) => phase.id), [
    'locate-runtime',
    'snapshot',
    'isolated-home',
    'install-plugins',
    'boot-host',
    'probe-ui',
    'cleanup',
    'write-report',
  ]);
  assert.equal(PHASE_INDEX['boot-host'], 5);
});

test('progressEvent carries phase/index/total/detail', () => {
  const event = progressEvent('isolated-home', 'C:/tmp/home');
  assert.equal(event.phase, 'isolated-home');
  assert.equal(event.index, 3);
  assert.equal(event.total, 8);
  assert.equal(event.detail, 'C:/tmp/home');
  assert.equal(event.label, '建隔离 home');
  assert.throws(() => progressEvent('not-a-phase', 'x'), /unknown progress phase/);
});

test('encodeProgressLine/decodeProgressLine round-trip through the marker', () => {
  const event = progressEvent('cleanup', 'cleaning');
  const line = encodeProgressLine(event);
  assert.equal(line.startsWith(PROGRESS_MARKER), true);
  assert.deepEqual(decodeProgressLine(line.trimEnd()), event);
  assert.equal(decodeProgressLine('plain log line'), null);
  assert.equal(decodeProgressLine(`${PROGRESS_MARKER}{bad json`), null);
});

test('formatCliProgress prints the [n/8] prefix and the phase duration', () => {
  const event = { ...progressEvent('isolated-home', 'C:/tmp/home'), phaseMs: 12_400 };
  assert.equal(formatCliProgress(event), '[3/8] 建隔离 home · C:/tmp/home · 12.4s');
  assert.equal(formatCliProgress(progressEvent('snapshot', '')), '[2/8] 快照');
});

test('createProgressReporter emits the structured event, the machine line, and human text', () => {
  const lines = [];
  const events = [];
  let clock = 0;
  const report = createProgressReporter({
    onProgress: (event) => events.push(event),
    stream: { write: (text) => lines.push(text) },
    structured: true,
    now: () => (clock += 100),
  });
  report(progressEvent('locate-runtime', 'runtime 0.2.0-rc.2'));
  report(progressEvent('snapshot', '10 structural file(s) hashed'));

  assert.equal(events.length, 2);
  assert.equal(events[0].phaseMs, 100);
  assert.equal(events[1].elapsedMs, 200);
  assert.equal(typeof events[1].total, 'number');
  assert.equal(lines[0].startsWith(PROGRESS_MARKER), true, lines[0]);
  assert.match(lines[1], /^\[1\/8\] 定位 runtime/);
  assert.match(lines[3], /^\[2\/8\] 快照/);
});

test('a throwing onProgress consumer never breaks the reporter', () => {
  const lines = [];
  const report = createProgressReporter({
    onProgress: () => { throw new Error('consumer boom'); },
    stream: { write: (text) => lines.push(text) },
    structured: false,
    now: () => 1,
  });
  assert.doesNotThrow(() => report(progressEvent('cleanup', 'x')));
  assert.equal(lines.length, 1);
});
