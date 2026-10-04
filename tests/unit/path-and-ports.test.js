import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { assertShortLabRoot, createIsolatedHome, MAX_LAB_ROOT_LENGTH } from '../../src/home-manager.js';
import { canConnect, waitForPortFree, waitForPortListening } from '../../src/net-utils.js';

test('the isolated lab root stays far below the Windows path limit', async () => {
  const iso = createIsolatedHome({ withAgents: true });
  try {
    assert.equal(iso.root.length <= MAX_LAB_ROOT_LENGTH, true, `${iso.root} (${iso.root.length})`);
    assertShortLabRoot(iso.root);
    assert.equal(iso.home.startsWith(iso.root), true);
  } finally {
    await iso.dispose();
  }
});

test('assertShortLabRoot rejects a long root', () => {
  assert.throws(() => assertShortLabRoot(`C:\\${'a'.repeat(200)}`), /too long/);
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('two concurrent listeners get distinct ports and are tracked independently', async () => {
  const first = net.createServer();
  const second = net.createServer();
  const firstPort = await listen(first);
  const secondPort = await listen(second);
  try {
    assert.notEqual(firstPort, secondPort);
    assert.equal(await waitForPortListening(firstPort, 5000), true);
    assert.equal(await waitForPortListening(secondPort, 5000), true);

    await close(first);
    assert.equal(await waitForPortFree(firstPort, 8000), true);
    assert.equal(await canConnect(firstPort), false);
    assert.equal(await canConnect(secondPort), true);
  } finally {
    await close(first).catch(() => {});
    await close(second).catch(() => {});
  }
});
