import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REAL_HOME, TEMP_PREFIX } from './config.js';
import { listProcessesByCommandLine, reapProcessesByCommandLine, ROOT_PROCESS_NAMES } from './process-reaper.js';
import { ensureDir, sleep } from './util.js';

/**
 * Windows still hits MAX_PATH (260) on some plugin installs, so the lab's own
 * temp root must stay far below it. Every isolated run is `<temp>\dsh-lab-xxxx`.
 */
export const MAX_LAB_ROOT_LENGTH = 120;

function normalized(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

export function isInside(parent, child) {
  const p = normalized(parent);
  const c = normalized(child);
  return c === p || c.startsWith(`${p}${path.sep}`);
}

/** Reject a lab root that is long enough to risk Windows path limits. */
export function assertShortLabRoot(root) {
  const resolved = path.resolve(root);
  if (resolved.length > MAX_LAB_ROOT_LENGTH) {
    throw new Error(`lab temp root is too long (${resolved.length} > ${MAX_LAB_ROOT_LENGTH}): ${resolved}`);
  }
  return resolved;
}

/** Refuse any write target that is not a lab-prefixed directory under os.tmpdir(). */
export function assertSafeHome(home) {
  const resolved = path.resolve(home);
  const tempRoot = path.resolve(os.tmpdir());
  if (!isInside(tempRoot, resolved)) {
    throw new Error(`unsafe DSH_HOME: ${resolved} is outside ${tempRoot}`);
  }
  const base = path.basename(resolved);
  if (!base.toLowerCase().startsWith(TEMP_PREFIX)) {
    throw new Error(`unsafe DSH_HOME: ${resolved} does not use prefix ${TEMP_PREFIX}`);
  }
  if (isInside(REAL_HOME, resolved)) {
    throw new Error(`unsafe DSH_HOME: ${resolved} is inside the real home ${REAL_HOME}`);
  }
  return resolved;
}

/**
 * Create a short isolated root:
 *   <temp>/dsh-lab-xxxxxx/home   -> DSH_HOME
 *   <temp>/dsh-lab-xxxxxx/agents -> DSH_AGENTS_HOME
 */
export function createIsolatedHome(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? TEMP_PREFIX));
  assertSafeHome(root);
  assertShortLabRoot(root);
  const home = ensureDir(path.join(root, 'home'));
  const agents = options.withAgents === false ? null : ensureDir(path.join(root, 'agents'));
  const tmp = ensureDir(path.join(root, 'tmp'));
  return {
    root,
    home,
    agents,
    tmp,
    profileDir(profileName) {
      const dir = path.join(home, 'profiles', profileName);
      assertSafeHome(root);
      return dir;
    },
    async dispose() {
      return disposeIsolatedHome(root);
    },
  };
}

/** ENOENT/ENOTDIR mean the entry is already gone; that is not a blocker. */
function isVanished(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

/**
 * Remove a tree entry by entry with `lstat`, unlinking symlinks/junctions
 * instead of traversing them. A profile can contain a link to a local plugin
 * source (pnpm links `file:` directory dependencies), and a recursive delete
 * that followed such a link would erase the user's source tree.
 *
 * The walk must also tolerate entries that vanish underneath it. The dsh-orb
 * plugin extracts an Electron runtime under the isolated home and deletes it
 * again on shutdown; when that runs concurrently with our delete, `lstat`,
 * `unlink`, or `rmdir` sees a path the other process already removed (ENOENT)
 * or a directory it briefly refilled (ENOTEMPTY). Treat a vanished entry as
 * done and re-sweep a non-empty directory; only a real lock (EBUSY/EPERM)
 * should stop the walk.
 */
export function removeTreeSafely(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (isVanished(error)) return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    try {
      fs.unlinkSync(target);
    } catch (error) {
      if (!isVanished(error)) throw error;
    }
    return;
  }
  for (let pass = 0; pass < 5; pass += 1) {
    let entries;
    try {
      entries = fs.readdirSync(target);
    } catch (error) {
      if (isVanished(error)) return;
      throw error;
    }
    for (const entry of entries) removeTreeSafely(path.join(target, entry));
    try {
      fs.rmdirSync(target);
      return;
    } catch (error) {
      if (isVanished(error)) return;
      // A concurrent writer recreated a child after readdir; sweep again.
      if (error?.code === 'ENOTEMPTY') continue;
      throw error;
    }
  }
  throw new Error(`directory would not stay empty while removing: ${target}`);
}

