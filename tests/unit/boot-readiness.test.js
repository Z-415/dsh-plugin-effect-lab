import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBootListening, bootReadiness } from '../../src/boot-readiness.js';

test('listening=false fails the boot-listening verdict with a readable detail', () => {
  const readiness = bootReadiness({ port: 43210, listening: false });
  assert.equal(readiness.urlPass, true);
  assert.equal(readiness.listeningPass, false);
  assert.match(readiness.listeningDetail, /never accepted a connection/);
  assert.throws(() => assertBootListening({ port: 43210, listening: false }), /boot-listening/);
});

test('listening=true passes the boot-listening verdict', () => {
  const readiness = bootReadiness({ port: 43210, listening: true });
  assert.equal(readiness.listeningPass, true);
  assert.match(readiness.listeningDetail, /accepting connections/);
  assert.doesNotThrow(() => assertBootListening({ port: 43210, listening: true }));
});

test('a missing or zero port fails the boot-url verdict', () => {
  assert.equal(bootReadiness({ port: 0, listening: false }).urlPass, false);
  assert.equal(bootReadiness({}).urlPass, false);
});
