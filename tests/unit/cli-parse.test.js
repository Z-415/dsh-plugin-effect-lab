import assert from 'node:assert/strict';
import test from 'node:test';
import { browserRunners, main, parseArgv } from '../../src/cli.js';

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
