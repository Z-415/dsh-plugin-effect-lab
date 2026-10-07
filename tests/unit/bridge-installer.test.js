import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BRIDGE_PLUGIN_NAME,
  bridgeDependencySpec,
  countBridgeBlocks,
  defaultLabPath,
  detectDshRunning,
  extractBridgeLabPath,
  installBridge,
  planBridgeManifest,
  removeBridgePatch,
  rewriteBridgePatch,
  statusBridge,
  uninstallBridge,
} from '../../src/bridge-installer.js';

const SAMPLE_PATCH = [
  '# real profile comment that must survive',
  '- id: some-plugin',
  "  disabled: !!js process.platform !== 'win32'",
  '',
].join('\n');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Hash every file in a tree, so a dry-run can prove zero writes. */
function dirHash(root) {
  const entries = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries.push(`${path.relative(root, full).replace(/\\/g, '/')}:${sha256(fs.readFileSync(full))}`);
    }
  };
  walk(root);
  return sha256(entries.join('\n'));
}

function fakeRuntime(root) {
  const runtimeDir = path.join(root, 'runtime');
  const cmd = path.join(runtimeDir, 'cli', 'bin', 'dsh.cmd');
  fs.mkdirSync(path.dirname(cmd), { recursive: true });
  fs.writeFileSync(cmd, '@echo off\n', 'utf8');
  return cmd;
}

