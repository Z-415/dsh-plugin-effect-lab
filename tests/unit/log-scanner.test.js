import assert from 'node:assert/strict';
import test from 'node:test';
import { hasFatal, scanLogs, summarize } from '../../src/log-scanner.js';

test('duplicate loader id is fatal', () => {
  const hits = scanLogs('Error: duplicate loader entry id: dsh-vscode-bridge');
  assert.equal(hits[0].id, 'duplicate-loader-id');
  assert.equal(hasFatal(hits), true);
});

test('peer conflict is a warning, not a blocker', () => {
  const hits = scanLogs('Conflicting peer dependencies: dsh-better-sidebar');
  assert.equal(hits[0].id, 'peer-conflict');
  assert.equal(hasFatal(hits), false);
  assert.match(summarize(hits), /WARNINGS/);
});

test('the Node fs.Stats deprecation is not a tracked failure', () => {
  assert.deepEqual(scanLogs('(node:1) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.'), []);
});
