import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REAL_HOME } from '../../src/config.js';
import { createIsolatedHome } from '../../src/home-manager.js';
import { listLabProfiles } from '../../src/lab-profile.js';
import { scanForCredentials } from '../../src/model-coverage.js';
import { cloneProfileInto, diffCloneSource, snapshotCloneSource } from '../../src/profile-cloner.js';
import { diffRealHome, snapshotRealHome } from '../../src/real-home-guard.js';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const labEntry = path.resolve('bin', 'lab.js');

test('lab verify --clone-profile web --clone-plugins none boots from a real structural clone', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-clone-e2e-'));
  try {
    const report = await runLab({
      mode: 'web',
      cloneProfile: 'web',
      clonePlugins: 'none',
      fixture: false,
      screenshots: ['home'],
      artifactsRoot,
      html: false,
    });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(report.clone.kind, 'web');
    assert.equal(report.clone.plugins, 'none');
    assert.equal(report.clone.nodeModulesCopied, false);
    assert.equal(report.clone.credentialsCopied, false);
    assert.equal(report.clone.sourceUnchangedAfterCopy, true);
    assert.equal(report.clone.credentials.ok, true, JSON.stringify(report.clone.credentials));
    assert.equal(report.clone.install.ok, true, JSON.stringify(report.clone.install));
    assert.equal(report.clone.excluded.length > 0, true, 'clone-plugins none must drop third-party plugins');
    assert.equal(report.realHome?.diff?.ok, true, JSON.stringify(report.realHome?.diff));
    const names = new Set((report.checks ?? []).map((check) => check.name));
    for (const name of ['clone-source', 'clone-real-profile-unchanged', 'clone-no-credentials', 'clone-install', 'real-home-unchanged']) {
      assert.equal(names.has(name), true, name);
    }
    for (const check of report.checks ?? []) {
      if (check.name.startsWith('clone-')) assert.equal(check.pass, true, JSON.stringify(check));
    }
    assert.equal(report.profile.clonedFrom, 'web');
    assert.equal(report.cleanup.homeRemoved, true, 'a one-shot clone must be cleaned up');
  } finally {
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});

test('clone-exclude and clone-drop-local remove plugins and never touch the real profile', {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const realWebManifest = path.join(REAL_HOME, 'profiles', 'web', 'package.json');
  if (!fs.existsSync(realWebManifest)) {
    assert.equal(true, true, 'no real web profile on this machine; nothing to clone');
    return;
  }
  const realManifest = JSON.parse(fs.readFileSync(realWebManifest, 'utf8'));
  const excludeTarget = Object.keys(realManifest.dependencies ?? {}).find((name) => !name.startsWith('@deepseek-ai/'));
  assert.equal(typeof excludeTarget, 'string', 'the real web profile should have at least one third-party plugin');

  const realBefore = snapshotRealHome();
  const sourceBefore = snapshotCloneSource(REAL_HOME, 'web');
  const iso = createIsolatedHome({ withAgents: true });
  try {
    const profileDir = iso.profileDir('lab-clone-exclude');
    const clone = cloneProfileInto({
      realHome: REAL_HOME,
      kind: 'web',
      profileDir,
      exclude: [excludeTarget],
      dropLocal: true,
    });
    const cloned = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    assert.equal(Object.hasOwn(cloned.dependencies, excludeTarget), false, `--clone-exclude must drop ${excludeTarget}`);
    assert.equal(cloned.dsh.profile.bundles.includes(excludeTarget), false);
    assert.equal(clone.excluded.some((entry) => entry.name === excludeTarget), true, JSON.stringify(clone.excluded));
    assert.equal(clone.droppedLocal.length > 0, true, 'the real web profile has file:/link: local plugins');
    for (const entry of clone.droppedLocal) {
      assert.equal(Object.hasOwn(cloned.dependencies, entry.name), false, entry.name);
    }
    assert.equal(fs.existsSync(path.join(profileDir, 'node_modules')), false, 'node_modules must never be copied');
    const credentials = scanForCredentials(iso.home);
    assert.equal(credentials.ok, true, JSON.stringify(credentials));
    assert.equal(diffCloneSource(sourceBefore, snapshotCloneSource(REAL_HOME, 'web')).ok, true);
    assert.equal(diffRealHome(realBefore, snapshotRealHome()).ok, true);
  } finally {
    await iso.dispose();
  }
});

