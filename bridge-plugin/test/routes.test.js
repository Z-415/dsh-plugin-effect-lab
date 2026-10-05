import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createBridgeRouteHandler, isLoopbackRequest, tokensMatch } from '../lib/routes.js';

function invoke(handler, url, method = 'GET', headers = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.socket = { remoteAddress: options.remoteAddress ?? '127.0.0.1' };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { resolve({ status: this.statusCode, headers: this.headers, body }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function launchHandler(launcher) {
  return createBridgeRouteHandler({
    getConfig: () => ({ routePrefix: '/dsh-lab-bridge' }),
    getToken: () => 'nonce-123',
    launcher,
  });
}

test('tokensMatch rejects missing, wrong, and length-mismatched tokens', () => {
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('abc', 'abcd'), false);
  assert.equal(tokensMatch(null, 'abc'), false);
  assert.equal(tokensMatch('abc', null), false);
});

test('isLoopbackRequest accepts only loopback peers', () => {
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::1' } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: '10.0.0.9' } }), false);
  assert.equal(isLoopbackRequest({}), false);
});

test('POST /launch requires the nonce and starts the fixed launcher', async () => {
  const calls = [];
  const handler = launchHandler(async () => {
    calls.push('launch');
    return { pid: 4242, args: ['lab.js', 'gui'] };
  });
  const noToken = await invoke(handler, '/dsh-lab-bridge/launch', 'POST', { host: '127.0.0.1:1' });
  assert.equal(noToken.status, 401);
  assert.equal(calls.length, 0);

  const wrongToken = await invoke(
    handler,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'nope' },
  );
  assert.equal(wrongToken.status, 401);

  const ok = await invoke(
    handler,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'nonce-123' },
  );
  assert.equal(ok.status, 202);
  assert.deepEqual(calls, ['launch']);
  assert.equal(JSON.parse(String(ok.body)).launched.pid, 4242);
});

test('POST /launch rejects non-loopback peers even with the nonce', async () => {
  const handler = launchHandler(async () => ({ pid: 1 }));
  const denied = await invoke(
    handler,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'nonce-123' },
    { remoteAddress: '10.0.0.9' },
  );
  assert.equal(denied.status, 403);
});

test('POST /launch maps throttle to 429 and launcher errors to 500', async () => {
  const throttled = launchHandler(async () => {
    const error = new Error('busy');
    error.code = 'LAUNCH_THROTTLED';
    throw error;
  });
  const busy = await invoke(
    throttled,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'nonce-123' },
  );
  assert.equal(busy.status, 429);

  const failed = launchHandler(async () => { throw new Error('node missing'); });
  const error = await invoke(
    failed,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'nonce-123' },
  );
  assert.equal(error.status, 500);
  assert.match(String(error.body), /node missing/);
});

test('GET /launch is 405 and other paths are 404', async () => {
  const handler = launchHandler(async () => ({ pid: 1 }));
  const method = await invoke(handler, '/dsh-lab-bridge/launch', 'GET', { host: '127.0.0.1:1' });
  assert.equal(method.status, 405);
  const missing = await invoke(handler, '/dsh-lab-bridge/anything', 'GET', { host: '127.0.0.1:1' });
  assert.equal(missing.status, 404);
});

test('a missing launcher returns 503', async () => {
  const handler = createBridgeRouteHandler({
    getConfig: () => ({ routePrefix: '/dsh-lab-bridge' }),
    getToken: () => 'nonce-123',
  });
  const missing = await invoke(
    handler,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'nonce-123' },
  );
  assert.equal(missing.status, 503);
});
