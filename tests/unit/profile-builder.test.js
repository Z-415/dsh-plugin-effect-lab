import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildProfileManifest,
  detectAddedDependencies,
  validateProfileManifest,
  writeMinimalProfile,
} from '../../src/profile-builder.js';

test('minimal profile is the two-bundle web template with no dependencies', () => {
  const manifest = buildProfileManifest({ name: 'lab-test' });
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
  assert.deepEqual(manifest.dependencies, {});
  assert.equal(validateProfileManifest(manifest).ok, true);
});

test('writeMinimalProfile writes the four profile scaffold files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-unit-'));
  try {
    writeMinimalProfile(dir, { name: 'lab-unit' });
    for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
      assert.equal(fs.existsSync(path.join(dir, file)), true, file);
    }
    assert.match(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), /^#/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectAddedDependencies reports only newly installed packages', () => {
  const before = { dependencies: {} };
  const after = { dependencies: { 'dsh-test-plugin': '1.0.0' } };
  assert.deepEqual(detectAddedDependencies(before, after), ['dsh-test-plugin']);
});
