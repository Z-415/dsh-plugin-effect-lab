import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForStableUi } from '../../src/browser-driver.js';

/**
 * A CDP client stub whose `Runtime.evaluate` returns a scripted slot count.
 * Once the script runs out it keeps returning the last value, like a real page
 * that has reached its terminal DOM.
 */
function scriptedClient(counts) {
  let index = 0;
  return {
    async send() {
      const value = counts[Math.min(index, counts.length - 1)];
      index += 1;
      return { result: { value } };
    },
  };
}

test('waitForStableUi ignores a transitional plateau below minSlots', async () => {
  // A mid-mount plateau that lasts longer than stableMs, then the real terminal
  // count. Without the minSlots floor this would freeze at 37.
  const counts = [...Array(20).fill(37), ...Array(10).fill(47)];
  const client = scriptedClient(counts);
  const result = await waitForStableUi(client, {
    minSlots: 47,
    stableMs: 20,
    intervalMs: 5,
    timeoutMs: 3000,
  });
  assert.equal(result.stable, true);
  assert.equal(result.slots, 47);
  assert.equal(result.minSlots, 47);
});

test('waitForStableUi raiseToPeak follows a growing page to its terminal count', async () => {
  const client = scriptedClient([40, 45, 47, 47, 47, 47, 47, 47, 47, 47]);
  const result = await waitForStableUi(client, {
    raiseToPeak: true,
    stableMs: 20,
    intervalMs: 5,
    timeoutMs: 3000,
  });
  assert.equal(result.stable, true);
  assert.equal(result.slots, 47);
});

test('waitForStableUi reports stable=false when minSlots is never reached', async () => {
  const client = scriptedClient([37, 37, 37, 37]);
  const result = await waitForStableUi(client, {
    minSlots: 47,
    stableMs: 20,
    intervalMs: 5,
    timeoutMs: 60,
  });
  assert.equal(result.stable, false);
  assert.equal(result.slots, 37);
});
