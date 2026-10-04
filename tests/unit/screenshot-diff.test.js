import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareScreenshots, pngStats } from '../../src/screenshot-diff.js';

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-shot-'));
}

/** pngStats only needs the signature and IHDR dimensions, not a full image. */
function fakePng(width, height, fill = 0) {
  const buffer = Buffer.alloc(32, fill);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('pngStats reports hash, size, and IHDR dimensions', () => {
  const dir = makeDir();
  try {
    const file = path.join(dir, 'a.png');
    fs.writeFileSync(file, fakePng(1440, 900));
    const stats = pngStats(file);
    assert.equal(stats.isPng, true);
    assert.equal(stats.width, 1440);
    assert.equal(stats.height, 900);
    assert.equal(stats.sha256.length, 64);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('identical screenshots short-circuit without launching a browser', async () => {
  const dir = makeDir();
  try {
    const before = path.join(dir, 'before.png');
    const after = path.join(dir, 'after.png');
    const bytes = fakePng(800, 600, 7);
    fs.writeFileSync(before, bytes);
    fs.writeFileSync(after, bytes);
    const diff = await compareScreenshots({ before, after });
    assert.equal(diff.identical, true);
    assert.equal(diff.dimensionsMatch, true);
    assert.equal(diff.pixels.changedRatio, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a dimension mismatch returns facts without a pixel diff', async () => {
  const dir = makeDir();
  try {
    const before = path.join(dir, 'before.png');
    const after = path.join(dir, 'after.png');
    fs.writeFileSync(before, fakePng(800, 600, 1));
    fs.writeFileSync(after, fakePng(640, 480, 1));
    const diff = await compareScreenshots({ before, after });
    assert.equal(diff.identical, false);
    assert.equal(diff.dimensionsMatch, false);
    assert.equal(diff.pixels, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-PNG input returns facts without a pixel diff', async () => {
  const dir = makeDir();
  try {
    const before = path.join(dir, 'before.png');
    const after = path.join(dir, 'after.png');
    fs.writeFileSync(before, Buffer.from('not a png at all'));
    fs.writeFileSync(after, Buffer.from('still not a png'));
    const diff = await compareScreenshots({ before, after });
    assert.equal(diff.before.isPng, false);
    assert.equal(diff.pixels, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
