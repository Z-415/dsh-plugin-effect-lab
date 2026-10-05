import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { findNodeExecutable } from '../lib/node-locator.js';

test('findNodeExecutable prefers an explicit nodePath', () => {
  const configured = path.resolve('C:/tools/node.exe');
  const result = findNodeExecutable({ nodePath: 'C:/tools/node.exe', exists: (candidate) => candidate === configured });
  assert.equal(result, configured);
});

test('findNodeExecutable finds node on PATH', () => {
  const expected = path.join('C:/Program Files/nodejs', 'node.exe');
  const result = findNodeExecutable({
    env: { PATH: 'C:/first;C:/Program Files/nodejs' },
    platform: 'win32',
    exists: (candidate) => candidate === expected,
  });
  assert.equal(result, expected);
});

test('findNodeExecutable does not fall back to process.execPath', () => {
  assert.throws(
    () => findNodeExecutable({
      env: { PATH: 'C:/none' },
      platform: 'win32',
      // Even though process.execPath exists, it is not on PATH and must not be used.
      exists: (candidate) => candidate === process.execPath,
    }),
    /nodePath|PATH/,
  );
});

test('findNodeExecutable fails readably when Node is missing', () => {
  assert.throws(
    () => findNodeExecutable({ env: { PATH: 'C:/none' }, platform: 'win32', exists: () => false }),
    /nodePath|PATH/,
  );
});
