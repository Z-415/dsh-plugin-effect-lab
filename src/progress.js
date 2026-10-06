/**
 * The lab's progress protocol. `onProgress` receives a structured event:
 *
 *   { phase, index, total, label, detail, elapsedMs, phaseMs }
 *
 * `index`/`total` count *phases*, not time: the lab never guesses a time
 * percentage for an unpredictable boot or install. A GUI renders the completed
 * phases as a real fraction and shows an indeterminate animation for the
 * in-flight phase.
 */

export const PHASES = [
  { id: 'locate-runtime', label: '定位 runtime' },
  { id: 'snapshot', label: '快照' },
  { id: 'isolated-home', label: '建隔离 home' },
  { id: 'install-plugins', label: '安装插件' },
  { id: 'boot-host', label: '启动宿主' },
  { id: 'probe-ui', label: '探针/截图' },
  { id: 'cleanup', label: '清理' },
  { id: 'write-report', label: '写报告' },
];

export const TOTAL_PHASES = PHASES.length;
export const PHASE_INDEX = Object.fromEntries(PHASES.map((phase, index) => [phase.id, index + 1]));
const PHASE_LABEL = Object.fromEntries(PHASES.map((phase) => [phase.id, phase.label]));

export const PROGRESS_MARKER = '\u001eLABPROG\u001e';

export function progressEvent(phase, detail, extra = {}) {
  const index = PHASE_INDEX[phase];
  if (!index) throw new Error(`unknown progress phase: ${JSON.stringify(phase)}`);
  return {
    phase,
    index,
    total: TOTAL_PHASES,
    label: PHASE_LABEL[phase],
    detail: detail === undefined || detail === null ? '' : String(detail),
    ...extra,
  };
}

export function encodeProgressLine(event) {
  return `${PROGRESS_MARKER}${JSON.stringify(event)}\n`;
}

export function decodeProgressLine(line) {
  const text = String(line ?? '');
  if (!text.startsWith(PROGRESS_MARKER)) return null;
  try {
    return JSON.parse(text.slice(PROGRESS_MARKER.length));
  } catch {
    return null;
  }
}

export function formatCliProgress(event) {
  const seconds = Number.isFinite(event.phaseMs) ? `${(event.phaseMs / 1000).toFixed(1)}s` : null;
  const parts = [`[${event.index}/${event.total}]`, event.label];
  if (event.detail) parts.push(`· ${event.detail}`);
  if (seconds) parts.push(`· ${seconds}`);
  return parts.join(' ');
}

/**
 * Turn structured events into CLI text and (when the GUI asked for it) a
 * machine-readable line the renderer parses to drive the progress bar.
 */
export function createProgressReporter(options = {}) {
  const {
    onProgress = null,
    stream = process.stdout,
    structured = false,
    now = () => Date.now(),
  } = options;
  const startedAt = now();
  let lastAt = startedAt;
  return function report(event) {
    const at = now();
    const enriched = { ...event, elapsedMs: at - startedAt, phaseMs: at - lastAt };
    lastAt = at;
    if (typeof onProgress === 'function') {
      try {
        onProgress(enriched);
      } catch {
        // Progress reporting must never break a run.
      }
    }
    if (!stream) return;
    if (structured) stream.write(encodeProgressLine(enriched));
    stream.write(`${formatCliProgress(enriched)}\n`);
  };
}
