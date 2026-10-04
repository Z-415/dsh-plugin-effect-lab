import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { describeAgentCoverage, scanForCredentials } from '../../src/model-coverage.js';

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-creds-'));
}

test('scanForCredentials passes an isolated home with no credential material', () => {
  const home = makeHome();
  try {
    fs.mkdirSync(path.join(home, 'profiles', 'lab'), { recursive: true });
    fs.writeFileSync(path.join(home, 'profiles', 'lab', 'package.json'), '{}\n', 'utf8');
    const result = scanForCredentials(home);
    assert.equal(result.ok, true);
    assert.deepStrictEqual(result.files, []);
    assert.deepStrictEqual(result.keys, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('scanForCredentials flags a credential file', () => {
  const home = makeHome();
  try {
    fs.writeFileSync(path.join(home, '.credentials.yaml'), 'provider: x\n', 'utf8');
    const result = scanForCredentials(home);
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.files, ['.credentials.yaml']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('scanForCredentials flags an inline API key without echoing it', () => {
  const home = makeHome();
  try {
    fs.writeFileSync(path.join(home, 'settings.yaml'), 'apiKey: "sk-abcdefghijklmnop"\n', 'utf8');
    const result = scanForCredentials(home);
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.keys, [{ file: 'settings.yaml', kind: 'inline-key' }]);
    assert.equal(JSON.stringify(result).includes('sk-abcdefghijklmnop'), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('describeAgentCoverage marks the fixture-only and mock modes', () => {
  const fixture = describeAgentCoverage({ mockModel: false, credentials: { ok: true } });
  assert.equal(fixture.mode, 'fixture-only');
  assert.equal(fixture.realModelRequests, false);
  assert.equal(fixture.uncovered.includes('real provider credentials and sign-in'), true);

  const mock = describeAgentCoverage({ mockModel: true, credentials: { ok: true } });
  assert.equal(mock.mode, 'loopback-mock-model');
  assert.equal(mock.covered.some((item) => item.includes('loopback model turn')), true);
});
