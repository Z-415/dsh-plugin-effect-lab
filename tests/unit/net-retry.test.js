import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { fetchWithRetry, isRetryableNetworkError } from '../../src/net-utils.js';
import { httpProbe, mintAuthCookie } from '../../src/port-and-token.js';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('isRetryableNetworkError only matches connection-level failures', () => {
  assert.equal(isRetryableNetworkError(new TypeError('fetch failed')), true);
  assert.equal(
    isRetryableNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })),
    true,
  );
  assert.equal(
    isRetryableNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { errors: [{ code: 'ECONNREFUSED' }] } })),
    true,
  );
  assert.equal(isRetryableNetworkError(new Error('HTTP 500')), false);
  assert.equal(isRetryableNetworkError(new DOMException('aborted due to timeout', 'TimeoutError')), false);
});

test('fetchWithRetry retries a connection failure and then succeeds', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError('fetch failed');
    return { status: 200 };
  };
  const response = await fetchWithRetry('http://127.0.0.1/', {}, { fetchImpl, retries: 3, delayMs: 1 });
  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
});

test('fetchWithRetry gives up after the retry budget and rethrows', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(() => fetchWithRetry('http://127.0.0.1/', {}, { fetchImpl, retries: 2, delayMs: 1 }), /fetch failed/);
  assert.equal(attempts, 3, 'one attempt plus two retries');
});

test('fetchWithRetry does not retry a timeout or a non-network error', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  await assert.rejects(() => fetchWithRetry('http://127.0.0.1/', {}, { fetchImpl, retries: 3, delayMs: 1 }));
  assert.equal(attempts, 1);
});

test('fetchWithRetry returns an HTTP error status without retrying', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return { status: 500 };
  };
  const response = await fetchWithRetry('http://127.0.0.1/', {}, { fetchImpl, retries: 3, delayMs: 1 });
  assert.equal(response.status, 500);
  assert.equal(attempts, 1);
});

test('mintAuthCookie retries a dropped connection and returns the cookie', async () => {
  let hits = 0;
  const server = http.createServer((request, response) => {
    hits += 1;
    if (hits === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(303, { 'set-cookie': 'dsh-auth-test=abc; Path=/' });
    response.end();
  });
  const port = await listen(server);
  try {
    const result = await mintAuthCookie(`http://127.0.0.1:${port}/?token=x`, { timeoutMs: 5000, retries: 2 });
    assert.equal(hits >= 2, true, `expected a retry, saw ${hits} request(s)`);
    assert.equal(result.status, 303);
    assert.match(result.cookie, /dsh-auth-test=abc/);
  } finally {
    await close(server);
  }
});

test('httpProbe retries a dropped connection and then reports the status', async () => {
  let hits = 0;
  const server = http.createServer((request, response) => {
    hits += 1;
    if (hits === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  const port = await listen(server);
  try {
    const probe = await httpProbe(`http://127.0.0.1:${port}/`, { timeoutMs: 5000, retries: 2 });
    assert.equal(probe.ok, true, JSON.stringify(probe));
    assert.equal(probe.status, 200);
    assert.equal(probe.body, 'ok');
    assert.equal(hits >= 2, true);
  } finally {
    await close(server);
  }
});
