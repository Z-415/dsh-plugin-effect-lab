import { spawn, spawnSync } from 'node:child_process';
import { normalizeProfileLab } from './lab-profiles.js';

/**
 * Command construction and execution for `lab verify --json` and `lab shell`.
 *
 * The command is deliberately always `--offline` unless the caller explicitly
 * asks for online, and it never passes `--profile-lab`. The lab therefore keeps
 * its own temporary isolated DSH_HOME.
 */

/**
 * Never hand the lab the host's real DSH_HOME/DSH_AGENTS_HOME: the lab must
 * create its own temporary isolated home. DSH_LAB_HOME is left alone because
 * the bridge itself uses it for path discovery, not the lab.
 */
export function sanitizeLabEnv(env = process.env) {
  const next = { ...env };
  delete next.DSH_HOME;
  delete next.DSH_AGENTS_HOME;
  return next;
}

export function buildVerifyArgs({ labEntry, pluginSpec, online = false, artifactsDir, profileLab }) {
  const profile = normalizeProfileLab(profileLab);
  const args = [
    labEntry,
    'verify',
    '--plugin',
    pluginSpec,
    ...(online ? ['--online'] : ['--offline']),
    '--json',
    '--artifacts',
    artifactsDir,
    ...(profile ? ['--profile-lab', profile] : []),
  ];
  return args;
}

/**
 * `lab shell --show` in an isolated home. `--keep-open` lets the user close the
 * window themselves; a positive holdMs is exposed for a timed window. The
 * plugin spec is optional — an empty spec opens a plain DSH shell.
 */
export function buildShellArgs({ labEntry, pluginSpec, online = false, holdMs, profileLab } = {}) {
  const profile = normalizeProfileLab(profileLab);
  const args = [
    labEntry,
    'shell',
    ...(online ? ['--online'] : ['--offline']),
    '--show',
    '--no-compare-web',
    ...(profile ? ['--profile-lab', profile] : []),
  ];
  if (typeof pluginSpec === 'string' && pluginSpec.trim()) args.push('--plugin', pluginSpec.trim());
  const hold = Number(holdMs);
  if (Number.isFinite(hold) && hold > 0) args.push('--show-hold', String(Math.trunc(hold)));
  else args.push('--keep-open');
  return args;
}

/**
 * Launch the lab's Electron shell window detached from the host process. The
 * shell keeps its own temporary isolated home and cleans up when it closes.
 */
export function spawnLabShell(options = {}) {
  const {
    nodeExe,
    labEntry,
    pluginSpec,
    online = false,
    profileLab,
    holdMs,
    cwd,
    env,
    spawnImpl = spawn,
  } = options;
  const args = buildShellArgs({ labEntry, pluginSpec, online, holdMs, profileLab });
  const child = spawnImpl(nodeExe, args, {
    cwd: cwd ?? undefined,
    env: sanitizeLabEnv(env ?? process.env),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  try { child.unref?.(); } catch { /* best effort */ }
  return { pid: child.pid ?? null, args };
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
 * Run `node <lab>/bin/lab.js verify ...` and resolve with the raw outcome.
 * A non-zero exit code is NOT an error: the lab returns 1 for a valid report
 * whose checks failed, so stdout is always parsed first.
 *
 * @returns {Promise<{ exitCode: number|null, timedOut: boolean, stdout: string, stderr: string, report: object|null }>}
 */
export function runLabVerify(options) {
  const {
    nodeExe,
    labEntry,
    pluginSpec,
    online = false,
    artifactsDir,
    profileLab,
    timeoutMs,
    cwd,
    env,
    spawnImpl = spawn,
    killTreeImpl = killProcessTree,
    signal,
  } = options;
  const args = buildVerifyArgs({ labEntry, pluginSpec, online, artifactsDir, profileLab });
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
      resolve({ exitCode: null, timedOut: false, stdout: '', stderr: String(error?.message ?? error), report: null, spawnError: true });
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
      // Fallback when the tree kill cannot be observed closing.
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
