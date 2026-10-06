import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REAL_HOME } from '../../src/config.js';
import {
  assertSafeHome,
  cleanupErrorCode,
  createIsolatedHome,
  describeHomeCleanup,
  disposeIsolatedHome,
  removeTreeSafely,
} from '../../src/home-manager.js';
import { sleep } from '../../src/util.js';

/** A child process that holds `root` as its CWD for `holdMs` (Windows file lock). */
function holdRoot(root, holdMs) {
  return spawn(process.execPath, ['-e', `setTimeout(() => process.exit(0), ${holdMs})`], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
  });
}

/** Kill the holder, wait for it, then remove the root with Windows-file retries. */
async function releaseRoot(child, root) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}

test('assertSafeHome rejects the real home and arbitrary paths', () => {
  assert.throws(() => assertSafeHome(REAL_HOME), /outside|prefix/i);
  assert.throws(() => assertSafeHome('C:\\Windows\\Temp\\not-a-lab'), /outside|prefix/i);
});

test('createIsolatedHome creates a short lab home under the OS temp root', async () => {
  const iso = createIsolatedHome();
  try {
    assert.match(iso.root, /dsh-lab-/);
    assert.equal(iso.root.toLowerCase().startsWith(os.tmpdir().toLowerCase()), true);
    assert.equal(fs.existsSync(iso.home), true);
    assert.equal(fs.existsSync(iso.agents), true);
  } finally {
    const result = await iso.dispose();
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(iso.root), false);
  }
});

test('disposeIsolatedHome unlinks a junction instead of deleting its target', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-outside-'));
  fs.writeFileSync(path.join(outside, 'source.js'), 'do not delete me', 'utf8');
  const iso = createIsolatedHome({ withAgents: true });
  const link = path.join(iso.root, 'linked-plugin-source');
  try {
    // pnpm links a local directory dependency with a junction on Windows.
    fs.symlinkSync(outside, link, 'junction');
    const result = await iso.dispose();
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(iso.root), false);
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(path.join(outside, 'source.js')), true, 'the link target must survive');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(iso.root, { recursive: true, force: true });
  }
});

