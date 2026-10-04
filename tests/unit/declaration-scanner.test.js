import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectSlotRegistrations,
  collectToolNames,
  findDeclarationConflicts,
  scanPluginDeclarations,
} from '../../src/declaration-scanner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const oneDir = path.resolve(here, '..', '..', 'fixtures', 'plugins', 'dup-slot-one');
const twoDir = path.resolve(here, '..', '..', 'fixtures', 'plugins', 'dup-slot-two');

test('collectSlotRegistrations reads name, id, and order', () => {
  const source = `ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'lab-dup-decoration',
    order: 5,
  }, Decoration));`;
  assert.deepStrictEqual(collectSlotRegistrations(source, 'client.js'), [{
    file: 'client.js',
    name: 'conversation.composer.dock',
    id: 'lab-dup-decoration',
    order: 5,
    locale: null,
  }]);
});

test('collectToolNames reads a defineTool name', () => {
  const source = `ctx.effect(() => ctx.tools.register(defineTool({
    name: 'lab_dup_tool',
    description: 'x',
    parameters: {},
  })));`;
  assert.deepStrictEqual(collectToolNames(source, 'index.js'), [{ file: 'index.js', name: 'lab_dup_tool' }]);
});

test('the duplicate-slot fixtures declare distinct loaders and colliding slot/tool ids', () => {
  const one = scanPluginDeclarations(oneDir);
  const two = scanPluginDeclarations(twoDir);
  assert.deepStrictEqual(one.loaderIds.map((item) => item.id), ['dsh-lab-dup-slot-one']);
  assert.deepStrictEqual(two.loaderIds.map((item) => item.id), ['dsh-lab-dup-slot-two']);
  assert.deepStrictEqual(one.slotKeys, ['conversation.composer.dock']);
  assert.deepStrictEqual(two.slotKeys, ['conversation.composer.dock']);
  assert.equal(one.slotRegistrations[0].id, 'lab-dup-decoration');
  assert.equal(two.slotRegistrations[0].id, 'lab-dup-decoration');
  assert.deepStrictEqual(one.toolNames.map((item) => item.name), ['lab_dup_tool']);
  assert.deepStrictEqual(two.toolNames.map((item) => item.name), ['lab_dup_tool']);

  const findings = findDeclarationConflicts([one, two]);
  const byId = Object.fromEntries(findings.map((finding) => [finding.id, finding]));
  assert.equal(byId['duplicate-slot-registration-id'].severity, 'blocker');
  assert.equal(byId['duplicate-slot-registration-id'].namespace, 'slot-registration');
  assert.equal(byId['duplicate-tool-name'].severity, 'blocker');
  assert.equal(byId['duplicate-tool-name'].namespace, 'tool');
  assert.equal(byId['shared-slot-key'].severity, 'info');
  assert.equal(byId['shared-slot-key'].namespace, 'slot-key');
  assert.equal(byId['duplicate-loader-id'], undefined, 'fixtures must not collide in the loader namespace');
});

test('findDeclarationConflicts labels a loader-id duplicate in its own namespace', () => {
  const findings = findDeclarationConflicts([
    { name: 'a', loaderIds: [{ id: 'same-loader' }] },
    { name: 'b', loaderIds: [{ id: 'same-loader' }] },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'duplicate-loader-id');
  assert.equal(findings[0].namespace, 'loader');
  assert.deepStrictEqual(findings[0].owners, ['a', 'b']);
});
