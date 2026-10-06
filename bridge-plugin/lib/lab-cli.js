import { spawn, spawnSync } from 'node:child_process';

/**
 * `lab verify --json` support for the agent-facing lab_verify_plugin tool.
 *
 * The command is always --offline unless the caller explicitly asks for online;
 * it never passes --profile-lab, so the lab always uses a one-off temporary
 * isolated home. `sanitizeLabEnv` also strips the host's real DSH home and the
 * Electron-as-Node switch.
 */

export function sanitizeLabEnv(env = process.env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.DSH_HOME;
  delete next.DSH_AGENTS_HOME;
  return next;
}

export function buildVerifyArgs({ labEntry, pluginSpec, online = false, artifactsDir }) {
  return [
    labEntry,
    'verify',
    '--plugin',
    pluginSpec,
    ...(online ? ['--online'] : ['--offline']),
    '--json',
    '--artifacts',
    artifactsDir,
  ];
}

/**
 * `lab diagnose` args for the agent-facing lab_diagnose tool. Exactly one
 * source is expected: a saved report.json, a diagnostics bundle, a log file,
 * or `--latest`.
 */
export function buildDiagnoseArgs({ labEntry, reportPath, bundlePath, logPath, latest = false, artifactsDir }) {
  const args = [labEntry, 'diagnose'];
  if (reportPath) args.push('--report', reportPath);
  else if (bundlePath) args.push('--bundle', bundlePath);
  else if (logPath) args.push('--log', logPath);
  else args.push('--latest');
  if (artifactsDir) args.push('--artifacts', artifactsDir);
  args.push('--json');
  return args;
}

/**
 * Kill the lab process tree. `child.kill()` only reaps the direct child; on
 * Windows the lab spawns DSH/Electron/Edge grandchildren that must go too.
 */
export function killProcessTree(child, options = {}) {
  const { platform = process.platform, spawnSyncImpl = spawnSync } = options;
  if (!child || !child.pid) return { killed: false, detail: 'no pid' };
  if (platform === 'win32') {
    const result = spawnSyncImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return {
      killed: result?.status === 0,
      detail: `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim(),
    };
  }
  try {
    child.kill('SIGKILL');
    return { killed: true, detail: 'SIGKILL' };
  } catch (error) {
    return { killed: false, detail: String(error?.message ?? error) };
  }
}

function parseJsonOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Run `node <lab>/bin/lab.js ...` and resolve with the raw outcome. A
 * non-zero exit code is NOT an error: the lab returns 1 for a valid report
 * whose checks failed, so stdout is always parsed first.
 */
function runLabProcess(options) {
  const {
    nodeExe,
    labEntry,
    args,
    timeoutMs,
    cwd,
    env,
    spawnImpl = spawn,
    killTreeImpl = killProcessTree,
    signal,
  } = options;
  if (signal?.aborted) {
    return Promise.resolve({ exitCode: null, timedOut: false, aborted: true, stdout: '', stderr: '', report: null });
  }
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer = null;
    let child;
    try {
      child = spawnImpl(nodeExe, args, {
        cwd: cwd ?? undefined,
        env: sanitizeLabEnv(env ?? process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ exitCode: null, timedOut: false, aborted: false, stdout: '', stderr: String(error?.message ?? error), report: null, spawnError: true });
      return;
    }
    const onAbort = () => {
      if (aborted || settled) return;
      aborted = true;
      try {
        killTreeImpl(child);
      } catch {
        try { child.kill(); } catch { /* best effort */ }
      }
      killTimer = setTimeout(() => finish(child.exitCode ?? null), 1000);
    };
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (signal?.removeEventListener) signal.removeEventListener('abort', onAbort);
      resolve({ exitCode, timedOut, aborted, stdout, stderr, report: aborted ? null : parseJsonOutput(stdout) });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        killTreeImpl(child);
      } catch {
        try { child.kill(); } catch { /* best effort */ }
      }
      killTimer = setTimeout(() => finish(child.exitCode ?? null), 2000);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      stderr += String(error?.message ?? error);
      finish(null);
    });
    child.on('close', (code) => finish(code));
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}

export function runLabVerify(options) {
  return runLabProcess({ ...options, args: buildVerifyArgs(options) });
}

export function runLabDiagnose(options) {
  return runLabProcess({ ...options, args: buildDiagnoseArgs(options) });
}
