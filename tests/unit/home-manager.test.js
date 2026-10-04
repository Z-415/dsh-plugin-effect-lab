import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import { REAL_HOME } from '../../src/config.js';
import { assertSafeHome, createIsolatedHome } from '../../src/home-manager.js';

test('assertSafeHome rejects the real home and arbitrary paths', () => {
  assert.throws(() => assertSafeHome(REAL_HOME), /outside|prefix/i);
  assert.throws(() => assertSafeHome('C:\\Windows\\Temp\\not-a-lab'), /outside|prefix/i);
});

test('createIsolatedHome creates a short lab home under the OS temp root', async () => {
  const iso = createIsolatedHome();
  try {
    assert.match(iso.root, /dsh-lab-/);
    assert.equal(iso.root.toLowerCase().startsWith(os.tmpdir().toLowerCase()), true);
    assert.equal(fs.existsSync(iso.home), true);
    assert.equal(fs.existsSync(iso.agents), true);
  } finally {
    const result = await iso.dispose();
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(iso.root), false);
  }
});
