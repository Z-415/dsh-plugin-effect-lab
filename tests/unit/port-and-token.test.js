import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyStatus, parseWebUrl } from '../../src/port-and-token.js';

test('parseWebUrl reads the official readiness line', () => {
  const parsed = parseWebUrl('noise\ndsh web: http://127.0.0.1:12387/?token=abc_DEF-123\n');
  assert.equal(parsed.port, 12387);
  assert.equal(parsed.token, 'abc_DEF-123');
  assert.equal(parsed.origin, 'http://127.0.0.1:12387');
});

test('parseWebUrl returns null without a readiness line', () => {
  assert.equal(parseWebUrl('starting dsh'), null);
});

test('classifyStatus separates auth fence from missing route', () => {
  assert.equal(classifyStatus(401), 'auth-fence');
  assert.equal(classifyStatus(204), 'ok');
  assert.equal(classifyStatus(404), 'missing');
  assert.equal(classifyStatus(500), 'server-error');
});
