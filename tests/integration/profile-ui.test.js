import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const labEntry = path.resolve('bin', 'lab.js');

function lab(args, env) {
  return execFileSync(process.execPath, [labEntry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function withProfilesRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-profile-ui-'));
  const env = { DSH_LAB_PROFILES: root };
  try {
    return fn(root, env);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function seedDshProfile(root, name, { withJunction = null } = {}) {
  const profileDir = path.join(root, name, 'home', 'profiles', `lab-${name}`);
  fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'package.json'),
    `${JSON.stringify({
      name: `lab-${name}`,
      dependencies: { '@deepseek-ai/dsh-base': '0.2.0-rc.2', 'dsh-x': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-x'] } },
    }, null, 2)}\n`,
    'utf8',
  );
  if (withJunction) {
    fs.symlinkSync(withJunction, path.join(profileDir, 'node_modules', 'local-source'), 'junction');
  }
  return profileDir;
}

test('lab profile list --json carries the GUI fields', () => {
  withProfilesRoot((root, env) => {
    lab(['profile', 'create', 'dev'], env);
    seedDshProfile(root, 'dev');
    const parsed = JSON.parse(lab(['profile', 'list', '--json'], env));
    const profile = parsed.profiles.find((entry) => entry.name === 'dev');
    assert.equal(profile.nodeModulesExists, true, JSON.stringify(profile));
    assert.equal(profile.dependenciesCount, 1);
    assert.equal(profile.bundlesCount, 2);
    assert.equal(typeof profile.lastRunAt, 'number');
    assert.equal(typeof profile.mtimeMs, 'number');
    assert.equal(Array.isArray(profile.plugins), true);
  });
});

test('lab profile remove is junction-safe and prints removed', () => {
  withProfilesRoot((root, env) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-profile-outside-'));
    fs.writeFileSync(path.join(outside, 'source.js'), 'do not delete me', 'utf8');
    try {
      lab(['profile', 'create', 'dev'], env);
      const profileDir = seedDshProfile(root, 'dev', { withJunction: outside });
      const output = lab(['profile', 'remove', 'dev'], env);
      assert.match(output, /removed/);
      assert.equal(fs.existsSync(path.join(root, 'dev')), false);
      assert.equal(fs.existsSync(profileDir), false);
      assert.equal(fs.existsSync(path.join(outside, 'source.js')), true, 'the junction target must survive');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('lab profile remove reports a missing profile without failing', () => {
  withProfilesRoot((_root, env) => {
    const output = lab(['profile', 'remove', 'missing'], env);
    assert.match(output, /not found/);
  });
});

test('lab verify --clone-to refuses an existing target without --force', () => {
  withProfilesRoot((_root, env) => {
    lab(['profile', 'create', 'clone-web'], env);
    let status = 0;
    let stderr = '';
    try {
      lab(['verify', '--clone-to', 'clone-web', '--clone-profile', 'web', '--clone-plugins', 'none', '--no-fixture'], env);
    } catch (error) {
      status = error.status;
      stderr = String(error.stderr ?? '');
    }
    assert.equal(status, 2, stderr);
    assert.match(stderr, /already exists/);
    assert.match(stderr, /--force/);
  });
});

test('lab real-profiles lists only package.json profile directories, read-only', () => {
  const parsed = JSON.parse(lab(['real-profiles', '--json'], {}));
  assert.equal(parsed.profiles.some((profile) => profile.name === 'node_modules'), false);
  for (const profile of parsed.profiles) {
    assert.equal(fs.existsSync(path.join(profile.dir, 'package.json')), true, JSON.stringify(profile));
    assert.equal(typeof profile.dependenciesCount, 'number');
    assert.equal(typeof profile.bundlesCount, 'number');
  }
});
