import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { APP_FILES, syncAppFiles } = require('../../src/gui/app-sync.cjs');

function tempPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-app-sync-'));
  const source = path.join(root, 'src');
  const app = path.join(root, 'app');
  fs.mkdirSync(source);
  fs.mkdirSync(app);
  return { root, source, app };
}

test('APP_FILES covers every file the launcher serves', () => {
  assert.deepEqual(APP_FILES, ['index.html', 'main.js', 'preload.js', 'app-sync.cjs', 'menu.cjs']);
});

test('syncAppFiles copies changed files and leaves identical ones alone', () => {
  const { root, source, app } = tempPair();
  try {
    fs.writeFileSync(path.join(source, 'a.txt'), 'new', 'utf8');
    fs.writeFileSync(path.join(app, 'a.txt'), 'old', 'utf8');
    fs.writeFileSync(path.join(source, 'b.txt'), 'same', 'utf8');
    fs.writeFileSync(path.join(app, 'b.txt'), 'same', 'utf8');
    fs.writeFileSync(path.join(source, 'c.txt'), 'fresh', 'utf8');

    const updated = syncAppFiles({ sourceDir: source, appDir: app, files: ['a.txt', 'b.txt', 'c.txt'] });

    assert.deepEqual(updated, ['a.txt', 'c.txt']);
    assert.equal(fs.readFileSync(path.join(app, 'a.txt'), 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(app, 'c.txt'), 'utf8'), 'fresh');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('syncAppFiles skips missing sources and missing directories without throwing', () => {
  const { root, source, app } = tempPair();
  try {
    const logs = [];
    assert.deepEqual(syncAppFiles({ sourceDir: source, appDir: app, files: ['nope.txt'], log: (line) => logs.push(line) }), []);
    assert.deepEqual(logs, []);
    assert.deepEqual(syncAppFiles({ sourceDir: path.join(root, 'missing'), appDir: app }), []);
    assert.deepEqual(syncAppFiles({ sourceDir: source, appDir: path.join(root, 'missing') }), []);
    assert.deepEqual(syncAppFiles({}), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('syncAppFiles logs a copy failure instead of throwing', () => {
  const { root, source, app } = tempPair();
  try {
    fs.writeFileSync(path.join(source, 'index.html'), 'new', 'utf8');
    // A directory in the target slot makes the copy fail deterministically.
    fs.mkdirSync(path.join(app, 'index.html'));
    const logs = [];
    const updated = syncAppFiles({ sourceDir: source, appDir: app, files: ['index.html'], log: (line) => logs.push(line) });
    assert.deepEqual(updated, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /could not refresh index\.html/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
