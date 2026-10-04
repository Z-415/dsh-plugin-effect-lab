import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import test from 'node:test';
import { resolvePlugin, readTarballManifest } from '../../src/plugin-resolver.js';
import { seederPluginDir } from '../../src/fixture-manager.js';

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write('00000000000\0', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  return header;
}

function makeTgz(manifest) {
  const content = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  const tar = Buffer.concat([tarHeader('package/package.json', content.length), content, padding, Buffer.alloc(1024)]);
  return zlib.gzipSync(tar);
}

test('resolvePlugin reads a local directory manifest', () => {
  const resolved = resolvePlugin(seederPluginDir());
  assert.equal(resolved.kind, 'directory');
  assert.equal(resolved.name, 'dsh-lab-session-fixture');
});

test('readTarballManifest extracts package.json from a tgz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-unit-'));
  try {
    const file = path.join(dir, 'plugin.tgz');
    fs.writeFileSync(file, makeTgz({ name: 'tarball-plugin', version: '1.2.3' }));
    const manifest = readTarballManifest(file);
    assert.equal(manifest.name, 'tarball-plugin');
    assert.equal(manifest.version, '1.2.3');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
