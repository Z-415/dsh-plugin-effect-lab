import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('disposeIsolatedHome unlinks a junction instead of deleting its target', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-outside-'));
  fs.writeFileSync(path.join(outside, 'source.js'), 'do not delete me', 'utf8');
  const iso = createIsolatedHome({ withAgents: true });
  const link = path.join(iso.root, 'linked-plugin-source');
  try {
    // pnpm links a local directory dependency with a junction on Windows.
    fs.symlinkSync(outside, link, 'junction');
    const result = await iso.dispose();
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(iso.root), false);
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(path.join(outside, 'source.js')), true, 'the link target must survive');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(iso.root, { recursive: true, force: true });
  }
});