/**
 * Cleanup budget. A `--keep-open` run is finished by the human closing the
 * window; the Electron tree (renderer/GPU/crashpad) and the DSH host release
 * their handles asynchronously after that, and a heavy plugin makes it slower.
 * 6 x 400ms (2.4s) was too short: the run failed with EBUSY even though the
 * directory could be removed a moment later.
 */
export const DEFAULT_CLEANUP_BUDGET_MS = 30_000;
export const DEFAULT_CLEANUP_INITIAL_DELAY_MS = 250;
export const DEFAULT_CLEANUP_MAX_DELAY_MS = 2_000;
export const DEFAULT_HOLDER_WAIT_MS = 5_000;
const HOLDER_POLL_MS = 250;

/** Processes referencing this exact root (the shell's user-data-dir is under it). */
function defaultProbeHolders(root) {
  return listProcessesByCommandLine(root, { names: ROOT_PROCESS_NAMES }).processes;
}

/** Reap shell/Edge processes still referencing this root, between retries. */
function defaultReapHolders(root) {
  return reapProcessesByCommandLine(root, { names: ROOT_PROCESS_NAMES });
}

/** EBUSY/EPERM-style code from a removal failure, for the report. */
export function cleanupErrorCode(error) {
  if (!error) return null;
  if (error.code) return String(error.code);
  const match = /(EBUSY|EPERM|EACCES|ENOTEMPTY|EEXIST)\b/.exec(String(error.message ?? error));
  return match ? match[1] : null;
}

/**
 * Poll until no process references the root, so the delete runs against a
 * released directory instead of racing the shell tree's shutdown.
 */
async function waitForHoldersGone(root, options) {
  const { probeHolders, timeoutMs, pollMs, sleepFn, now } = options;
  const deadline = now() + timeoutMs;
  let holders = probeHolders(root) ?? [];
  while (holders.length && now() < deadline) {
    await sleepFn(Math.min(pollMs, Math.max(0, deadline - now())));
    holders = probeHolders(root) ?? [];
  }
  return holders;
}

/**
 * Keep the most useful failure for diagnostics: a vanished-entry race is
 * transient, so never let it hide a real EBUSY/EPERM lock seen earlier.
 */
function preferredCleanupError(candidate, current) {
  if (!candidate) return current;
  if (isVanished(candidate)) return current ?? candidate;
  return candidate;
}

/**
 * Delete an isolated root with exponential backoff and process reaping.
 *
 * The hooks (`probeHolders`, `reapHolders`, `sleepFn`, `now`) are injectable so
 * the retry/backoff behavior is unit-testable without PowerShell or real shell
 * processes. A failure returns the locked path, the EBUSY/EPERM code, and the
 * processes still referencing the root, so cleanup.json explains itself.
 */
