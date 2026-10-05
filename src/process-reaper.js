import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Process cleanup for the two things the lab can leak:
 *
 *   - headless Edge, whose launcher exits immediately after handing the real
 *     browser to a broker process (so killing the spawned pid is not enough);
 *   - the cached Electron shell runtime under
 *     `%TEMP%\dsh-lab-electron-<version>\`, which survives a killed or timed
 *     out run.
 *
 * Both carry a lab-unique identifier in their command line: Edge has
 * `--user-data-dir=...\dsh-lab-browser-<id>`, and the shell is spawned with a
 * per-run `--user-data-dir=...\dsh-lab-<id>\electron-userdata`.
 *
 * The Windows query runs through PowerShell `Get-CimInstance Win32_Process`,
 * which is the only way to read another process's command line without a
 * native dependency.
 */

/** Process names the lab itself spawns. Never touch anything else. */
export const LAB_PROCESS_NAMES = ['msedge.exe', 'DeepSeek Harness.exe'];

/** Substring every lab-spawned process carries in its command line. */
export const LAB_COMMAND_HINT = 'dsh-lab';

/** Long-lived caches: real, reusable, and never a "run directory". */
export const LAB_CACHE_PREFIXES = ['dsh-lab-electron-', 'dsh-lab-gui-'];

const LAB_DIR_TOKEN = /dsh-lab-[A-Za-z0-9._-]+/gi;

/** PowerShell one-liner that lists (and optionally kills) matching processes. */
export function buildProcessQueryScript(target, options = {}) {
  const {
    names = LAB_PROCESS_NAMES,
    keepPid = process.pid,
    kill = false,
  } = options;
  const quotedTarget = String(target ?? '').replace(/'/g, "''");
  const nameFilter = names
    .map((name) => `$_.Name -eq '${String(name).replace(/'/g, "''")}'`)
    .join(' -or ');
  const lines = [
    `$target = '${quotedTarget}';`,
    `$p = @(Get-CimInstance Win32_Process | Where-Object { (${nameFilter}) -and $_.CommandLine -and $_.CommandLine.Contains($target) -and $_.ProcessId -ne ${Number(keepPid) || 0} });`,
    '$p | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.CommandLine)" }',
  ];
  if (kill) {
    lines.push('foreach ($proc in $p) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }');
  }
  return lines.join(' ');
}

/** Parse the `pid|name|commandLine` lines back into objects. */
export function parseProcessLines(stdout) {
  const out = [];
  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const first = line.indexOf('|');
    const second = line.indexOf('|', first + 1);
    if (first <= 0 || second < 0) continue;
    const pid = Number(line.slice(0, first));
    if (!Number.isFinite(pid) || pid <= 0) continue;
    out.push({ pid, name: line.slice(first + 1, second), commandLine: line.slice(second + 1) });
  }
  return out;
}

/** Run the query and return `{ supported, processes, status }`. Windows only. */
export function runProcessQuery(target, options = {}) {
  const { platform = process.platform } = options;
  if (platform !== 'win32') return { supported: false, processes: [], status: null };
  const text = String(target ?? '');
  if (!text) return { supported: true, processes: [], status: 0 };
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', buildProcessQueryScript(text, options),
  ], { windowsHide: true, encoding: 'utf8' });
  return { supported: true, processes: parseProcessLines(result.stdout), status: result.status };
}

/**
 * Kill every process whose command line carries `target`. Used per-run (Edge
 * by its user-data-dir, the shell by its per-run user-data-dir), so it is
 * deliberately unconditional.
 */
export function reapProcessesByCommandLine(target, options = {}) {
  const query = runProcessQuery(target, { ...options, kill: true });
  return {
    supported: query.supported,
    matched: query.processes.length,
    processes: query.processes,
    status: query.status,
  };
}

/** Lab temp-dir tokens in a command line, minus the long-lived caches. */
export function extractLabTokens(commandLine) {
  const found = new Set();
  for (const match of String(commandLine ?? '').matchAll(LAB_DIR_TOKEN)) found.add(match[0]);
  return [...found].filter((token) => !LAB_CACHE_PREFIXES.some((prefix) => token.startsWith(prefix)));
}

/** Absolute lab temp directories a process references. */
export function labProcessDirs(commandLine, tempRoot = os.tmpdir()) {
  return extractLabTokens(commandLine).map((token) => path.join(tempRoot, token));
}

/**
 * A lab process is orphaned when its run directory is gone, or older than the
 * caller's filter. A process from a live run keeps its directory, so `lab
 * clean` will not disturb a concurrently running command.
 */
export function isOrphanLabProcess(entry, options = {}) {
  const {
    olderThanMs = 0,
    now = Date.now(),
    tempRoot = os.tmpdir(),
    plannedRemovals = [],
  } = options;
  const removals = new Set(plannedRemovals.map((dir) => path.resolve(dir).toLowerCase()));
  const dirs = labProcessDirs(entry?.commandLine, tempRoot);
  if (!dirs.length) return false;
  return dirs.some((dir) => {
    if (removals.has(path.resolve(dir).toLowerCase())) return true;
    if (!fs.existsSync(dir)) return true;
    if (!olderThanMs) return false;
    try {
      return now - fs.statSync(dir).mtimeMs >= olderThanMs;
    } catch {
      return true;
    }
  });
}

/** Every lab-spawned process currently running (Windows only). */
export function listLabProcesses(options = {}) {
  if (typeof options.listProcesses === 'function') {
    const processes = options.listProcesses(options) ?? [];
    return { supported: true, matched: processes.length, processes };
  }
  const query = runProcessQuery(String(options.hint ?? LAB_COMMAND_HINT), { ...options, kill: false });
  return { supported: query.supported, matched: query.processes.length, processes: query.processes };
}

/** Which of those are orphans, without killing anything (for `--dry-run`). */
export function planLabProcesses(options = {}) {
  const listed = listLabProcesses(options);
  const orphans = listed.processes.filter((entry) => isOrphanLabProcess(entry, options));
  return { supported: listed.supported, matched: listed.matched, orphans };
}

/** Kill the orphaned lab processes; live runs keep their own directory. */
export function reapLabProcesses(options = {}) {
  const plan = planLabProcesses(options);
  const kill = typeof options.killProcess === 'function' ? options.killProcess : (pid) => process.kill(pid);
  const killed = [];
  const failed = [];
  for (const entry of plan.orphans) {
    try {
      kill(entry.pid);
      killed.push(entry);
    } catch (error) {
      failed.push({ ...entry, error: String(error?.message ?? error) });
    }
  }
  return { ...plan, killed, failed };
}
