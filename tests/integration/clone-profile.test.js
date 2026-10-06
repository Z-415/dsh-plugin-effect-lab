import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REAL_HOME } from '../../src/config.js';
import { createIsolatedHome } from '../../src/home-manager.js';
import { scanForCredentials } from '../../src/model-coverage.js';
import { cloneProfileInto, diffCloneSource, snapshotCloneSource } from '../../src/profile-cloner.js';
import { diffRealHome, snapshotRealHome } from '../../src/real-home-guard.js';
import { runLab } from '../../src/runner.js';

const enabled = process.env.DSH_LAB_E2E === '1';

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