test('disposeIsolatedHome outlasts a multi-second handle lock', {
  skip: process.platform !== 'win32',
  timeout: 60_000,
}, async () => {
  const iso = createIsolatedHome({ withAgents: true });
  const child = holdRoot(iso.root, 7_000);
  try {
    await sleep(400);
    const startedAt = Date.now();
    // The lock is a plain node.exe CWD, so the reaper (shell/Edge names) has
    // nothing to kill; the exponential backoff is what has to wait it out.
    const result = await disposeIsolatedHome(iso.root, {
      probeHolders: () => [],
      reapHolders: () => ({ matched: 0 }),
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(fs.existsSync(iso.root), false);
    assert.equal(result.attempts >= 2, true, JSON.stringify(result));
    assert.equal(elapsedMs >= 6_000, true, `gave up after ${elapsedMs}ms`);
  } finally {
    await releaseRoot(child, iso.root);
  }
});

test('disposeIsolatedHome reaps holders between retries', {
  skip: process.platform !== 'win32',
  timeout: 60_000,
}, async () => {
  const iso = createIsolatedHome({ withAgents: true });
  const child = holdRoot(iso.root, 1_200);
  let childDone = false;
  let reapCalls = 0;
  child.on('exit', () => { childDone = true; });
  try {
    await sleep(200);
    const result = await disposeIsolatedHome(iso.root, {
      totalBudgetMs: 15_000,
      initialDelayMs: 100,
      maxDelayMs: 300,
      holderWaitMs: 150,
      pollMs: 30,
      probeHolders: () => (childDone ? [] : [{ pid: child.pid, name: 'DeepSeek Harness.exe' }]),
      reapHolders: () => {
        reapCalls += 1;
        return { matched: 1 };
      },
    });
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(reapCalls >= 1, true, 'the reaper must run between retries');
    assert.equal(result.reapCalls >= 1, true, JSON.stringify(result));
    assert.equal(result.reaped.some((entry) => entry.pid === child.pid), true, JSON.stringify(result));
  } finally {
    await releaseRoot(child, iso.root);
  }
});

test('disposeIsolatedHome reports the locked path, code, and holders on failure', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  const iso = createIsolatedHome({ withAgents: true });
  const child = holdRoot(iso.root, 30_000);
  try {
    await sleep(400);
    const result = await disposeIsolatedHome(iso.root, {
      totalBudgetMs: 600,
      initialDelayMs: 80,
      maxDelayMs: 120,
      holderWaitMs: 100,
      pollMs: 25,
      probeHolders: () => [{ pid: 4242, name: 'DeepSeek Harness.exe', commandLine: iso.root }],
      reapHolders: () => ({ matched: 1 }),
    });
    assert.equal(result.removed, false);
    assert.equal(result.errorCode, 'EBUSY', JSON.stringify(result));
    assert.equal(result.lockedPath, iso.root);
    assert.deepEqual(result.holders, [{ pid: 4242, name: 'DeepSeek Harness.exe' }]);
    const detail = describeHomeCleanup(result);
    assert.match(detail, /errorCode=EBUSY/);
    assert.match(detail, /4242 DeepSeek Harness\.exe/);
    assert.equal(detail.includes(iso.root), true, detail);
  } finally {
    await releaseRoot(child, iso.root);
  }
});

test('describeHomeCleanup and cleanupErrorCode read a synthetic failure', () => {
  assert.equal(cleanupErrorCode({ code: 'EBUSY', message: 'locked' }), 'EBUSY');
  assert.equal(cleanupErrorCode(new Error('EPERM: operation not permitted, rmdir x')), 'EPERM');
  assert.equal(cleanupErrorCode(null), null);
  const detail = describeHomeCleanup({
    removed: false,
    root: 'C:\\Temp\\dsh-lab-x',
    lockedPath: 'C:\\Temp\\dsh-lab-x\\home',
    errorCode: 'EBUSY',
    holders: [{ pid: 12, name: 'DeepSeek Harness.exe' }],
    attempts: 5,
    elapsedMs: 3_000,
  });
  assert.match(detail, /locked=C:\\Temp\\dsh-lab-x\\home/);
  assert.match(detail, /errorCode=EBUSY/);
  assert.match(detail, /holders=12 DeepSeek Harness\.exe/);
  assert.match(detail, /elapsedMs=3000/);
  assert.match(describeHomeCleanup({ removed: true, root: 'C:\\Temp\\dsh-lab-x', attempts: 3, elapsedMs: 900 }), /removed .* in 900ms/);
  assert.match(describeHomeCleanup({ kept: true, root: 'C:\\profiles\\dev' }), /kept persistent profile/);
  assert.match(
    describeHomeCleanup({
      removed: false,
      root: 'C:\\Temp\\dsh-lab-x',
      lockedPath: 'C:\\Temp\\dsh-lab-x\\home\\dsh-orb\\electron-runtime\\resources\\default_app.js',
      errorCode: 'ENOENT',
      attempts: 11,
      elapsedMs: 31_618,
    }),
    /vanished=.*default_app\.js/,
  );
});

test('removeTreeSafely tolerates an entry that vanished before unlink (ENOENT race)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-race-'));
  fs.writeFileSync(path.join(root, 'race.txt'), 'x', 'utf8');
  fs.writeFileSync(path.join(root, 'other.txt'), 'y', 'utf8');
  const originalUnlink = fs.unlinkSync;
  let raced = 0;
  fs.unlinkSync = (target, ...args) => {
    if (String(target).endsWith('race.txt')) {
      originalUnlink(target); // the other deleter won the race
      raced += 1;
      const error = new Error(`ENOENT: no such file or directory, unlink '${target}'`);
      error.code = 'ENOENT';
      error.path = String(target);
      throw error;
    }
    return originalUnlink(target, ...args);
  };
  try {
    assert.doesNotThrow(() => removeTreeSafely(root));
    assert.equal(raced, 1);
    assert.equal(fs.existsSync(root), false);
  } finally {
    fs.unlinkSync = originalUnlink;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removeTreeSafely ignores a listed entry that vanished before lstat', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-race-'));
  fs.writeFileSync(path.join(root, 'real.txt'), 'r', 'utf8');
  const phantom = path.join(root, 'phantom.txt');
  const originalReaddir = fs.readdirSync;
  const originalLstat = fs.lstatSync;
  fs.readdirSync = (target, ...args) => (
    String(target) === root ? ['real.txt', 'phantom.txt'] : originalReaddir(target, ...args)
  );
  fs.lstatSync = (target, ...args) => {
    if (String(target) === phantom) {
      const error = new Error(`ENOENT: no such file or directory, lstat '${target}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return originalLstat(target, ...args);
  };
  try {
    assert.doesNotThrow(() => removeTreeSafely(root));
    assert.equal(fs.existsSync(root), false);
  } finally {
    fs.readdirSync = originalReaddir;
    fs.lstatSync = originalLstat;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removeTreeSafely re-sweeps a directory that is briefly non-empty (ENOTEMPTY race)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-race-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'a', 'utf8');
  const originalRmdir = fs.rmdirSync;
  let rmdirCalls = 0;
  fs.rmdirSync = (target, ...args) => {
    if (String(target) === root && rmdirCalls === 0) {
      rmdirCalls += 1;
      const error = new Error(`ENOTEMPTY: directory not empty, rmdir '${target}'`);
      error.code = 'ENOTEMPTY';
      throw error;
    }
    return originalRmdir(target, ...args);
  };
  try {
    assert.doesNotThrow(() => removeTreeSafely(root));
    assert.equal(rmdirCalls, 1);
    assert.equal(fs.existsSync(root), false);
  } finally {
    fs.rmdirSync = originalRmdir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('disposeIsolatedHome survives a plugin deleting the same tree (ENOENT race)', async () => {
  const iso = createIsolatedHome({ withAgents: true });
  const raceFile = path.join(iso.root, 'home', 'dsh-orb', 'electron-runtime', 'resources', 'default_app.js');
  fs.mkdirSync(path.dirname(raceFile), { recursive: true });
  fs.writeFileSync(raceFile, 'x', 'utf8');
  const originalUnlink = fs.unlinkSync;
  fs.unlinkSync = (target, ...args) => {
    if (String(target) === raceFile) {
      originalUnlink(target);
      const error = new Error(`ENOENT: no such file or directory, unlink '${target}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return originalUnlink(target, ...args);
  };
  try {
    const result = await disposeIsolatedHome(iso.root, {
      probeHolders: () => [],
      reapHolders: () => ({ matched: 0 }),
    });
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(result.errorCode, null, JSON.stringify(result));
    assert.equal(fs.existsSync(iso.root), false);
  } finally {
    fs.unlinkSync = originalUnlink;
    fs.rmSync(iso.root, { recursive: true, force: true });
  }
});

test('the default reaper kills a non-shell holder by its command line (electron.exe shape)', {
  skip: process.platform !== 'win32',
  timeout: 60_000,
}, async () => {
  const iso = createIsolatedHome({ withAgents: true });
  // dsh-orb spawns an `electron.exe` under the isolated home. A plain node.exe
  // with the root on its command line and as its CWD reproduces the same EBUSY:
  // only the name-agnostic, command-line/executable-path match can reap it.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', iso.root], {
    cwd: iso.root,
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await sleep(400);
    const result = await disposeIsolatedHome(iso.root, {
      totalBudgetMs: 25_000,
      initialDelayMs: 200,
      maxDelayMs: 500,
      holderWaitMs: 3_000,
      pollMs: 200,
    });
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(result.reapCalls >= 1, true, JSON.stringify(result));
    assert.equal(
      result.reaped.some((entry) => entry.pid === child.pid),
      true,
      `the non-shell holder must be reaped: ${JSON.stringify(result.reaped)}`,
    );
  } finally {
    await releaseRoot(child, iso.root);
  }
});
