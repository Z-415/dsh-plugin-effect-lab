import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertSafeProfileDir,
  assertSafeProfileName,
  createLabProfile,
  forgetProfilePlugins,
  isClonedLabProfile,
  labProfileDir,
  labProfilesRoot,
  listLabProfiles,
  openLabProfileHome,
  profileExists,
  profilePluginMatches,
  readLabProfile,
  recordProfileClone,
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

test('recordProfilePlugins keeps a resolved name so a path spec can be removed by name', async () => {
  await withTempRoot(() => {
    recordProfilePlugins('dev', [
      { spec: './fixtures/plugins/effect-probe', name: 'dsh-lab-effect-probe' },
      'dsh-plugin-wallpaper-engine@1.2.0',
    ]);
    const manifest = readLabProfile('dev');
    assert.deepEqual(manifest.plugins.map((entry) => entry.spec), [
      './fixtures/plugins/effect-probe',
      'dsh-plugin-wallpaper-engine@1.2.0',
    ]);
    assert.equal(manifest.plugins[0].name, 'dsh-lab-effect-probe');
    assert.equal(manifest.plugins[1].name, undefined, 'a string spec records no resolved name');
  });
});

test('forgetProfilePlugins matches by spec, name@version, and bare name', async () => {
  await withTempRoot(() => {
    recordProfilePlugins('dev', [
      { spec: './fixtures/plugins/effect-probe', name: 'dsh-lab-effect-probe' },
      'dsh-plugin-wallpaper-engine@1.2.0',
      'dsh-ui-tweaks@0.20.0',
    ]);

    const byPathSpec = forgetProfilePlugins('dev', ['./fixtures/plugins/effect-probe']);
    assert.deepEqual(byPathSpec.removed.map((entry) => entry.name), ['dsh-lab-effect-probe']);

    const byVersionedName = forgetProfilePlugins('dev', ['dsh-plugin-wallpaper-engine@1.2.0']);
    assert.deepEqual(byVersionedName.removed.map((entry) => entry.spec), ['dsh-plugin-wallpaper-engine@1.2.0']);

    const byBareName = forgetProfilePlugins('dev', ['dsh-ui-tweaks']);
    assert.deepEqual(byBareName.removed.map((entry) => entry.spec), ['dsh-ui-tweaks@0.20.0']);

    assert.deepEqual(readLabProfile('dev').plugins, []);
  });
});

test('forgetProfilePlugins leaves unrelated plugins alone and ignores empty selectors', async () => {
  await withTempRoot(() => {
    recordProfilePlugins('dev', ['dsh-plugin-wallpaper-engine@1.2.0']);
    const result = forgetProfilePlugins('dev', ['not-installed', '']);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(readLabProfile('dev').plugins.map((entry) => entry.spec), ['dsh-plugin-wallpaper-engine@1.2.0']);
  });
});

test('profilePluginMatches compares names without being confused by versions', () => {
  assert.equal(profilePluginMatches({ spec: 'pkg@1.2.3' }, 'pkg'), true);
  assert.equal(profilePluginMatches({ spec: 'pkg@1.2.3' }, 'pkg@9.9.9'), true);
  assert.equal(profilePluginMatches({ spec: './local-dir', name: 'local-pkg' }, 'local-pkg'), true);
  assert.equal(profilePluginMatches({ spec: 'pkg@1.2.3' }, 'other'), false);
  assert.equal(profilePluginMatches({ spec: 'pkg@1.2.3' }, ''), false);
});

test('listLabProfiles reports node_modules/bundles/lastRunAt for the GUI', async () => {
  await withTempRoot((root) => {
    createLabProfile('dev');
    const profileDir = path.join(root, 'dev', 'home', 'profiles', 'lab-dev');
    fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, 'package.json'),
      `${JSON.stringify({
        name: 'lab-dev',
        dependencies: { '@deepseek-ai/dsh-base': '0.2.0-rc.2', 'dsh-x': '1.0.0' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-x'] } },
      }, null, 2)}\n`,
      'utf8',
    );
    const [listed] = listLabProfiles();
    assert.equal(listed.nodeModulesExists, true);
    assert.equal(listed.dependenciesCount, 1, 'only third-party deps are counted');
    assert.equal(listed.bundlesCount, 2);
    assert.equal(typeof listed.lastRunAt, 'number');
  });
});

test('removeLabProfile unlinks a junction instead of deleting its target', async () => {
  await withTempRoot((root) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-outside-'));
    fs.writeFileSync(path.join(outside, 'source.js'), 'do not delete me', 'utf8');
    try {
      createLabProfile('dev');
      const profileDir = path.join(root, 'dev', 'home', 'profiles', 'lab-dev');
      fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
      const link = path.join(profileDir, 'node_modules', 'local-source');
      // pnpm links a `file:`/`link:` directory dependency with a junction.
      fs.symlinkSync(outside, link, 'junction');
      const result = removeLabProfile('dev');
      assert.equal(result.removed, true);
      assert.equal(fs.existsSync(path.join(root, 'dev')), false);
      assert.equal(fs.existsSync(link), false);
      assert.equal(fs.existsSync(path.join(outside, 'source.js')), true, 'the junction target must survive');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('removeLabProfile reports not-found without an error', async () => {
  await withTempRoot(() => {
    const result = removeLabProfile('missing');
    assert.equal(result.removed, false);
    assert.equal(result.error, undefined);
  });
});

test('profileExists and recordProfileClone round-trip the clonedFrom marker', async () => {
  await withTempRoot(() => {
    assert.equal(profileExists('clone-web'), false);
    const clonedFrom = {
      kind: 'web',
      at: '2026-10-06T00:00:00.000Z',
      sourceHash: 'ABCDEF123456',
      copiedFiles: 5,
      excluded: ['dsh-better-sidebar@0.19.1'],
      plugins: 'none',
    };
    recordProfileClone('clone-web', clonedFrom);
    assert.equal(profileExists('clone-web'), true);
    assert.deepEqual(readLabProfile('clone-web').clonedFrom, clonedFrom);
    const listed = listLabProfiles().find((profile) => profile.name === 'clone-web');
    assert.deepEqual(listed.clonedFrom, clonedFrom);
  });
});

test('profileExists also sees a DSH package.json without a lab manifest', async () => {
  await withTempRoot((root) => {
    const dir = path.join(root, 'clone-y', 'home', 'profiles', 'lab-clone-y');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}\n', 'utf8');
    assert.equal(profileExists('clone-y'), true);
    assert.equal(readLabProfile('clone-y'), null);
  });
});

test('isClonedLabProfile distinguishes a cloned profile from a normal one', async () => {
  await withTempRoot(() => {
    createLabProfile('dev');
    recordProfileClone('clone-web', {
      kind: 'web',
      at: '2026-10-06T00:00:00.000Z',
      sourceHash: 'ABCDEF123456',
      copiedFiles: 6,
      excluded: [],
    });
    assert.equal(isClonedLabProfile('clone-web'), true);
    assert.equal(isClonedLabProfile('dev'), false);
    assert.equal(isClonedLabProfile('missing'), false);
    assert.equal(isClonedLabProfile(null), false);
  });
});
