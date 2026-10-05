import { randomUUID } from 'node:crypto';
import { runLabVerify } from './lab-cli.js';
import { summarizeReport } from './report-summary.js';

/** Thrown when a second verification starts while one is already running. */
export class BridgeBusyError extends Error {
  constructor(message = 'a verification is already running') {
    super(message);
    this.name = 'BridgeBusyError';
  }
}

/**
 * One in-memory verification job per host process.
 *
 * The controller never spawns anything itself; it delegates to runLabVerify
 * (which is lazy and never passes --profile-lab). The client polls status().
 */
export function createVerifyController(options = {}) {
  const {
    getConfig,
    runVerify = runLabVerify,
    now = () => Date.now(),
    idFactory = () => randomUUID(),
  } = options;
  let current = null;

  function start({ plugin, online = false }) {
    if (current?.status === 'running') throw new BridgeBusyError();
    const config = getConfig();
    const controller = new AbortController();
    const job = {
      id: idFactory(),
      status: 'running',
      plugin,
      online,
      startedAt: now(),
      finishedAt: null,
      summary: null,
      error: null,
      outcome: null,
      controller,
    };
    current = job;
    const outcome = runVerify({
      nodeExe: config.nodeExe,
      labEntry: config.labEntry,
      pluginSpec: plugin,
      online,
      artifactsDir: config.artifactsDir,
      timeoutMs: config.timeoutMs,
      cwd: config.labRoot,
      signal: controller.signal,
    });
    Promise.resolve(outcome).then((value) => {
      job.outcome = value;
      job.finishedAt = now();
      if (value?.aborted) {
        job.status = 'cancelled';
        return;
      }
      job.status = 'done';
      job.summary = summarizeReport(value ?? {});
    }).catch((error) => {
      job.status = 'error';
      job.error = String(error?.message ?? error);
      job.finishedAt = now();
    });
    return job;
  }

  function status() {
    return current;
  }

  function cancel() {
    if (current?.status === 'running') {
      try { current.controller.abort(); } catch { /* best effort */ }
    }
    return current;
  }

  return { start, status, cancel };
}

/** JSON-safe projection: never leak the AbortController or raw outcome. */
export function publicJobView(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    plugin: job.plugin,
    online: job.online,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    summary: job.summary,
    error: job.error,
  };
}
