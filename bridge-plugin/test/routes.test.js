import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readArtifactFile, resolveInsideArtifacts } from '../lib/artifacts-store.js';
import { createBridgeRouteHandler } from '../lib/routes.js';

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

function invoke(handler, url, method = 'GET') {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { resolve({ status: this.statusCode, headers: this.headers, body: body ?? Buffer.concat(chunks) }); },
    };
    handler({ method, url }, res);
  });
}

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
    const res = await invoke(handler, '/dsh-lab-bridge/latest.json');
    assert.equal(res.status, 200);
    const payload = JSON.parse(String(res.body));
    assert.equal(payload.hasReport, true);
    assert.equal(payload.ok, true);
    assert.equal(payload.runId, 'run-1');
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
