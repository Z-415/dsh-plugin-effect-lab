import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLabProfile, openLabProfileHome } from '../../src/lab-profile.js';
import { installProfilePlugins, listInstalledProfilePlugins, removeProfilePlugins } from '../../src/plugin-install.js';
import { writeMinimalProfile } from '../../src/profile-builder.js';
import { locateRuntime, readRuntimeVersion } from '../../src/runtime-locator.js';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('remove-plugin uninstalls one plugin, trims its bundle, and keeps the other', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  const profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-profiles-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = profilesRoot;
  const runtime = locateRuntime();
  const version = (await readRuntimeVersion(runtime)).version;
  try {
    const name = 'remove';
    createLabProfile(name);
    const home = openLabProfileHome(name);
    const profileName = `lab-${name}`;
    const profileDir = home.profileDir(profileName);
    writeMinimalProfile(profileDir, { name: profileName });
    const env = {
      DSH_HOME: home.home,
      DSH_AGENTS_HOME: home.agents,
      DSH_TELEMETRY_DISABLED: '1',
      TEMP: home.tmp,
      TMP: home.tmp,
    };

    const installed = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: [
        path.resolve('fixtures/plugins/effect-probe'),
        path.resolve('fixtures/plugins/effect-probe-two'),
      ],
      fixture: false,
    });
    assert.equal(installed.stage, 'postcheck', JSON.stringify(installed.validation?.summary ?? {}));
    const installedNames = installed.pluginList.map((entry) => entry.name).sort();
    assert.deepEqual(installedNames, ['dsh-lab-effect-probe', 'dsh-lab-effect-probe-two']);

    const result = await removeProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      plugins: ['dsh-lab-effect-probe@1.0.0'],
    });
    assert.equal(result.ok, true, JSON.stringify(result.removeCommand ?? {}));
    assert.deepEqual(result.removed, ['dsh-lab-effect-probe']);

    const remaining = listInstalledProfilePlugins(profileDir);
    assert.deepEqual(remaining, ['dsh-lab-effect-probe-two']);
    assert.equal(fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-lab-effect-probe')), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-lab-effect-probe-two')), true);
    assert.equal(
      fs.existsSync(path.resolve('fixtures/plugins/effect-probe/package.json')),
      true,
      'removal must unlink the junction, never delete the plugin source it points at',
    );

    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    assert.equal(manifest.dsh.profile.bundles.includes('dsh-lab-effect-probe'), false);
    assert.equal(manifest.dsh.profile.bundles.includes('dsh-lab-effect-probe-two'), true);
    assert.equal(manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-base'), true, 'base bundles survive');

    const unmatched = await removeProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      plugins: ['dsh-not-installed'],
    });
    assert.equal(unmatched.ok, false);
    assert.equal(unmatched.stage, 'resolve');
    assert.deepEqual(unmatched.unmatched, ['dsh-not-installed']);
    assert.equal(unmatched.removeCommand, null, 'an unmatched selector must not spawn the runtime');
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(profilesRoot, { recursive: true, force: true });
  }
});

test('verify with --profile-lab reuses lab-<name> instead of wiping the profile', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-profiles-'));
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-e2e-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = profilesRoot;
  try {
    const name = 'verifyreuse';
    const profileDir = path.join(profilesRoot, name, 'home', 'profiles', `lab-${name}`);
    const first = await runLab({
      mode: 'web',
      plugins: [path.resolve('fixtures/plugins/effect-probe')],
      fixture: false,
      profileLab: name,
      screenshots: ['home'],
      artifactsRoot,
      html: false,
    });
    assert.equal(first.profile.name, `lab-${name}`, 'a persistent verify must use the lab-<name> profile');
    assert.equal(first.cleanup.homeKept, true);

    const depsAfterInstall = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).dependencies;
    assert.equal(Boolean(depsAfterInstall['dsh-lab-effect-probe']), true);

    // A second run with no --plugin must find the same profile and keep its tree.
    const second = await runLab({
      mode: 'web',
      fixture: false,
      profileLab: name,
      screenshots: ['home'],
      artifactsRoot,
      html: false,
    });
    assert.equal(second.profile.name, `lab-${name}`);
    const afterReuse = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    assert.equal(Boolean(afterReuse.dependencies['dsh-lab-effect-probe']), true, 'reopening must not wipe installed plugins');
    assert.equal(afterReuse.dsh.profile.bundles.includes('dsh-lab-effect-probe'), true);
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(profilesRoot, { recursive: true, force: true });
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
