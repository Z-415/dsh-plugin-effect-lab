import { spawn, spawnSync } from 'node:child_process';

/**
 * Command construction and execution for `lab verify --json`.
 *
 * The command is deliberately always `--offline` unless the caller explicitly
 * asks for online, and it never passes `--profile-lab`. The lab therefore keeps
 * its own temporary isolated DSH_HOME.
 */

export function buildVerifyArgs({ labEntry, pluginSpec, online = false, artifactsDir }) {
  const args = [
    labEntry,
    'verify',
    '--plugin',
    pluginSpec,
    ...(online ? ['--online'] : ['--offline']),
    '--json',
    '--artifacts',
    artifactsDir,
  ];
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
    timeoutMs,
    cwd,
    env,
    spawnImpl = spawn,
    killTreeImpl = killProcessTree,
  } = options;
  const args = buildVerifyArgs({ labEntry, pluginSpec, online, artifactsDir });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let child;
    try {
      child = spawnImpl(nodeExe, args, {
        cwd: cwd ?? undefined,
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ exitCode: null, timedOut: false, stdout: '', stderr: String(error?.message ?? error), report: null, spawnError: true });
      return;
    }
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode, timedOut, stdout, stderr, report: parseJsonOutput(stdout) });
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
  });
}
