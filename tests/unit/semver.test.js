import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNpmSpec, rangeIncludesPrerelease, satisfies } from '../../src/semver.js';

test('satisfies accepts 0.2.0-rc.2 ranges used by real plugins', () => {
  assert.equal(satisfies('0.2.0-rc.2', '0.2.0-rc.2'), true);
  assert.equal(satisfies('0.2.0-rc.2', '^0.2.0-rc.1'), true);
  assert.equal(satisfies('0.2.0-rc.2', '>=0.1.7-alpha.2 <0.2.0'), false);
  assert.equal(satisfies('0.2.0-rc.2', '*'), true);
});

test('parseNpmSpec handles scoped and unscoped specs', () => {
  assert.deepEqual(parseNpmSpec('dsh-plugin-wallpaper-engine@1.2.0'), {
    name: 'dsh-plugin-wallpaper-engine',
    version: '1.2.0',
  });
  assert.deepEqual(parseNpmSpec('@scope/name@0.2.0-rc.2'), {
    name: '@scope/name',
    version: '0.2.0-rc.2',
  });
});

test('rangeIncludesPrerelease distinguishes prerelease-aware ranges', () => {
  assert.equal(rangeIncludesPrerelease('>=0.1.0-rc.6 <0.3.0-0'), true);
  assert.equal(rangeIncludesPrerelease('^0.2.0-rc.1'), true);
  assert.equal(rangeIncludesPrerelease('<0.2.0'), false);
  assert.equal(rangeIncludesPrerelease('^4.0.1'), false);
});

test('includePrerelease lets a prerelease version satisfy a prerelease-aware range', () => {
  const range = '>=0.1.0-rc.6 <0.3.0-0';
  // Strict semver rejects 0.2.0-rc.2 because no comparator names the 0.2.0 tuple.
  assert.equal(satisfies('0.2.0-rc.2', range), false);
  // The plugin-author intent is pre-0.3.0 support, which includes 0.2.0-rc.x.
  assert.equal(satisfies('0.2.0-rc.2', range, { includePrerelease: true }), true);
  // A plain upper bound must not be loosened into accepting a prerelease.
  assert.equal(satisfies('0.2.0-rc.2', '<0.2.0', { includePrerelease: true }), true);
  assert.equal(rangeIncludesPrerelease('<0.2.0'), false);
});
