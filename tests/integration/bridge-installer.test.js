import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BRIDGE_PLUGIN_NAME, countBridgeBlocks, installBridge, statusBridge, uninstallBridge } from '../../src/bridge-installer.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const labEntry = path.resolve('bin', 'lab.js');

const SAMPLE_PATCH = [
  '# real profile comment',
  '- id: some-plugin',
  "  disabled: !!js process.platform !== 'win32'",
  '',
].join('\n');

const notRunning = async () => ({ running: false, reason: 'integration test override' });

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

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

function makeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-integration-'));
  const profileDir = path.join(root, 'profiles', 'desktop');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-desktop',
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), SAMPLE_PATCH, 'utf8');
  return { root, profileDir };
}

function bridgeOptions(home, extra = {}) {
  return {
    home: home.root,
    profile: 'desktop',
    labPath: path.resolve('.'),
    isDshRunning: notRunning,
    installTimeoutMs: 180_000,
    ...extra,
  };
}

test('bridge install -> idempotent -> dry-run -> rollback -> uninstall on a temp home', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const home = makeHome();
  try {
    const before = await statusBridge(bridgeOptions(home));
    assert.equal(before.installed, false);
    assert.equal(before.patchCount, 0);

    const first = await installBridge(bridgeOptions(home));
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.verify.nodeModulesPresent, true);
    assert.equal(first.verify.dependencyPresent, true);
    assert.equal(first.verify.bundlePresent, true);
    assert.equal(first.verify.patchCount, 1);
    assert.equal(fs.existsSync(path.join(home.profileDir, 'node_modules', BRIDGE_PLUGIN_NAME, 'package.json')), true);
    // The fake profile deliberately has no pnpm-workspace.yaml (per the task);
    // the installer falls back to the DSH pnpm defaults and records it missing.
    assert.equal(
      first.backup.some((entry) => entry.name === 'pnpm-workspace.yaml' && entry.exists === false),
      true,
      JSON.stringify(first.backup),
    );
    const patchAfterInstall = fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(countBridgeBlocks(patchAfterInstall), 1);
    assert.equal(patchAfterInstall.includes("!!js process.platform !== 'win32'"), true);

    // Idempotent: a second install creates another backup and keeps one entry.
    const second = await installBridge(bridgeOptions(home));
    assert.equal(second.ok, true, JSON.stringify(second));
    const manifest = JSON.parse(fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8'));
    assert.equal(Object.keys(manifest.dependencies).filter((name) => name === BRIDGE_PLUGIN_NAME).length, 1);
    assert.equal(manifest.dsh.profile.bundles.filter((name) => name === BRIDGE_PLUGIN_NAME).length, 1);
    assert.equal(countBridgeBlocks(fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8')), 1);
    assert.equal(fs.readdirSync(path.join(home.profileDir, '.lab-bridge-backup')).length, 2);
    assert.notEqual(first.backupDir, second.backupDir);

    // dry-run: zero writes anywhere under the home.
    const hashBefore = dirHash(home.root);
    const dry = await installBridge(bridgeOptions(home, { dryRun: true }));
    assert.equal(dry.ok, true);
    assert.equal(dry.dryRun, true);
    assert.equal(dirHash(home.root), hashBefore);

    // Injected pnpm failure: the four files must be restored to the pre-call content.
    const manifestBeforeFailure = fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8');
    const patchBeforeFailure = fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8');
    const failed = await installBridge(bridgeOptions(home, {
      runPnpm: async () => ({ ok: false, code: 1, timedOut: false, stdout: '', stderr: 'injected failure' }),
    }));
    assert.equal(failed.ok, false);
    assert.equal(failed.rollback, true);
    assert.equal(failed.errorCode, 'BRIDGE-PNPM-FAILED');
    assert.equal(fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8'), manifestBeforeFailure);
    assert.equal(fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8'), patchBeforeFailure);

    // Uninstall: back to the original semantics.
    const removed = await uninstallBridge(bridgeOptions(home));
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.equal(fs.readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8'), SAMPLE_PATCH);
    const afterManifest = JSON.parse(fs.readFileSync(path.join(home.profileDir, 'package.json'), 'utf8'));
    assert.equal(BRIDGE_PLUGIN_NAME in afterManifest.dependencies, false);
    assert.equal(afterManifest.dsh.profile.bundles.includes(BRIDGE_PLUGIN_NAME), false);
    const after = await statusBridge(bridgeOptions(home));
    assert.equal(after.installed, false);
    assert.equal(after.patchCount, 0);
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});

test('lab bridge status --json reports a temp home correctly', {
  skip: !enabled,
  timeout: 120_000,
}, () => {
  const home = makeHome();
  try {
    const stdout = execFileSync(process.execPath, [
      labEntry, 'bridge', 'status', '--home', home.root, '--profile', 'desktop', '--json',
    ], { cwd: path.resolve('.'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const status = JSON.parse(stdout);
    assert.equal(status.ok, true);
    assert.equal(status.profile, 'desktop');
    assert.equal(status.profileExists, true);
    assert.equal(status.installed, false);
    assert.equal(status.patchCount, 0);
    assert.equal(typeof status.dshRunning.running, 'boolean');
  } finally {
    fs.rmSync(home.root, { recursive: true, force: true });
  }
});
