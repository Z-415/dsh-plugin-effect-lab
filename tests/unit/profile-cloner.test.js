import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanForCredentials } from '../../src/model-coverage.js';
import {
  CLONE_DIRS,
  CLONE_FILES,
  assertCloneKind,
  classifyLocalSpec,
  cloneProfileInto,
  diffCloneSource,
  grantClonedProfileExemptions,
  parseIncompatiblePlugins,
  planClone,
  rebuildClonedProfile,
  rewriteLockfileLocalPaths,
  snapshotCloneSource,
} from '../../src/profile-cloner.js';

function makeRealHome(kind = 'web') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-realhome-'));
  const dir = path.join(root, 'profiles', kind);
  const posixRoot = root.replace(/\\/g, '/');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({
      name: `dsh-profile-${kind}`,
      dependencies: {
        '@deepseek-ai/dsh-base': '0.2.0-rc.2',
        'dsh-x': '^1.2.0',
        'local-dir': `file:${posixRoot}/plugins/local-dir`,
        'local-link': `link:${posixRoot}/linked/local-link`,
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-x', 'local-dir', 'local-link'] } },
    }, null, 2)}\n`,
    'utf8',
  );
  for (const name of ['cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    const body = name === 'pnpm-lock.yaml'
      ? 'lockfileVersion: 9\nversion: file:../../plugins/local-dir\n'
      : `${name}\n`;
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
  fs.writeFileSync(
    path.join(dir, 'compatibility.json'),
    `${JSON.stringify({ 'dsh-x@1.2.0': ['0.2.0-rc.2'] }, null, 2)}\n`,
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'patches'));
  fs.writeFileSync(path.join(dir, 'patches', 'a.patch'), 'patch-a\n', 'utf8');
  // Forbidden material that must never be read or copied.
  fs.writeFileSync(path.join(dir, '.credentials.yaml'), 'apiKey: supersecretvalue123\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'settings.yaml'), 'theme: dark\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'sessions'));
  fs.writeFileSync(path.join(dir, 'sessions', 's.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'agents'));
  fs.writeFileSync(path.join(dir, 'agents', 'a.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'node_modules', 'dsh-x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'dsh-x', 'package.json'), '{}', 'utf8');
  return { root, dir };
}

function makeTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-clone-'));
  return { root, profileDir: path.join(root, 'home', 'profiles', 'lab-clone') };
}

test('classifyLocalSpec recognizes file:, link:, and path specs', () => {
  assert.equal(classifyLocalSpec('file:C:/x/y'), 'file');
  assert.equal(classifyLocalSpec('link:C:/x/y'), 'link');
  assert.equal(classifyLocalSpec('./fixtures/plugins/x'), 'path');
  assert.equal(classifyLocalSpec('C:\\Users\\x\\plugin'), 'path');
  assert.equal(classifyLocalSpec('dsh-plugin-x@1.2.3'), null);
  assert.equal(classifyLocalSpec('github:a/b#v1'), null);
  assert.equal(classifyLocalSpec(''), null);
});

test('assertCloneKind only accepts web and desktop', () => {
  assert.equal(assertCloneKind('web'), 'web');
  assert.equal(assertCloneKind('desktop'), 'desktop');
  assert.throws(() => assertCloneKind('dev'), /must be one of web\|desktop/);
  assert.throws(() => assertCloneKind(''), /must be one of web\|desktop/);
});

test('cloneProfileInto copies only the structural allowlist and never credentials', () => {
  const real = makeRealHome('web');
  const target = makeTarget();
  try {
    const before = snapshotCloneSource(real.root, 'web');
    const clone = cloneProfileInto({ realHome: real.root, kind: 'web', profileDir: target.profileDir });
    assert.equal(clone.sourceUnchangedAfterCopy, true);
    assert.equal(clone.nodeModulesCopied, false);
    assert.equal(clone.credentialsCopied, false);

    for (const name of CLONE_FILES) {
      assert.equal(fs.existsSync(path.join(target.profileDir, name)), true, name);
    }
    for (const dir of CLONE_DIRS) {
      assert.equal(fs.existsSync(path.join(target.profileDir, dir)), true, dir);
    }
    assert.equal(fs.existsSync(path.join(target.profileDir, 'patches', 'a.patch')), true);
    assert.equal(clone.lockfileRewritten, true);
    const clonedLock = fs.readFileSync(path.join(target.profileDir, 'pnpm-lock.yaml'), 'utf8');
    assert.equal(clonedLock.includes(`file:${real.root.replace(/\\/g, '/')}/plugins/local-dir`), true, clonedLock);
    assert.equal(clonedLock.includes('file:../../plugins/local-dir'), false);

    for (const forbidden of ['node_modules', 'sessions', 'agents', '.credentials.yaml', 'settings.yaml']) {
      assert.equal(fs.existsSync(path.join(target.profileDir, forbidden)), false, forbidden);
    }
    const credentials = scanForCredentials(target.root);
    assert.equal(credentials.ok, true, JSON.stringify(credentials));

    // Reading the real source may never change its hashes.
    const after = snapshotCloneSource(real.root, 'web');
    assert.equal(diffCloneSource(before, after).ok, true);
  } finally {
    fs.rmSync(real.root, { recursive: true, force: true });
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('the cloned package.json is filtered but the real one is untouched', () => {
  const real = makeRealHome('web');
  const target = makeTarget();
  try {
    const realPackage = fs.readFileSync(path.join(real.dir, 'package.json'), 'utf8');
    cloneProfileInto({
      realHome: real.root,
      kind: 'web',
      profileDir: target.profileDir,
      exclude: ['dsh-x'],
      dropLocal: true,
    });
    const cloned = JSON.parse(fs.readFileSync(path.join(target.profileDir, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(cloned.dependencies), ['@deepseek-ai/dsh-base']);
    assert.deepEqual(cloned.dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
    assert.equal(fs.readFileSync(path.join(real.dir, 'package.json'), 'utf8'), realPackage);
  } finally {
    fs.rmSync(real.root, { recursive: true, force: true });
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('planClone reports excluded plugins and local file:/link: references', () => {
  const real = makeRealHome('web');
  try {
    const plan = planClone({ realHome: real.root, kind: 'web', exclude: ['dsh-x'] });
    assert.deepEqual(plan.excluded.map((entry) => entry.name), ['dsh-x']);
    assert.equal(plan.excluded[0].reason, 'clone-exclude');
    assert.deepEqual(Object.keys(plan.dependencies).sort(), ['@deepseek-ai/dsh-base', 'local-dir', 'local-link']);
    assert.deepEqual(plan.localPlugins.map((entry) => entry.name).sort(), ['local-dir', 'local-link']);
    assert.deepEqual(plan.bundles, ['@deepseek-ai/dsh-base', 'local-dir', 'local-link']);
  } finally {
    fs.rmSync(real.root, { recursive: true, force: true });
  }
});

test('--clone-plugins none keeps only first-party deps, and --clone-drop-local drops local refs', () => {
  const real = makeRealHome('web');
  try {
    const none = planClone({ realHome: real.root, kind: 'web', plugins: 'none' });
    assert.deepEqual(Object.keys(none.dependencies), ['@deepseek-ai/dsh-base']);
    assert.deepEqual(none.bundles, ['@deepseek-ai/dsh-base']);
    assert.equal(none.excluded.every((entry) => entry.reason === 'clone-plugins-none'), true);

    const dropped = planClone({ realHome: real.root, kind: 'web', dropLocal: true });
    assert.deepEqual(Object.keys(dropped.dependencies).sort(), ['@deepseek-ai/dsh-base', 'dsh-x']);
    assert.deepEqual(dropped.droppedLocal.map((entry) => entry.name).sort(), ['local-dir', 'local-link']);
  } finally {
    fs.rmSync(real.root, { recursive: true, force: true });
  }
});

test('a clone refuses an existing target and a target inside the real home', () => {
  const real = makeRealHome('web');
  const target = makeTarget();
  try {
    assert.throws(
      () => cloneProfileInto({ realHome: real.root, kind: 'web', profileDir: path.join(real.root, 'profiles', 'clone') }),
      /must not be inside the real home/,
    );
    cloneProfileInto({ realHome: real.root, kind: 'web', profileDir: target.profileDir });
    assert.throws(
      () => cloneProfileInto({ realHome: real.root, kind: 'web', profileDir: target.profileDir }),
      /already has a profile/,
    );
  } finally {
    fs.rmSync(real.root, { recursive: true, force: true });
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('diffCloneSource detects a changed real structural file', () => {
  const real = makeRealHome('web');
  try {
    const before = snapshotCloneSource(real.root, 'web');
    fs.appendFileSync(path.join(real.dir, 'cordis.yml'), 'changed\n', 'utf8');
    const after = snapshotCloneSource(real.root, 'web');
    const diff = diffCloneSource(before, after);
    assert.equal(diff.ok, false);
    assert.equal(diff.changed.some((item) => item.file === 'cordis.yml'), true);
  } finally {
    fs.rmSync(real.root, { recursive: true, force: true });
  }
});

test('parseIncompatiblePlugins dedupes the DSH compatibility-gate lines', () => {
  const text = [
    'dsh: installation rejected: Plugin dsh-better-sidebar@0.19.1 is incompatible with dsh 0.2.0-rc.2: peerDependencies {}',
    'Plugin dsh-better-sidebar@0.19.1 is incompatible with dsh 0.2.0-rc.2: peerDependencies {}',
    'Plugin @scope/x@1.0.0 is incompatible with dsh 0.2.0-rc.2: peerDependencies {}',
  ].join('\n');
  assert.deepEqual(parseIncompatiblePlugins(text), [
    { name: 'dsh-better-sidebar', version: '0.19.1' },
    { name: '@scope/x', version: '1.0.0' },
  ]);
  assert.deepEqual(parseIncompatiblePlugins(''), []);
});

test('rebuildClonedProfile runs the official pnpm install offline and reports missing plugins', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-rebuild-'));
  try {
    fs.writeFileSync(
      path.join(profileDir, 'package.json'),
      `${JSON.stringify({ name: 'p', dependencies: { 'dsh-a': '1.0.0', 'dsh-b': '2.0.0' } }, null, 2)}\n`,
      'utf8',
    );
    fs.mkdirSync(path.join(profileDir, 'node_modules', 'dsh-a'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'node_modules', 'dsh-a', 'package.json'), '{"name":"dsh-a","version":"1.0.0"}\n', 'utf8');
    const calls = [];
    const result = await rebuildClonedProfile({
      runtime: { cmd: 'dsh.cmd' },
      env: { DSH_HOME: 'x' },
      profileDir,
      profileName: 'lab-x',
      timeoutMs: 1000,
      runCommandImpl: async (file, args, options) => {
        calls.push({ file, args, options });
        return {
          code: 1,
          timedOut: false,
          durationMs: 5,
          stdout: 'Done in 1s using pnpm v11.7.0\n',
          stderr: 'Plugin dsh-b@2.0.0 is incompatible with dsh 0.2.0-rc.2: peerDependencies {}\ndsh: installation rejected: Plugin dsh-b@2.0.0 is incompatible\n',
        };
      },
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(0, 3), ['plugin', '--profile', 'lab-x']);
    assert.equal(calls[0].args.includes('install'), true);
    assert.equal(calls[0].args.includes('--offline'), true);
    assert.equal(calls[0].args.includes('--no-frozen-lockfile'), true);
    assert.equal(result.ok, false);
    assert.equal(result.code, 1);
    assert.deepEqual(result.installed, ['dsh-a']);
    assert.deepEqual(result.missing, ['dsh-b']);
    assert.equal(result.rejected, true);
    assert.deepEqual(result.incompatible, [{ name: 'dsh-b', version: '2.0.0' }]);
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test('grantClonedProfileExemptions runs allow-version --accept-risk in the clone only', async () => {
  const calls = [];
  const result = await grantClonedProfileExemptions({
    runtime: { cmd: 'dsh.cmd' },
    env: { DSH_HOME: 'C:/clone/home' },
    profileDir: 'C:/clone/home/profiles/lab-clone-web',
    profileName: 'lab-clone-web',
    runtimeVersion: '0.2.0-rc.2',
    incompatible: [
      { name: 'dsh-better-sidebar', version: '0.19.1' },
      { name: '@scope/x', version: '1.0.0' },
    ],
    timeoutMs: 1000,
    runCommandImpl: async (file, args, options) => {
      calls.push({ file, args, options });
      return { code: 0, stdout: 'dsh: allowed', stderr: '' };
    },
  });
  assert.deepEqual(result.granted.map((plugin) => `${plugin.name}@${plugin.version}`), [
    'dsh-better-sidebar@0.19.1',
    '@scope/x@1.0.0',
  ]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(calls[0].args, [
    'plugin', '--profile', 'lab-clone-web',
    'allow-version', 'dsh-better-sidebar@0.19.1',
    '--dsh-version', '0.2.0-rc.2', '--accept-risk',
  ]);
  assert.equal(calls[0].options.cwd, 'C:/clone/home/profiles/lab-clone-web');
  assert.equal(calls.length, 2);
});

test('rebuildClonedProfile uses the network only when online:true', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-rebuild-online-'));
  try {
    fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify({ name: 'p', dependencies: {} })}\n`, 'utf8');
    const calls = [];
    await rebuildClonedProfile({
      runtime: { cmd: 'dsh.cmd' },
      env: {},
      profileDir,
      profileName: 'lab-x',
      timeoutMs: 1000,
      online: true,
      runCommandImpl: async (file, args) => {
        calls.push(args);
        return { code: 0, timedOut: false, durationMs: 1, stdout: '', stderr: '' };
      },
    });
    assert.equal(calls[0].includes('--offline'), false);
    assert.equal(calls[0].includes('--no-frozen-lockfile'), true);
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test('grantClonedProfileExemptions reports per-plugin failures', async () => {
  const result = await grantClonedProfileExemptions({
    runtime: { cmd: 'dsh.cmd' },
    env: {},
    profileDir: 'C:/clone',
    profileName: 'lab-clone',
    runtimeVersion: '0.2.0-rc.2',
    incompatible: [{ name: 'dsh-x', version: '1.0.0' }, { name: 'dsh-y' }],
    timeoutMs: 1000,
    runCommandImpl: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
  });
  assert.equal(result.granted.length, 0);
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[0].reason, /exit 1: boom/);
  assert.match(result.failures[1].reason, /incomplete/);
});

