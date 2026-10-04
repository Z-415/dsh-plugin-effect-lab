import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REAL_HOME, TEMP_PREFIX } from './config.js';
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

/** Delete an isolated root, retrying briefly for Windows file-handle release. */
export async function disposeIsolatedHome(root, options = {}) {
  const { retries = 6, delayMs = 400 } = options;
  assertSafeHome(root);
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      if (!fs.existsSync(root)) return { removed: true, root, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
    }
    await sleep(delayMs);
  }
  return {
    removed: !fs.existsSync(root),
    root,
    attempts: retries,
    error: lastError ? String(lastError) : null,
  };
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
      const stat = fs.statSync(full);
      return { path: full, mtimeMs: stat.mtimeMs };
    })
    .filter((entry) => {
      const name = path.basename(entry.path).toLowerCase();
      return name.startsWith(`${TEMP_PREFIX}browser-`)
        || name.startsWith(`${TEMP_PREFIX}dbg-`)
        || fs.existsSync(path.join(entry.path, 'home'));
    });
}
