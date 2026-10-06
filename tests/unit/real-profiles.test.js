import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverRealProfiles } from '../../src/real-profiles.js';

function makeRealHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-real-profiles-'));
  const profiles = path.join(root, 'profiles');
  fs.mkdirSync(path.join(profiles, 'web'), { recursive: true });
  fs.writeFileSync(
    path.join(profiles, 'web', 'package.json'),
    `${JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { '@deepseek-ai/dsh-base': '1', 'dsh-x': '^1.2.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-x'] } },
    }, null, 2)}\n`,
    'utf8',
  );
  fs.mkdirSync(path.join(profiles, 'web', 'patches'));
  fs.mkdirSync(path.join(profiles, 'desktop'), { recursive: true });
  fs.writeFileSync(
    path.join(profiles, 'desktop', 'package.json'),
    `${JSON.stringify({ name: 'dsh-profile-desktop', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2)}\n`,
    'utf8',
  );
  // Must be filtered out: no package.json.
  fs.mkdirSync(path.join(profiles, 'half-created'), { recursive: true });
  // Must be filtered out by name.
  fs.mkdirSync(path.join(profiles, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(profiles, 'node_modules', 'package.json'), '{}\n', 'utf8');
  return root;
}

test('discoverRealProfiles accepts only package.json profile directories', () => {
  const root = makeRealHome();
  try {
    const profiles = discoverRealProfiles(root);
    assert.deepEqual(profiles.map((profile) => profile.name), ['desktop', 'web']);
    const web = profiles.find((profile) => profile.name === 'web');
    assert.equal(web.dependenciesCount, 1, 'only third-party deps are counted');
    assert.equal(web.bundlesCount, 2);
    assert.equal(web.hasPatches, true);
    assert.equal(profiles.some((profile) => profile.name === 'node_modules'), false);
    assert.equal(profiles.some((profile) => profile.name === 'half-created'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverRealProfiles returns [] for a missing profiles directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-no-profiles-'));
  try {
    assert.deepEqual(discoverRealProfiles(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