function makeHome(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-unit-'));
  const profileDir = path.join(root, 'profiles', options.profile ?? 'desktop');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'package.json'),
    `${JSON.stringify({
      name: `dsh-profile-${options.profile ?? 'desktop'}`,
      dependencies: { 'keep-me': '^1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'keep-me'] } },
    }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), options.patch ?? SAMPLE_PATCH, 'utf8');
  fs.writeFileSync(path.join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', 'utf8');
  fs.writeFileSync(path.join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8');
  return { root, profileDir, runtimePath: fakeRuntime(root) };
}

/** A pnpm double that records calls, can fail the first time, and creates the link. */
function fakePnpm(options = {}) {
  const calls = [];
  const fn = async (call) => {
    calls.push(call);
    if (options.failFirst === true && calls.length === 1) {
      return { ok: false, code: 1, timedOut: false, stdout: '', stderr: 'registry unreachable' };
    }
    const installed = path.join(call.profileDir, 'node_modules', BRIDGE_PLUGIN_NAME);
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), `${JSON.stringify({ name: BRIDGE_PLUGIN_NAME })}\n`, 'utf8');
    return { ok: true, code: 0, timedOut: false, stdout: 'done', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

const notRunning = async () => ({ running: false, reason: 'test' });
const running = async () => ({ running: true, reason: 'test port 19387' });

test('rewriteBridgePatch appends one block and preserves !!js and comments', () => {
  const out = rewriteBridgePatch(SAMPLE_PATCH, 'D:\\dsh-plugin-effect-lab');
  assert.equal(countBridgeBlocks(out), 1);
  assert.equal(out.includes("!!js process.platform !== 'win32'"), true);
  assert.equal(out.includes('# real profile comment that must survive'), true);
  assert.equal(extractBridgeLabPath(out), 'D:\\dsh-plugin-effect-lab');
});

test('rewriteBridgePatch replaces an existing block and is idempotent', () => {
  const first = rewriteBridgePatch(SAMPLE_PATCH, 'D:\\one');
  const second = rewriteBridgePatch(first, 'D:\\two');
  assert.equal(countBridgeBlocks(second), 1);
  assert.equal(extractBridgeLabPath(second), 'D:\\two');
  assert.equal(rewriteBridgePatch(second, 'D:\\two'), second);
  assert.equal(second.includes('- id: effect-lab-bridge'), true);
  assert.equal(second.includes("!!js process.platform !== 'win32'"), true);
});

test('removeBridgePatch removes only the bridge block', () => {
  const withBlock = rewriteBridgePatch(SAMPLE_PATCH, 'D:\\lab');
  assert.equal(removeBridgePatch(withBlock), SAMPLE_PATCH);
  assert.equal(removeBridgePatch(SAMPLE_PATCH), SAMPLE_PATCH);
});

test('planBridgeManifest adds/updates the dependency and bundle idempotently', () => {
  const base = { dependencies: { other: '1.0.0' }, dsh: { profile: { bundles: ['other'] } } };
  const spec = bridgeDependencySpec('D:\\lab');
  assert.equal(spec, 'file:D:/lab/bridge-plugin');
  const installed = planBridgeManifest(base, { action: 'install', dependencySpec: spec });
  assert.equal(installed.dependencies[BRIDGE_PLUGIN_NAME], spec);
  assert.equal(installed.dsh.profile.bundles.filter((name) => name === BRIDGE_PLUGIN_NAME).length, 1);
  const installedAgain = planBridgeManifest(installed, { action: 'install', dependencySpec: spec });
  assert.deepEqual(installedAgain, installed);
  const removed = planBridgeManifest(installed, { action: 'uninstall' });
  assert.equal(BRIDGE_PLUGIN_NAME in removed.dependencies, false);
  assert.equal(removed.dsh.profile.bundles.includes(BRIDGE_PLUGIN_NAME), false);
});

test('detectDshRunning checks the port first, then the process name', async () => {
  assert.equal((await detectDshRunning({ connect: async () => true })).running, true);
  assert.equal((await detectDshRunning({
    connect: async () => false,
    listProcesses: () => ({ processes: [{ pid: 7, name: 'DeepSeek Harness.exe' }] }),
  })).running, true);
  assert.equal((await detectDshRunning({
    connect: async () => false,
    listProcesses: () => ({ processes: [] }),
  })).running, false);
});

test('installBridge writes the dependency, bundle and patch block', async () => {
  const home = makeHome();
  const pnpm = fakePnpm();
  try {
    const result = await installBridge({
      home: home.root,
      profile: 'desktop',
      labPath: path.resolve('.'),
      runtimePath: home.runtimePath,
      isDshRunning: notRunning,
      runPnpm: pnpm,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.verify.dependencyPresent, true);
    assert.equal(result.verify.bundlePresent, true);
    assert.equal(result.verify.nodeModulesPresent, true);
    assert.equal(result.verify.patchCount, 1);
    assert.equal(fs.existsSync(path.join(result.backupDir, 'BEFORE-HASHES.txt')), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies[BRIDGE_PLUGIN_NAME].startsWith('file:'), true);
    assert.equal(manifest.dsh.profile.bundles.filter((name) => name === BRIDGE_PLUGIN_NAME).length, 1);
    const patch = fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(countBridgeBlocks(patch), 1);
    assert.equal(patch.includes("!!js process.platform !== 'win32'"), true);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('installBridge is idempotent and keeps a backup per run', async () => {
  const home = makeHome();
  const pnpm = fakePnpm();
  try {
    const first = await installBridge({
      home: home.root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: home.runtimePath, isDshRunning: notRunning, runPnpm: pnpm,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    const second = await installBridge({
      home: home.root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: home.runtimePath, isDshRunning: notRunning, runPnpm: pnpm,
      now: new Date('2026-01-01T00:00:01.000Z'),
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8'));
    assert.equal(Object.keys(manifest.dependencies).filter((name) => name === BRIDGE_PLUGIN_NAME).length, 1);
    assert.equal(manifest.dsh.profile.bundles.filter((name) => name === BRIDGE_PLUGIN_NAME).length, 1);
    const patch = fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(countBridgeBlocks(patch), 1);
    const backups = fs.readdirSync(path.join(home.profileDir, '.lab-bridge-backup'));
    assert.equal(backups.length, 2);
    assert.notEqual(first.backupDir, second.backupDir);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('installBridge --dry-run writes nothing', async () => {
  const home = makeHome();
  try {
    const before = dirHash(home.root);
    const result = await installBridge({
      home: home.root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: home.runtimePath, isDshRunning: notRunning, runPnpm: fakePnpm(), dryRun: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.changed.patchChanged, true);
    assert.equal(dirHash(home.root), before);
    assert.equal(fs.existsSync(path.join(home.profileDir, '.lab-bridge-backup')), false);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('installBridge refuses while DSH is running and writes nothing', async () => {
  const home = makeHome();
  try {
    const before = dirHash(home.root);
    const result = await installBridge({
      home: home.root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: home.runtimePath, isDshRunning: running, runPnpm: fakePnpm(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.refused, true);
    assert.equal(result.action, 'install');
    assert.equal(result.errorCode, 'BRIDGE-DSH-RUNNING');
    assert.equal(dirHash(home.root), before);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('installBridge defaults --lab-path to the repository that contains bin/lab.js', async () => {
  const home = makeHome();
  try {
    const result = await installBridge({
      home: home.root, profile: 'desktop', runtimePath: home.runtimePath,
      isDshRunning: notRunning, runPnpm: fakePnpm(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.labPath, defaultLabPath());
    const patch = fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(extractBridgeLabPath(patch), defaultLabPath());
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('uninstallBridge refusal carries the uninstall action', async () => {
  const home = makeHome();
  try {
    const result = await uninstallBridge({
      home: home.root, profile: 'desktop', runtimePath: home.runtimePath,
      isDshRunning: running, runPnpm: fakePnpm(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'uninstall');
    assert.equal(result.errorCode, 'BRIDGE-DSH-RUNNING');
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('the double-click entries call install and uninstall', () => {
  assert.match(fs.readFileSync(path.resolve('安装桥接插件.cmd'), 'utf8'), /bridge install/);
  assert.match(fs.readFileSync(path.resolve('卸载桥接插件.cmd'), 'utf8'), /bridge uninstall/);
});

test('installBridge refuses a missing profile or bridge plugin', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-missing-'));
  try {
    const missingProfile = await installBridge({
      home: root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: fakeRuntime(root), isDshRunning: notRunning, runPnpm: fakePnpm(),
    });
    assert.equal(missingProfile.errorCode, 'BRIDGE-PROFILE-MISSING');
    const home = makeHome();
    try {
      const missingPlugin = await installBridge({
        home: home.root, profile: 'desktop', labPath: root,
        runtimePath: home.runtimePath, isDshRunning: notRunning, runPnpm: fakePnpm(),
      });
      assert.equal(missingPlugin.errorCode, 'BRIDGE-PLUGIN-MISSING');
    } finally {
      fs.rmSync(home.root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a failed pnpm install rolls the four files back', async () => {
  const home = makeHome();
  const beforeManifest = fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8');
  const beforePatch = fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8');
  const pnpm = fakePnpm({ failFirst: true });
  try {
    const result = await installBridge({
      home: home.root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: home.runtimePath, isDshRunning: notRunning, runPnpm: pnpm,
    });
    assert.equal(result.ok, false);
    assert.equal(result.rollback, true);
    assert.equal(result.errorCode, 'BRIDGE-PNPM-FAILED');
    assert.equal(fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8'), beforeManifest);
    assert.equal(fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8'), beforePatch);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('uninstall restores the pre-install semantics', async () => {
  const home = makeHome();
  const pnpm = fakePnpm();
  try {
    await installBridge({
      home: home.root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: home.runtimePath, isDshRunning: notRunning, runPnpm: pnpm,
    });
    const result = await uninstallBridge({
      home: home.root, profile: 'desktop', runtimePath: home.runtimePath,
      isDshRunning: notRunning, runPnpm: pnpm,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const manifest = JSON.parse(fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8'));
    assert.equal(BRIDGE_PLUGIN_NAME in manifest.dependencies, false);
    assert.equal(manifest.dsh.profile.bundles.includes(BRIDGE_PLUGIN_NAME), false);
    assert.equal(fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8'), SAMPLE_PATCH);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('status reports before/after/after-uninstall', async () => {
  const home = makeHome();
  const pnpm = fakePnpm();
  try {
    const before = await statusBridge({ home: home.root, profile: 'desktop', isDshRunning: notRunning });
    assert.equal(before.installed, false);
    assert.equal(before.dependencyPresent, false);
    assert.equal(before.bundlePresent, false);
    assert.equal(before.nodeModulesPresent, false);
    assert.equal(before.patchCount, 0);
    assert.equal(before.labPath, null);
    await installBridge({
      home: home.root, profile: 'desktop', labPath: path.resolve('.'),
      runtimePath: home.runtimePath, isDshRunning: notRunning, runPnpm: pnpm,
    });
    const installed = await statusBridge({ home: home.root, profile: 'desktop', isDshRunning: notRunning });
    assert.equal(installed.installed, true);
    assert.equal(installed.patchCount, 1);
    assert.equal(installed.labPath, path.resolve('.'));
    assert.equal(installed.labPathExists, true);
    await uninstallBridge({
      home: home.root, profile: 'desktop', runtimePath: home.runtimePath,
      isDshRunning: notRunning, runPnpm: pnpm,
    });
    const after = await statusBridge({ home: home.root, profile: 'desktop', isDshRunning: notRunning });
    assert.equal(after.installed, false);
    assert.equal(after.patchCount, 0);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});
