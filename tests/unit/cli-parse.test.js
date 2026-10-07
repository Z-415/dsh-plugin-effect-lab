import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bridgeRunners, browserRunners, main, parseArgv, resolveCloneOptions } from '../../src/cli.js';
import { createLabProfile } from '../../src/lab-profile.js';

test('--assert-token accepts token names that themselves start with --', () => {
  const { flags } = parseArgv([
    'verify',
    '--assert-token', '--dsw-alias-bg-base',
    '--assert-token', '--we-glass-alpha',
    '--assert-token', '--lab-dup-slot',
  ]);
  assert.deepStrictEqual(flags['assert-token'], ['--dsw-alias-bg-base', '--we-glass-alpha', '--lab-dup-slot']);
});

test('--assert-token still rejects a following flag', () => {
  assert.throws(() => parseArgv(['verify', '--assert-token', '--plugin', 'pkg']), /needs a value/);
  assert.throws(() => parseArgv(['verify', '--assert-token', '--json']), /needs a value/);
});

test('boolean flags are not mistaken for values', () => {
  const { flags } = parseArgv(['shell', '--no-compare-web', '--json']);
  assert.equal(flags['no-compare-web'], true);
  assert.equal(flags.json, true);
});

test('repeatable plugin and with flags accumulate in order', () => {
  const { flags } = parseArgv(['verify', '--plugin', 'a', '--with', 'b', '--with', 'c']);
  assert.deepStrictEqual(flags.plugin, ['a']);
  assert.deepStrictEqual(flags.with, ['b', 'c']);
});

test('a --help after a subcommand prints help without starting a run', async () => {
  const code = await main(['verify', '--help']);
  assert.equal(code, 0);
});

test('dom assertion flags parse as repeatable values plus a number', () => {
  const { flags } = parseArgv([
    'verify',
    '--assert-slot', 'conversation.view',
    '--assert-slot', 'settings.section',
    '--assert-body-attr', 'data-we-wallpaper',
    '--min-slots', '24',
  ]);
  assert.deepStrictEqual(flags['assert-slot'], ['conversation.view', 'settings.section']);
  assert.deepStrictEqual(flags['assert-body-attr'], ['data-we-wallpaper']);
  assert.equal(flags['min-slots'], '24');
});

test('profile remove-plugin keeps the profile name and the plugin selectors positional', () => {
  const { command, flags } = parseArgv([
    'profile',
    'remove-plugin',
    'dev',
    'dsh-plugin-wallpaper-engine@1.2.0',
    'dsh-ui-tweaks',
  ]);
  assert.equal(command, 'profile');
  assert.deepStrictEqual(flags._, [
    'remove-plugin',
    'dev',
    'dsh-plugin-wallpaper-engine@1.2.0',
    'dsh-ui-tweaks',
  ]);
  assert.equal(flags.plugin, undefined, 'positional selectors do not need --plugin');
});

test('profile remove-plugin without a name fails without touching a runtime', async () => {
  const code = await main(['profile', 'remove-plugin']);
  assert.equal(code, 2);
});

test('capture and verify both forward --profile-lab to their runner', async () => {
  const original = { ...browserRunners };
  const seen = {};
  browserRunners.verify = async (options) => {
    seen.verify = options;
    return 0;
  };
  browserRunners.capture = async (options) => {
    seen.capture = options;
    return 0;
  };
  try {
    assert.equal(await main(['verify', '--profile-lab', 'dev', '--no-html']), 0);
    assert.equal(await main(['capture', '--profile-lab', 'dev', '--no-html']), 0);
  } finally {
    Object.assign(browserRunners, original);
  }
  assert.equal(seen.verify.profileLab, 'dev');
  assert.equal(seen.capture.profileLab, 'dev', 'capture must reuse the persistent profile like verify');
  assert.equal(seen.capture.html, false);
  assert.deepStrictEqual(seen.capture.plugins, []);
});

test('clone flags parse and forward into the verify runner', async () => {
  const original = { ...browserRunners };
  let seen = null;
  browserRunners.verify = async (options) => {
    seen = options;
    return 0;
  };
  try {
    assert.equal(
      await main([
        'verify',
        '--clone-profile', 'web',
        '--clone-plugins', 'none',
        '--clone-exclude', 'dsh-x',
        '--clone-exclude', 'dsh-y',
        '--clone-drop-local',
        '--no-html',
      ]),
      0,
    );
  } finally {
    Object.assign(browserRunners, original);
  }
  assert.equal(seen.cloneProfile, 'web');
  assert.equal(seen.clonePlugins, 'none');
  assert.deepStrictEqual(seen.cloneExclude, ['dsh-x', 'dsh-y']);
  assert.equal(seen.cloneDropLocal, true);
});

test('lab shell rejects --clone-profile with exit 2', async () => {
  assert.equal(await main(['shell', '--clone-profile', 'web']), 2);
});

test('--clone-profile needs a value', () => {
  assert.throws(() => parseArgv(['verify', '--clone-profile']), /needs a value/);
});

