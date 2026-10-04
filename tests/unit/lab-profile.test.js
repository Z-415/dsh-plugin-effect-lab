import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertSafeProfileDir,
  assertSafeProfileName,
  createLabProfile,
  labProfileDir,
  labProfilesRoot,
  listLabProfiles,
  openLabProfileHome,
  readLabProfile,
  recordProfilePlugins,
  removeLabProfile,
} from '../../src/lab-profile.js';

async function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-profiles-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('profile names are restricted to a safe alphabet', () => {
  assert.equal(assertSafeProfileName('dev'), 'dev');
  assert.equal(assertSafeProfileName('wallpaper-ui-tweaks'), 'wallpaper-ui-tweaks');
  for (const bad of ['../evil', 'Dev', '', 'a'.repeat(33), 'a/b', 'a b']) {
    assert.throws(() => assertSafeProfileName(bad), /invalid lab profile name/);
  }
});

test('assertSafeProfileDir refuses paths outside the profiles root', async () => {
  await withTempRoot((root) => {
    assert.equal(assertSafeProfileDir(path.join(root, 'dev')), path.join(root, 'dev'));
    assert.throws(() => assertSafeProfileDir(path.join(root, '..', 'outside')), /unsafe lab profile path/);
    assert.throws(() => assertSafeProfileDir(root), /unsafe lab profile path/);
  });
});

test('create, record, list, and remove a profile', async () => {
  await withTempRoot((root) => {
    const created = createLabProfile('dev');
    assert.equal(created.created, true);
    assert.equal(fs.existsSync(path.join(created.dir, 'home')), true);
    assert.deepEqual(readLabProfile('dev').plugins, []);

    recordProfilePlugins('dev', ['dsh-plugin-wallpaper-engine@1.2.0', 'dsh-ui-tweaks@0.20.0']);
    recordProfilePlugins('dev', ['dsh-plugin-wallpaper-engine@1.2.0']);
    const manifest = readLabProfile('dev');
    assert.deepEqual(manifest.plugins.map((entry) => entry.spec), [
      'dsh-plugin-wallpaper-engine@1.2.0',
      'dsh-ui-tweaks@0.20.0',
    ]);

    const second = createLabProfile('dev');
    assert.equal(second.created, false, 'creating twice keeps the existing manifest');

    const listed = listLabProfiles();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'dev');
    assert.equal(listed[0].plugins.length, 2);

    const removed = removeLabProfile('dev');
    assert.equal(removed.removed, true);
    assert.deepEqual(listLabProfiles(), []);
    assert.equal(labProfilesRoot(), root);
    assert.equal(labProfileDir('dev').startsWith(root), true);
  });
});

test('openLabProfileHome keeps the profile instead of deleting it', async () => {
  await withTempRoot(async (root) => {
    const home = openLabProfileHome('dev');
    assert.equal(home.persistent, true);
    assert.equal(home.name, 'dev');
    assert.equal(home.home.startsWith(root), true);
    fs.writeFileSync(path.join(home.tmp, 'marker.txt'), 'x', 'utf8');
    const result = await home.dispose();
    assert.equal(result.removed, false);
    assert.equal(result.kept, true);
    assert.equal(fs.existsSync(path.join(home.tmp, 'marker.txt')), true, 'the profile must survive dispose');
  });
});
