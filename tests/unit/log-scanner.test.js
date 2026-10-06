import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UNKNOWN_CODE,
  hasFatal,
  linesAroundMatch,
  listSignatures,
  looksLikeFailure,
  scanLogs,
  scanSources,
  summarize,
  tailLines,
} from '../../src/log-scanner.js';

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
    assert.match(item.code, /^LAB-(BOOT|PLUGIN|CLIENT|PROFILE|ENV|RUNTIME|CRASH)-\d{3}$/, item.id);
    assert.equal(['fatal', 'warning'].includes(item.severity), true, item.id);
    assert.equal(typeof item.category, 'string');
    assert.equal(item.rootCause.length > 0, true, item.id);
    assert.equal(item.fix.length > 0, true, item.id);
  }
});

test('every signature carries a unique, stable error code', () => {
  const library = listSignatures();
  assert.equal(library.length, 22, 'the 22 documented signatures');
  const codes = library.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length, 'error codes must be unique');
  const byId = new Map(library.map((item) => [item.id, item.code]));
  assert.equal(byId.get('duplicate-loader-id'), 'LAB-PLUGIN-001');
  assert.equal(byId.get('fiber-pending'), 'LAB-BOOT-001');
  assert.equal(byId.get('port-in-use'), 'LAB-BOOT-002');
  assert.equal(byId.get('host-boot-timeout'), 'LAB-BOOT-003');
  assert.equal(byId.get('unknown-slot-kind'), 'LAB-CLIENT-002');
  assert.equal(byId.get('yaml-parse-error'), 'LAB-PROFILE-001');
  assert.equal(byId.get('electron-main-crash'), 'LAB-CRASH-001');
  assert.equal(byId.get('permission-denied'), 'LAB-ENV-002');
  assert.equal(byId.get('configforms-missing'), 'LAB-RUNTIME-002');
});

test('scan hits and summarize expose the error code', () => {
  const hits = scanLogs('Error: listen EADDRINUSE: address already in use 127.0.0.1:5566');
  assert.equal(hits[0].code, 'LAB-BOOT-002');
  assert.match(summarize(hits), /\[LAB-BOOT-002\] port-in-use/);
});

test('the unknown code is reserved for unmatched failures', () => {
  assert.equal(UNKNOWN_CODE, 'LAB-UNKNOWN');
  assert.equal(scanLogs('nothing here').length, 0);
});

test('summarize labels the category for each hit', () => {
  const text = summarize(scanLogs('Error: EADDRINUSE: address already in use 127.0.0.1:1'));
  assert.match(text, /BLOCKER/);
  assert.match(text, /\[LAB-BOOT-002\] port-in-use \(boot\)/);
});

test('scanSources merges boot logs and console errors without duplicates', () => {
  const hits = scanSources([
    'Error: EADDRINUSE: address already in use 127.0.0.1:5566',
    'Failed to fetch dynamically imported module: dsh-app://app/assets/client.js',
    // The same boot failure echoed on stderr must not be counted twice.
    'Error: EADDRINUSE: address already in use 127.0.0.1:5566',
    '',
    null,
  ]);
  assert.deepEqual(hits.map((hit) => hit.id), ['port-in-use', 'client-module-load']);
  assert.equal(hits.every((hit) => hit.severity === 'fatal'), true);
});

test('scanSources of a clean boot log and clean console returns nothing', () => {
  assert.deepEqual(scanSources(['[dsh] listening on port 5566', '[dsh] plugin tree loaded', undefined]), []);
});

test('tailLines returns the last non-empty lines, trimmed to a readable width', () => {
  const text = ['', 'first', '   ', 'second   ', 'third'].join('\n');
  assert.deepEqual(tailLines(text, 2), ['second', 'third']);
  assert.deepEqual(tailLines('', 5), []);
  assert.equal(tailLines('x'.repeat(500), 1)[0].length, 401, 'the line is cut at 400 chars plus an ellipsis');
});

test('linesAroundMatch returns the lines around a hit and nothing for a miss', () => {
  const text = ['one', 'two', 'boom: EADDRINUSE', 'three', 'four'].join('\n');
  assert.deepEqual(linesAroundMatch(text, 'EADDRINUSE', 1), ['two', 'boom: EADDRINUSE', 'three']);
  assert.deepEqual(linesAroundMatch(text, 'boom', 0), ['boom: EADDRINUSE']);
  assert.deepEqual(linesAroundMatch(text, 'not-there', 2), []);
  assert.deepEqual(linesAroundMatch(text, '', 2), []);
});

test('looksLikeFailure separates a clean log from an unknown failure', () => {
  assert.equal(looksLikeFailure('[dsh] booting\n[dsh] dsh web: http://127.0.0.1:1 (ready)'), false);
  assert.equal(looksLikeFailure(''), false);
  assert.equal(looksLikeFailure('  \n  '), false);
  assert.equal(looksLikeFailure('[dsh] SomethingWeirdError: widget foo exploded'), true);
  assert.equal(looksLikeFailure('process exited with code 3'), true);
  assert.equal(looksLikeFailure('ENOENT: no such file'), true);
});
