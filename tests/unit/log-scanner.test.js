import assert from 'node:assert/strict';
import test from 'node:test';
import { hasFatal, listSignatures, scanLogs, summarize } from '../../src/log-scanner.js';

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

const CASES = [
  ['duplicate-loader-id', 'Error: duplicate loader entry id: dsh-vscode-bridge'],
  ['duplicate-tool', 'Error: tool "lab_dup_tool" is already registered'],
  ['keyed-slot-requires-key', 'keyed slot "conversation.composer.dock" requires options.key'],
  ['unknown-slot-kind', 'Error: unknown slot kind "we.panel"'],
  ['missing-module', 'Error: Cannot find module "dsh-plugin-x/client"'],
  ['plugin-tree-failed', 'plugin tree failed to load while applying entry dsh-lab-effect-probe'],
  ['unresolved-service', 'cannot resolve service "dsh.desktop.shell"'],
  ['engines-unsatisfied', 'Unsupported engine: wanted dsh >=0.3.0 but 0.2.0-rc.2 is installed'],
  ['yaml-parse-error', 'YAMLException: bad indentation of a mapping entry at line 3'],
  ['bundle-patch-missing', 'bundle patch not found: plugins/x/cordis.patch.yml'],
  ['bundle-dependency-mismatch', 'bundle "dsh-lab-x" has no matching dependency'],
  ['fiber-pending', 'fiber is still pending after 30000ms'],
  ['port-in-use', 'Error: listen EADDRINUSE: address already in use 127.0.0.1:5566'],
  ['host-boot-timeout', 'timed out waiting for dsh web after 90000ms'],
  ['electron-main-crash', 'A JavaScript error occurred in the main process'],
  ['client-module-load', 'Failed to fetch dynamically imported module: dsh-app://app/assets/client.js'],
  ['atomic-write-eperm', 'EPERM: operation not permitted, rename cordis.patch.yml'],
  ['permission-denied', 'Error: EACCES: permission denied, open settings.yaml'],
  ['path-too-long', 'Error: ENAMETOOLONG: name too long, open ...'],
  ['schemastery-volatile-missing', 'TypeError: field.volatile is not a function'],
  ['configforms-missing', 'TypeError: this.forms.configure is not a function'],
  ['peer-conflict', 'Conflicting peer dependencies: dsh-better-sidebar'],
];

for (const [id, line] of CASES) {
  test(`${id} matches its real log line`, () => {
    const hits = scanLogs(line);
    assert.deepEqual(hits.map((hit) => hit.id), [id], `expected only ${id} for: ${line}`);
    assert.equal(hits[0].severity, id === 'peer-conflict' ? 'warning' : 'fatal');
    assert.equal(typeof hits[0].category, 'string');
    assert.equal(hits[0].rootCause.length > 0, true);
    assert.equal(hits[0].fix.length > 0, true);
  });
}

test('a clean boot log does not trip any signature', () => {
  const clean = [
    '[dsh] initializing profile lab-test',
    '[dsh] registered service "dsh.workspace"',
    '[dsh] plugin tree loaded 3 entries',
    '[dsh] dsh web: http://127.0.0.1:5566/?token=abc (ready)',
    '[dsh] listening on port 5566',
  ].join('\n');
  assert.deepEqual(scanLogs(clean), []);
});

test('signature ids are unique and the library is browsable', () => {
  const library = listSignatures();
  assert.equal(library.length >= 20, true, 'the library should cover the documented failure modes');
  assert.equal(new Set(library.map((item) => item.id)).size, library.length, 'ids must be unique');
  for (const item of library) {
    assert.equal(typeof item.id, 'string');
    assert.equal(['fatal', 'warning'].includes(item.severity), true, item.id);
    assert.equal(typeof item.category, 'string');
    assert.equal(item.rootCause.length > 0, true, item.id);
    assert.equal(item.fix.length > 0, true, item.id);
  }
});

test('summarize labels the category for each hit', () => {
  const text = summarize(scanLogs('Error: EADDRINUSE: address already in use 127.0.0.1:1'));
  assert.match(text, /BLOCKER/);
  assert.match(text, /\[port-in-use\] \(boot\)/);
});