test('--clone-to persists a marked, reusable clone, refuses a same-name rerun, and force-overwrites', {
  skip: !enabled,
  timeout: 600_000,
}, async () => {
  const profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-clone-persist-'));
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-clone-persist-artifacts-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = profilesRoot;
  try {
    const first = await runLab({
      cloneTo: 'clone-web',
      cloneProfile: 'web',
      clonePlugins: 'none',
      fixture: false,
      screenshots: ['home'],
      artifactsRoot,
      html: false,
    });
    assert.equal(first.ok, true, JSON.stringify((first.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(first.clone.persistent, true);
    assert.equal(first.clone.profile, 'clone-web');
    assert.equal(first.cleanup.homeKept, true);
    assert.equal(fs.existsSync(path.join(profilesRoot, 'clone-web')), true);

    // The source marker is written to lab-profile.json and surfaced by profile list.
    const manifest = JSON.parse(fs.readFileSync(path.join(profilesRoot, 'clone-web', 'lab-profile.json'), 'utf8'));
    assert.equal(manifest.clonedFrom.kind, 'web');
    assert.equal(manifest.clonedFrom.copiedFiles, first.clone.copiedFiles.length, JSON.stringify(manifest.clonedFrom));
    assert.equal(manifest.clonedFrom.sourceHash.length, 12);
    assert.equal(Array.isArray(manifest.clonedFrom.excluded), true);
    const listed = listLabProfiles().find((profile) => profile.name === 'clone-web');
    assert.equal(listed.clonedFrom.kind, 'web');

    // The safety assertions still hold.
    for (const name of ['clone-real-profile-unchanged', 'clone-no-credentials', 'real-home-unchanged']) {
      const check = (first.checks ?? []).find((item) => item.name === name);
      assert.equal(check?.pass, true, `${name}: ${JSON.stringify(check)}`);
    }

    // A same-name rerun is refused (the CLI rejects it before the runner; the
    // runner itself also refuses with the same message).
    const refused = await runLab({
      cloneTo: 'clone-web',
      cloneProfile: 'web',
      clonePlugins: 'none',
      fixture: false,
      screenshots: [],
      artifactsRoot,
      html: false,
    });
    assert.equal(refused.ok, false);
    const refusedCheck = (refused.checks ?? []).find((check) => check.name === 'run');
    assert.match(refusedCheck?.detail ?? '', /already exists/);
    assert.match(refusedCheck?.detail ?? '', /--force/);

    // --force overwrites it (junction-safely) and re-clones.
    const forced = await runLab({
      cloneTo: 'clone-web',
      cloneProfile: 'web',
      clonePlugins: 'none',
      force: true,
      fixture: false,
      screenshots: [],
      artifactsRoot,
      html: false,
    });
    assert.equal(forced.ok, true, JSON.stringify((forced.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(JSON.parse(fs.readFileSync(path.join(profilesRoot, 'clone-web', 'lab-profile.json'), 'utf8')).clonedFrom.kind, 'web');

    // A non-persistent clone prints how to keep it.
    const oneShot = await runLab({
      cloneProfile: 'web',
      clonePlugins: 'none',
      fixture: false,
      screenshots: [],
      artifactsRoot,
      html: false,
    });
    assert.equal(oneShot.hints.some((hint) => hint.includes('临时的')), true, JSON.stringify(oneShot.hints));

    // Acceptance: the persistent clone can be reopened with lab shell.
    const shellOut = execFileSync(process.execPath, [
      labEntry,
      'shell',
      '--profile-lab', 'clone-web',
      '--no-compare-web',
      '--show',
      '--show-hold', '3000',
      '--no-html',
      '--artifacts', artifactsRoot,
    ], {
      cwd: path.resolve('.'),
      env: { ...process.env, DSH_LAB_PROFILES: profilesRoot },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.match(shellOut, /壳模式: 通过/);
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(profilesRoot, { recursive: true, force: true });
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});

test('cloning all real plugins installs them and grants in-clone exemptions so they load', {
  skip: !enabled,
  timeout: 600_000,
}, async () => {
  const profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-clone-full-'));
  const artifactsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-clone-full-artifacts-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = profilesRoot;
  try {
    const report = await runLab({
      cloneTo: 'clone-full',
      cloneProfile: 'web',
      clonePlugins: 'all',
      cloneAcceptRisk: true,
      fixture: false,
      screenshots: ['home'],
      artifactsRoot,
      html: false,
    });
    assert.equal(report.ok, true, JSON.stringify((report.checks ?? []).filter((check) => !check.pass), null, 2));
    assert.equal(report.clone.plugins, 'all');
    assert.equal(report.clone.persistent, true);
    assert.equal(report.clone.install.missing.length, 0, JSON.stringify(report.clone.install.missing));
    assert.equal(report.clone.install.code, 0, JSON.stringify(report.clone.install));
    assert.equal(
      report.clone.install.incompatible.length,
      0,
      'after granting the exemptions the recheck must not deny any plugin',
    );
    assert.equal(
      report.clone.exemptions.granted.length,
      report.clone.incompatibleBefore.length,
      JSON.stringify(report.clone.exemptions),
    );
    assert.deepEqual(report.clone.exemptions.failures, []);
    // The plugins actually reached the renderer (more slots than a bare clone).
    assert.equal(report.browser.dom.slotCount > 0, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(profilesRoot, 'clone-full', 'lab-profile.json'), 'utf8'));
    assert.equal(manifest.clonedFrom.plugins, 'all');
    assert.equal(manifest.clonedFrom.installed, report.clone.install.installed.length);
    assert.equal(manifest.clonedFrom.acceptedRisk, report.clone.exemptions.granted.length);
    assert.deepEqual(manifest.clonedFrom.missing, []);
    for (const name of ['clone-real-profile-unchanged', 'clone-no-credentials', 'real-home-unchanged']) {
      const check = (report.checks ?? []).find((item) => item.name === name);
      assert.equal(check?.pass, true, `${name}: ${JSON.stringify(check)}`);
    }
    const cloneCompat = (report.checks ?? []).find((check) => check.name === 'clone-compat');
    assert.equal(cloneCompat?.pass, true, JSON.stringify(cloneCompat));
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(profilesRoot, { recursive: true, force: true });
    fs.rmSync(artifactsRoot, { recursive: true, force: true });
  }
});
