import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readArtifactFile, resolveInsideArtifacts } from '../lib/artifacts-store.js';
import { createBridgeRouteHandler, loopbackOrigin, tokensMatch } from '../lib/routes.js';
import { BridgeBusyError } from '../lib/verify-controller.js';

function createArtifacts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-routes-'));
  const runDir = path.join(root, 'run-1');
  fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'report.html'), '<!doctype html><title>report</title>', 'utf8');
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({
    ok: true,
    runId: 'run-1',
    checks: [{ name: 'runtime-located', pass: true }],
    artifacts: { reportHtml: path.join(runDir, 'report.html') },
  }), 'utf8');
  fs.writeFileSync(path.join(runDir, 'screenshots', 'home.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(runDir, 'note.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>', 'utf8');
  fs.writeFileSync(path.join(runDir, 'payload.bin'), Buffer.from([1, 2, 3, 4]));
  return { root, runDir };
}

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
      end(body) { resolve({ status: this.statusCode, headers: this.headers, body: body ?? Buffer.alloc(0) }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
    if (options.body !== undefined) {
      queueMicrotask(() => {
        req.emit('data', Buffer.from(options.body));
        req.emit('end');
      });
    }
  });
}

function fakeJob(extra = {}) {
  return {
    id: 'job-1',
    status: 'running',
    plugin: 'p',
    online: false,
    startedAt: 1,
    finishedAt: null,
    summary: null,
    error: null,
    ...extra,
  };
}

function makeController(overrides = {}) {
  const calls = [];
  return {
    calls,
    start(input) {
      calls.push(['start', input]);
      if (overrides.busy) throw new BridgeBusyError('busy');
      return fakeJob({ plugin: input.plugin, online: input.online });
    },
    status() { return overrides.statusJob ?? fakeJob({ status: 'done', finishedAt: 2 }); },
    cancel() { calls.push(['cancel']); return fakeJob({ status: 'cancelled', finishedAt: 2 }); },
  };
}

function controlHandler(root, controller, token = 'tok-123') {
  return createBridgeRouteHandler({
    getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }),
    controller,
    getToken: () => token,
  });
}

test('tokensMatch rejects missing, wrong, and length-mismatched tokens', () => {
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('abc', 'abcd'), false);
  assert.equal(tokensMatch(null, 'abc'), false);
  assert.equal(tokensMatch('abc', null), false);
});

test('loopbackOrigin accepts only loopback Host headers', () => {
  assert.equal(loopbackOrigin({ headers: { host: '127.0.0.1:19387' } }), 'http://127.0.0.1:19387');
  assert.equal(loopbackOrigin({ headers: { host: 'localhost:8080' } }), 'http://localhost:8080');
  assert.equal(loopbackOrigin({ headers: { host: '[::1]:8080' } }), 'http://[::1]:8080');
  assert.equal(loopbackOrigin({ headers: { host: '192.168.1.5:19387' } }), null);
  assert.equal(loopbackOrigin({ headers: { host: 'evil.example.com' } }), null);
  assert.equal(loopbackOrigin({ headers: {} }), null);
});