test('rewriteLockfileLocalPaths makes profile-relative file:/link: resolutions absolute', () => {
  const sourceDir = 'C:/Users/someone/.dsh/profiles/desktop';
  const text = [
    'lockfileVersion: 9',
    'version: file:../../plugins/dsh-desktop-restart',
    'version: link:../../../Desktop/新建文件夹 (2)/bridge-plugin',
    'resolution: {directory: ../../plugins/dsh-desktop-restart, type: directory}',
    'resolution: {tarball: file:../../plugins/dsh-whale-widget-1.0.0.tgz}',
    'version: 1.2.3',
  ].join('\n');
  const out = rewriteLockfileLocalPaths(text, sourceDir, {
    'dsh-desktop-restart': 'file:C:/Users/someone/.dsh/plugins/dsh-desktop-restart',
    'dsh-plugin-effect-lab-bridge': 'link:C:/Users/someone/Desktop/新建文件夹 (2)/bridge-plugin',
    'dsh-whale-widget': 'file:C:/Users/someone/.dsh/plugins/dsh-whale-widget-1.0.0.tgz',
    'registry-dep': '^1.2.3',
  });
  assert.match(out, /version: file:C:\/Users\/someone\/\.dsh\/plugins\/dsh-desktop-restart/);
  assert.match(out, /directory: C:\/Users\/someone\/\.dsh\/plugins\/dsh-desktop-restart/);
  assert.match(out, /link:C:\/Users\/someone\/Desktop\/新建文件夹 \(2\)\/bridge-plugin/);
  assert.match(out, /tarball: file:C:\/Users\/someone\/\.dsh\/plugins\/dsh-whale-widget-1\.0\.0\.tgz/);
  assert.match(out, /version: 1\.2\.3/);
  assert.equal(out.includes('file:../../plugins/'), false);
});
