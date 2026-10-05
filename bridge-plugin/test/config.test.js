import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_ARTIFACTS_DIRNAME,
  LabConfigError,
  detectLabRootFromPackage,
  resolveBridgeConfig,
  resolveLabEntry,
} from '../lib/config.js';

function makeLabRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-cfg-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'lab.js'), '#!/usr/bin/env node\n', 'utf8');
  return root;
}

test('labPath wins over DSH_LAB_HOME', () => {
  const configured = makeLabRoot();
  const envRoot = makeLabRoot();
  try {
    const config = resolveBridgeConfig({ labPath: configured }, { DSH_LAB_HOME: envRoot });
    assert.equal(config.labRoot, path.resolve(configured));
    assert.equal(config.labEntry, path.join(path.resolve(configured), 'bin', 'lab.js'));
  } finally {
    fs.rmSync(configured, { recursive: true, force: true });
    fs.rmSync(envRoot, { recursive: true, force: true });
  }
});

test('DSH_LAB_HOME is used when no labPath is configured', () => {
  const envRoot = makeLabRoot();
  try {
    const config = resolveBridgeConfig({}, { DSH_LAB_HOME: envRoot });
    assert.equal(config.labRoot, path.resolve(envRoot));
  } finally {
    fs.rmSync(envRoot, { recursive: true, force: true });
  }
});

test('a missing lab path fails with configuration guidance', () => {
  assert.throws(
    () => resolveBridgeConfig({}, {}),
    (error) => error instanceof LabConfigError
      && /labPath/.test(error.message)
      && /DSH_LAB_HOME/.test(error.message),
  );
});

test('resolveLabEntry accepts a direct path to bin/lab.js', () => {
  const root = makeLabRoot();
  try {
    const entry = path.join(root, 'bin', 'lab.js');
    const resolved = resolveLabEntry(entry);
    assert.equal(resolved.labEntry, entry);
    assert.equal(resolved.labRoot, path.resolve(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the co-located bridge-plugin layout auto-detects its parent lab', () => {
  const root = makeLabRoot();
  try {
    const packageDir = path.join(root, 'bridge-plugin');
    fs.mkdirSync(packageDir, { recursive: true });
    assert.equal(detectLabRootFromPackage(packageDir), path.resolve(root));
    const config = resolveBridgeConfig({}, {}, { packageDir });
    assert.equal(config.labRoot, path.resolve(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('artifact and timeout defaults are stable and overridable', () => {
  const root = makeLabRoot();
  try {
    const fallback = resolveBridgeConfig({ labPath: root }, {});
    assert.equal(path.basename(fallback.artifactsDir), DEFAULT_ARTIFACTS_DIRNAME);
    assert.equal(fallback.timeoutMs, 240_000);
    assert.equal(fallback.nodeExe, process.execPath);
    assert.equal(fallback.routePrefix, '/dsh-lab-bridge');

    const explicit = resolveBridgeConfig(
      { labPath: root, artifactsDir: path.join(root, 'artifacts'), timeoutMs: 1000 },
      {},
    );
    assert.equal(explicit.artifactsDir, path.join(path.resolve(root), 'artifacts'));
    assert.equal(explicit.timeoutMs, 1000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('DSH_LAB_BRIDGE_ARTIFACTS overrides the artifact location', () => {
  const root = makeLabRoot();
  const artifacts = path.join(os.tmpdir(), 'dsh-lab-bridge-custom-artifacts');
  try {
    const config = resolveBridgeConfig({ labPath: root }, { DSH_LAB_BRIDGE_ARTIFACTS: artifacts });
    assert.equal(config.artifactsDir, path.resolve(artifacts));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