test('serves the latest report html from the artifacts root', async () => {
  const { root } = createArtifacts();
  try {
    const handler = createBridgeRouteHandler({ getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }) });
    const res = await invoke(handler, '/dsh-lab-bridge/latest/report.html');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(String(res.body), /<title>report<\/title>/);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('svg artifacts are served with a CSP and nosniff', async () => {
  const { root } = createArtifacts();
  try {
    const handler = createBridgeRouteHandler({ getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }) });
    const res = await invoke(handler, '/dsh-lab-bridge/latest/note.svg');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/svg+xml');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /script-src 'none'/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an artifact outside the MIME whitelist is refused', async () => {
  const { root } = createArtifacts();
  try {
    const handler = createBridgeRouteHandler({ getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }) });
    const res = await invoke(handler, '/dsh-lab-bridge/latest/payload.bin');
    assert.equal(res.status, 415);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('latest.json returns hasReport and the summarized verdict', async () => {
  const { root } = createArtifacts();
  try {
    const handler = createBridgeRouteHandler({ getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }) });
    const res = await invoke(handler, '/dsh-lab-bridge/latest.json', 'GET', { host: '127.0.0.1:19387' });
    assert.equal(res.status, 200);
    const payload = JSON.parse(String(res.body));
    assert.equal(payload.hasReport, true);
    assert.equal(payload.ok, true);
    assert.equal(payload.runId, 'run-1');
    assert.equal(payload.loopbackReportUrl, 'http://127.0.0.1:19387/dsh-lab-bridge/latest/report.html');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('without a report the html route still answers 200 with a placeholder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-empty-'));
  try {
    const handler = createBridgeRouteHandler({ getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }) });
    const res = await invoke(handler, '/dsh-lab-bridge/latest/report.html');
    assert.equal(res.status, 200);
    assert.match(String(res.body), /还没有实验舱报告/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('path traversal is rejected', async () => {
  const { root } = createArtifacts();
  try {
    assert.equal(resolveInsideArtifacts(root, path.join('run-1', '..', '..', 'outside.txt')), null);
    assert.equal(readArtifactFile(root, path.join('..', 'outside.txt')), null);
    const handler = createBridgeRouteHandler({ getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }) });
    const res = await invoke(handler, '/dsh-lab-bridge/latest/..%2f..%2fpackage.json');
    assert.equal(res.status, 404);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('non-GET methods are rejected', async () => {
  const { root } = createArtifacts();
  try {
    const handler = createBridgeRouteHandler({ getConfig: () => ({ artifactsDir: root, routePrefix: '/dsh-lab-bridge' }) });
    const res = await invoke(handler, '/dsh-lab-bridge/latest.json', 'POST');
    assert.equal(res.status, 405);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a config error surfaces as JSON 500 instead of crashing', async () => {
  const handler = createBridgeRouteHandler({ getConfig: () => { throw new Error('未配置实验舱路径'); } });
  const res = await invoke(handler, '/dsh-lab-bridge/latest.json');
  assert.equal(res.status, 500);
  assert.match(String(res.body), /未配置实验舱路径/);
});

test('the control route rejects a missing token without starting a job', async () => {
  const { root } = createArtifacts();
  const controller = makeController();
  try {
    const res = await invoke(
      controlHandler(root, controller),
      '/dsh-lab-bridge/verify',
      'POST',
      { host: '127.0.0.1:19387' },
      { body: JSON.stringify({ plugin: 'p' }) },
    );
    assert.equal(res.status, 401);
    assert.equal(controller.calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the control route rejects a non-loopback peer even with the token', async () => {
  const { root } = createArtifacts();
  const controller = makeController();
  try {
    const res = await invoke(
      controlHandler(root, controller),
      '/dsh-lab-bridge/verify',
      'POST',
      { host: '127.0.0.1:19387', 'x-dsh-lab-token': 'tok-123' },
      { body: JSON.stringify({ plugin: 'p' }), remoteAddress: '10.0.0.5' },
    );
    assert.equal(res.status, 403);
    assert.equal(controller.calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an authorized loopback start returns 202 and runs the controller', async () => {
  const { root } = createArtifacts();
  const controller = makeController();
  try {
    const res = await invoke(
      controlHandler(root, controller),
      '/dsh-lab-bridge/verify',
      'POST',
      { host: '127.0.0.1:19387', 'x-dsh-lab-token': 'tok-123' },
      { body: JSON.stringify({ plugin: 'C:/plugins/demo', online: true }) },
    );
    assert.equal(res.status, 202);
    const payload = JSON.parse(String(res.body));
    assert.equal(payload.job.status, 'running');
    assert.deepEqual(controller.calls, [['start', { plugin: 'C:/plugins/demo', online: true, profileLab: null }]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a busy controller returns 409', async () => {
  const { root } = createArtifacts();
  const controller = makeController({ busy: true });
  try {
    const res = await invoke(
      controlHandler(root, controller),
      '/dsh-lab-bridge/verify',
      'POST',
      { host: '127.0.0.1:19387', 'x-dsh-lab-token': 'tok-123' },
      { body: JSON.stringify({ plugin: 'p' }) },
    );
    assert.equal(res.status, 409);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('status and cancel require the token and project the job', async () => {
  const { root } = createArtifacts();
  const controller = makeController();
  try {
    const unauthorized = await invoke(controlHandler(root, controller), '/dsh-lab-bridge/verify/status');
    assert.equal(unauthorized.status, 401);

    const status = await invoke(
      controlHandler(root, controller),
      '/dsh-lab-bridge/verify/status',
      'GET',
      { host: '127.0.0.1:19387', 'x-dsh-lab-token': 'tok-123' },
    );
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(String(status.body)).job.status, 'done');

    const cancel = await invoke(
      controlHandler(root, controller),
      '/dsh-lab-bridge/verify/cancel',
      'POST',
      { host: '127.0.0.1:19387', 'x-dsh-lab-token': 'tok-123' },
    );
    assert.equal(cancel.status, 200);
    assert.equal(JSON.parse(String(cancel.body)).job.status, 'cancelled');
    assert.deepEqual(controller.calls, [['cancel']]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read routes are loopback-only too', async () => {
  const { root } = createArtifacts();
  try {
    const handler = controlHandler(root, makeController());
    const res = await invoke(handler, '/dsh-lab-bridge/latest.json', 'GET', { host: '127.0.0.1:1' }, { remoteAddress: '192.168.0.9' });
    assert.equal(res.status, 403);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the shell entry requires the control token and launches through the loopback gate', async () => {
  const calls = [];
  const handler = createBridgeRouteHandler({
    getConfig: () => ({ artifactsDir: 'a', routePrefix: '/dsh-lab-bridge' }),
    getToken: () => 'tok-123',
    shellLauncher: async (input) => {
      calls.push(input);
      return { pid: 4242, args: ['lab.js', 'shell'] };
    },
  });
  const noToken = await invoke(
    handler,
    '/dsh-lab-bridge/shell',
    'POST',
    { host: '127.0.0.1:19387' },
    { body: JSON.stringify({ plugin: 'p' }) },
  );
  assert.equal(noToken.status, 401);
  assert.equal(calls.length, 0);

  const launched = await invoke(
    handler,
    '/dsh-lab-bridge/shell',
    'POST',
    { host: '127.0.0.1:19387', 'x-dsh-lab-token': 'tok-123' },
    { body: JSON.stringify({ plugin: 'p', online: true, holdMs: 20000 }) },
  );
  assert.equal(launched.status, 202);
  assert.deepEqual(calls, [{ plugin: 'p', online: true, profileLab: null, holdMs: 20000 }]);
  assert.equal(JSON.parse(String(launched.body)).launched.pid, 4242);
});

test('the shell entry rejects a non-loopback peer and a missing launcher', async () => {
  const noLauncher = createBridgeRouteHandler({
    getConfig: () => ({ artifactsDir: 'a', routePrefix: '/dsh-lab-bridge' }),
    getToken: () => 'tok-123',
  });
  const denied = await invoke(
    noLauncher,
    '/dsh-lab-bridge/shell',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
    { body: JSON.stringify({ plugin: 'p' }), remoteAddress: '10.0.0.9' },
  );
  assert.equal(denied.status, 403);

  const missing = await invoke(
    noLauncher,
    '/dsh-lab-bridge/shell',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
    { body: JSON.stringify({ plugin: 'p' }) },
  );
  assert.equal(missing.status, 503);
});

test('the profile list requires the token and returns persistent profiles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-routes-profiles-'));
  const dev = path.join(root, 'dev');
  fs.mkdirSync(dev, { recursive: true });
  fs.writeFileSync(path.join(dev, 'lab-profile.json'), JSON.stringify({
    name: 'dev',
    plugins: [{ spec: 'alpha' }],
  }), 'utf8');
  try {
    const handler = createBridgeRouteHandler({
      getConfig: () => ({ artifactsDir: 'a', routePrefix: '/dsh-lab-bridge', profilesRoot: root }),
      getToken: () => 'tok-123',
    });
    const noToken = await invoke(handler, '/dsh-lab-bridge/profiles');
    assert.equal(noToken.status, 401);

    const ok = await invoke(
      handler,
      '/dsh-lab-bridge/profiles',
      'GET',
      { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
    );
    assert.equal(ok.status, 200);
    const payload = JSON.parse(String(ok.body));
    assert.deepEqual(payload.profiles.map((profile) => profile.name), ['dev']);
    assert.deepEqual(payload.profiles[0].plugins, ['alpha']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verify accepts a selected profile and rejects unsafe names', async () => {
  const controller = makeController();
  const handler = createBridgeRouteHandler({
    getConfig: () => ({ artifactsDir: 'a', routePrefix: '/dsh-lab-bridge' }),
    controller,
    getToken: () => 'tok-123',
  });
  const ok = await invoke(
    handler,
    '/dsh-lab-bridge/verify',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
    { body: JSON.stringify({ plugin: 'p', profileLab: 'dev' }) },
  );
  assert.equal(ok.status, 202);
  assert.deepEqual(controller.calls, [['start', { plugin: 'p', online: false, profileLab: 'dev' }]]);

  const bad = await invoke(
    handler,
    '/dsh-lab-bridge/verify',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
    { body: JSON.stringify({ plugin: 'p', profileLab: 'desktop' }) },
  );
  assert.equal(bad.status, 400);
  assert.equal(controller.calls.length, 1);
});

test('the shell entry accepts a selected profile', async () => {
  const calls = [];
  const handler = createBridgeRouteHandler({
    getConfig: () => ({ artifactsDir: 'a', routePrefix: '/dsh-lab-bridge' }),
    getToken: () => 'tok-123',
    shellLauncher: async (input) => { calls.push(input); return { pid: 1 }; },
  });
  const ok = await invoke(
    handler,
    '/dsh-lab-bridge/shell',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
    { body: JSON.stringify({ plugin: 'p', profileLab: 'test1' }) },
  );
  assert.equal(ok.status, 202);
  assert.deepEqual(calls, [{ plugin: 'p', online: false, profileLab: 'test1' }]);
});

test('the launch route requires the token and starts the fixed launcher', async () => {
  const calls = [];
  const handler = createBridgeRouteHandler({
    getConfig: () => ({ artifactsDir: 'a', routePrefix: '/dsh-lab-bridge' }),
    getToken: () => 'tok-123',
    launcher: async () => {
      calls.push('launch');
      return { pid: 4242, args: ['lab.js', 'gui'] };
    },
  });
  const noToken = await invoke(handler, '/dsh-lab-bridge/launch', 'POST', { host: '127.0.0.1:1' });
  assert.equal(noToken.status, 401);
  assert.equal(calls.length, 0);

  const ok = await invoke(
    handler,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
  );
  assert.equal(ok.status, 202);
  assert.deepEqual(calls, ['launch']);
  assert.equal(JSON.parse(String(ok.body)).launched.pid, 4242);
});

test('the launch route maps throttle to 429 and rejects non-loopback', async () => {
  const throttled = createBridgeRouteHandler({
    getConfig: () => ({ artifactsDir: 'a', routePrefix: '/dsh-lab-bridge' }),
    getToken: () => 'tok-123',
    launcher: async () => {
      const error = new Error('busy');
      error.code = 'LAUNCH_THROTTLED';
      throw error;
    },
  });
  const busy = await invoke(
    throttled,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
  );
  assert.equal(busy.status, 429);

  const denied = await invoke(
    throttled,
    '/dsh-lab-bridge/launch',
    'POST',
    { host: '127.0.0.1:1', 'x-dsh-lab-token': 'tok-123' },
    { remoteAddress: '10.0.0.9' },
  );
  assert.equal(denied.status, 403);
});