test('--diagnostics-bundle is forwarded to the verify runner', async () => {
  const original = { ...browserRunners };
  let seen = null;
  browserRunners.verify = async (options) => {
    seen = options;
    return 0;
  };
  try {
    assert.equal(await main(['verify', '--diagnostics-bundle', 'out/diag.json', '--no-html']), 0);
  } finally {
    Object.assign(browserRunners, original);
  }
  assert.equal(seen.diagnosticsBundle, 'out/diag.json');
});

test('lab shell rejects --diagnostics-bundle with exit 2', async () => {
  assert.equal(await main(['shell', '--diagnostics-bundle', 'x.json']), 2);
});

test('lab diagnose without a source fails with exit 2', async () => {
  assert.equal(await main(['diagnose']), 2);
});

test('--clone-to is sugar for --profile-lab + --clone-profile', () => {
  const resolved = resolveCloneOptions({ 'clone-to': 'clone-web', 'clone-profile': 'web' });
  assert.equal(resolved.error, undefined);
  assert.equal(resolved.profileLab, 'clone-web');
  assert.equal(resolved.cloneTo, 'clone-web');
  assert.equal(resolved.target, 'clone-web');
});

test('--clone-to needs --clone-profile and matching --profile-lab', () => {
  assert.match(resolveCloneOptions({ 'clone-to': 'x' }).error, /needs --clone-profile/);
  assert.match(
    resolveCloneOptions({ 'clone-to': 'x', 'clone-profile': 'web', 'profile-lab': 'y' }).error,
    /must name the same profile/,
  );
});

test('resolveCloneOptions refuses an existing target unless --force', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-cloneto-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = root;
  try {
    createLabProfile('clone-web');
    const refused = resolveCloneOptions({ 'clone-to': 'clone-web', 'clone-profile': 'web' });
    assert.equal(refused.refused, true);
    assert.match(refused.error, /already exists/);
    assert.match(refused.error, /--force/);
    const forced = resolveCloneOptions({ 'clone-to': 'clone-web', 'clone-profile': 'web', force: true });
    assert.equal(forced.error, undefined);
    assert.equal(forced.profileLab, 'clone-web');
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main forwards --clone-to and --force into the verify runner', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-cloneto-fwd-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = root;
  const original = { ...browserRunners };
  let seen = null;
  browserRunners.verify = async (options) => {
    seen = options;
    return 0;
  };
  try {
    assert.equal(
      await main(['verify', '--clone-to', 'clone-web', '--clone-profile', 'web', '--clone-plugins', 'none', '--force', '--no-html']),
      0,
    );
  } finally {
    Object.assign(browserRunners, original);
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(seen.profileLab, 'clone-web');
  assert.equal(seen.cloneTo, 'clone-web');
  assert.equal(seen.cloneProfile, 'web');
  assert.equal(seen.force, true);
});

test('main refuses an existing --clone-to target with exit 2', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-cloneto-refuse-'));
  const previous = process.env.DSH_LAB_PROFILES;
  process.env.DSH_LAB_PROFILES = root;
  try {
    createLabProfile('clone-web');
    assert.equal(await main(['verify', '--clone-to', 'clone-web', '--clone-profile', 'web']), 2);
  } finally {
    if (previous === undefined) delete process.env.DSH_LAB_PROFILES;
    else process.env.DSH_LAB_PROFILES = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lab shell rejects --clone-to', async () => {
  assert.equal(await main(['shell', '--clone-to', 'x', '--clone-profile', 'web']), 2);
});

test('lab bridge install parses and forwards every flag', async () => {
  const original = { ...bridgeRunners };
  let seen = null;
  bridgeRunners.run = async (options) => {
    seen = options;
    return 0;
  };
  try {
    assert.equal(
      await main([
        'bridge', 'install',
        '--profile', 'desktop',
        '--home', 'C:/tmp/.dsh',
        '--lab-path', 'D:/lab',
        '--runtime', 'D:/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd',
        '--online', '--dry-run', '--force', '--json',
      ]),
      0,
    );
  } finally {
    Object.assign(bridgeRunners, original);
  }
  assert.equal(seen.action, 'install');
  assert.equal(seen.profile, 'desktop');
  assert.equal(seen.home, 'C:/tmp/.dsh');
  assert.equal(seen.labPath, 'D:/lab');
  assert.equal(seen.online, true);
  assert.equal(seen.dryRun, true);
  assert.equal(seen.force, true);
  assert.equal(seen.json, true);
});

test('lab bridge defaults to status on the desktop profile', async () => {
  const original = { ...bridgeRunners };
  let seen = null;
  bridgeRunners.run = async (options) => {
    seen = options;
    return 0;
  };
  try {
    assert.equal(await main(['bridge']), 0);
  } finally {
    Object.assign(bridgeRunners, original);
  }
  assert.equal(seen.action, 'status');
  assert.equal(seen.profile, 'desktop');
  assert.equal(seen.dryRun, false);
});

test('an unknown bridge action is refused with exit 2', async () => {
  assert.equal(await main(['bridge', 'bogus']), 2);
});
