import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORTED_RUNTIME_RANGE,
  VERIFIED_RUNTIME_VERSIONS,
  classifyRuntimeVersion,
  isInformationalRuntime,
} from '../../src/runtime-versions.js';

test('the verified set and the supported range are explicit', () => {
  assert.deepEqual(VERIFIED_RUNTIME_VERSIONS, ['0.2.0-rc.2']);
  assert.equal(SUPPORTED_RUNTIME_RANGE, '>=0.2.0-rc.1 <0.3.0');
});

test('classifyRuntimeVersion separates verified, untested, unsupported, and unknown', () => {
  const verified = classifyRuntimeVersion('0.2.0-rc.2');
  assert.equal(verified.status, 'verified');
  assert.equal(verified.verified, true);
  assert.equal(verified.supported, true);
  assert.equal(isInformationalRuntime(verified), false);

  const untested = classifyRuntimeVersion('0.2.1');
  assert.equal(untested.status, 'untested');
  assert.equal(untested.supported, true, 'a newer 0.2.x must not fail the run');
  assert.equal(untested.verified, false);
  assert.equal(isInformationalRuntime(untested), true);
  assert.match(untested.detail, /not in the verified set/);

  const unsupported = classifyRuntimeVersion('0.3.0');
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.supported, false);
  assert.equal(isInformationalRuntime(unsupported), false);
  assert.match(unsupported.detail, /outside the supported range/);

  const unknown = classifyRuntimeVersion('not-a-version');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.supported, true, 'an unparseable version must not block a run');
  assert.equal(isInformationalRuntime(unknown), true);
  assert.equal(classifyRuntimeVersion(null).status, 'unknown');
  assert.equal(classifyRuntimeVersion('').status, 'unknown');
});

test('classifyRuntimeVersion accepts an overridden verified set', () => {
  const result = classifyRuntimeVersion('0.2.5', { verifiedVersions: ['0.2.5'] });
  assert.equal(result.status, 'verified');
  assert.equal(result.verified, true);
});
