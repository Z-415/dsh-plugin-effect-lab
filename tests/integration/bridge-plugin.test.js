import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createIsolatedHome } from '../../src/home-manager.js';
import { installProfilePlugins } from '../../src/plugin-install.js';
import { writeMinimalProfile } from '../../src/profile-builder.js';
import { runLab } from '../../src/runner.js';
import { locateRuntime, readRuntimeVersion } from '../../src/runtime-locator.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const bridgeDir = path.resolve('bridge-plugin');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('installing the bridge never puts the lab itself into the isolated profile', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  const runtime = locateRuntime();
  const version = (await readRuntimeVersion(runtime)).version;
  const iso = createIsolatedHome({ withAgents: true });
  try {
    const profileName = 'lab-bridge-profile';
    const profileDir = iso.profileDir(profileName);
    writeMinimalProfile(profileDir, { name: profileName });
    const env = {
      DSH_HOME: iso.home,
      DSH_AGENTS_HOME: iso.agents,
      TEMP: iso.tmp,
      TMP: iso.tmp,
    };
    const result = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: [bridgeDir],
      fixture: false,
    });
    assert.equal(result.stage, 'postcheck', JSON.stringify(result.validation?.summary ?? result));
    assert.equal(result.summary.ok, true, JSON.stringify(result.summary));

    const manifest = readJson(path.join(profileDir, 'package.json'));
    const deps = Object.keys(manifest.dependencies ?? {});
    assert.equal(deps.includes('dsh-plugin-effect-lab-bridge'), true, deps.join(', '));
    assert.equal(deps.includes('dsh-plugin-effect-lab'), false, `the lab must never enter the profile: ${deps.join(', ')}`);

    const installedBridge = path.join(profileDir, 'node_modules', 'dsh-plugin-effect-lab-bridge');
    const installedLab = path.join(profileDir, 'node_modules', 'dsh-plugin-effect-lab');
    assert.equal(fs.existsSync(installedBridge), true);
    assert.equal(fs.existsSync(installedLab), false, 'dsh-plugin-effect-lab must not exist in node_modules');

    // The bridge package itself must not depend on or ship the lab.
    const bridgeManifest = readJson(path.join(installedBridge, 'package.json'));
    assert.deepEqual(bridgeManifest.dependencies ?? {}, {});
    assert.equal(JSON.stringify(bridgeManifest.peerDependencies ?? {}).includes('dsh-plugin-effect-lab'), false);
    assert.equal((bridgeManifest.files ?? []).some((entry) => String(entry).includes('src/')), false);
  } finally {
    await iso.dispose();
  }
});

test('lab verify installs the launcher bridge and boots the host', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  const artifactsRoot = fs.mkdtempSync(path.join(process.env.TEMP ?? '.', 'dsh-lab-bridge-e2e-'));
  try {
    const report = await runLab({
      mode: 'web',
      plugins: [bridgeDir],
      fixture: false,
      screenshots: [],
      artifactsRoot,
    });
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((check) => !check.pass), null, 2));
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