export async function disposeIsolatedHome(root, options = {}) {
  const {
    totalBudgetMs = DEFAULT_CLEANUP_BUDGET_MS,
    initialDelayMs = DEFAULT_CLEANUP_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_CLEANUP_MAX_DELAY_MS,
    holderWaitMs = DEFAULT_HOLDER_WAIT_MS,
    pollMs = HOLDER_POLL_MS,
    probeHolders = defaultProbeHolders,
    reapHolders = defaultReapHolders,
    sleepFn = sleep,
    now = Date.now,
  } = options;
  assertSafeHome(root);
  const startedAt = now();
  let attempts = 0;
  let lastError = null;
  let holders = [];
  let delay = Math.max(0, initialDelayMs);
  for (;;) {
    attempts += 1;
    try {
      removeTreeSafely(root);
    } catch (error) {
      lastError = preferredCleanupError(error, lastError);
    }
    if (!fs.existsSync(root)) {
      return {
        removed: true,
        root,
        attempts,
        elapsedMs: now() - startedAt,
        error: null,
        errorCode: null,
        lockedPath: null,
        holders: [],
      };
    }
    // Still locked: reap whatever references this exact root before retrying,
    // then wait for the process tree to actually disappear.
    try {
      holders = probeHolders(root) ?? [];
      reapHolders(root);
    } catch {
      // Reaping is best-effort; the backoff below still gives the handles time.
    }
    const remaining = totalBudgetMs - (now() - startedAt);
    if (remaining <= 0) break;
    holders = await waitForHoldersGone(root, {
      probeHolders,
      timeoutMs: Math.min(holderWaitMs, remaining),
      pollMs,
      sleepFn,
      now,
    });
    const afterWait = totalBudgetMs - (now() - startedAt);
    if (afterWait <= 0) break;
    await sleepFn(Math.min(delay, afterWait));
    delay = Math.min(delay * 2, maxDelayMs);
  }
  try {
    holders = probeHolders(root) ?? holders;
  } catch {
    // Keep the last known holder list.
  }
  return {
    removed: !fs.existsSync(root),
    root,
    attempts,
    elapsedMs: now() - startedAt,
    error: lastError ? String(lastError) : null,
    errorCode: cleanupErrorCode(lastError),
    lockedPath: lastError?.path ?? root,
    holders: (holders ?? []).map((entry) => ({ pid: entry.pid, name: entry.name })),
  };
}

/** Human detail for the `cleanup-home` / `cleanup-no-residue` checks. */
export function describeHomeCleanup(cleanup) {
  if (!cleanup) return 'unknown';
  if (cleanup.kept === true) return `kept persistent profile ${cleanup.root}`;
  if (cleanup.removed === true) {
    return `removed ${cleanup.root} in ${cleanup.elapsedMs ?? '?'}ms (${cleanup.attempts ?? 1} attempt(s))`;
  }
  const vanished = cleanup.errorCode === 'ENOENT' || cleanup.errorCode === 'ENOTDIR';
  const parts = [
    'removed=false',
    `${vanished ? 'vanished' : 'locked'}=${cleanup.lockedPath ?? cleanup.root}`,
  ];
  if (cleanup.errorCode) parts.push(`errorCode=${cleanup.errorCode}`);
  else if (cleanup.error) parts.push(`error=${String(cleanup.error).slice(0, 200)}`);
  if (cleanup.holders?.length) {
    parts.push(`holders=${cleanup.holders.map((entry) => `${entry.pid} ${entry.name}`).join(', ')}`);
  }
  parts.push(`attempts=${cleanup.attempts ?? '?'}`);
  if (cleanup.elapsedMs !== undefined && cleanup.elapsedMs !== null) parts.push(`elapsedMs=${cleanup.elapsedMs}`);
  return parts.join('; ');
}

export function listOrphanLabHomes() {
  const tempRoot = path.resolve(os.tmpdir());
  let entries = [];
  try {
    entries = fs.readdirSync(tempRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(TEMP_PREFIX))
    .map((entry) => {
      const full = path.join(tempRoot, entry.name);
      try {
        const stat = fs.statSync(full);
        return { path: full, mtimeMs: stat.mtimeMs };
      } catch {
        // Another test/run may remove its temp dir between readdir and stat.
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => {
      const name = path.basename(entry.path).toLowerCase();
      return name.startsWith(`${TEMP_PREFIX}browser-`)
        || name.startsWith(`${TEMP_PREFIX}dbg-`)
        || fs.existsSync(path.join(entry.path, 'home'));
    });
}
