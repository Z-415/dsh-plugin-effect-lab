import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertSafeProfileName, listProfiles, normalizeProfileLab } from '../lib/lab-profiles.js';

test('normalizeProfileLab defaults to a one-off profile and validates names', () => {
  assert.equal(normalizeProfileLab(''), null);
  assert.equal(normalizeProfileLab(undefined), null);
  assert.equal(normalizeProfileLab('dev'), 'dev');
  assert.equal(normalizeProfileLab('test1'), 'test1');
  assert.throws(() => normalizeProfileLab('desktop'), /desktop/);
  assert.throws(() => normalizeProfileLab('../evil'), /invalid/);
  assert.throws(() => normalizeProfileLab('UPPER'), /invalid/);
  assert.equal(assertSafeProfileName('dev'), 'dev');
});

test('listProfiles reads manifests, sorts names, and skips reserved/invalid dirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-profiles-list-'));
  try {
    const dev = path.join(root, 'dev');
    fs.mkdirSync(dev, { recursive: true });
    fs.writeFileSync(path.join(dev, 'lab-profile.json'), JSON.stringify({
      name: 'dev',
      createdAt: '2026-10-01T00:00:00.000Z',
      plugins: [{ spec: 'alpha@1.0.0' }, { spec: 'beta' }],
    }), 'utf8');
    fs.mkdirSync(path.join(root, 'test1'), { recursive: true });
    fs.mkdirSync(path.join(root, 'desktop'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Bad Name'), { recursive: true });

    const profiles = listProfiles(root);
    assert.deepEqual(profiles.map((profile) => profile.name), ['dev', 'test1']);
    assert.deepEqual(profiles[0].plugins, ['alpha@1.0.0', 'beta']);
    assert.deepEqual(profiles[1].plugins, []);
    assert.equal(profiles[0].createdAt, '2026-10-01T00:00:00.000Z');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listProfiles returns [] for a missing root', () => {
  assert.deepEqual(listProfiles(path.join(os.tmpdir(), 'dsh-lab-profiles-does-not-exist')), []);
});
