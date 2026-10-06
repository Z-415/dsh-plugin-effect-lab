import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyInstallFailure,
  describePluginInstall,
  extractInstallKeyLines,
  formatInstallDetail,
  installFailureMessage,
  INSTALL_ERROR_CODES,
} from '../../src/plugin-install-diagnostics.js';

const NOT_FOUND_LOG = [
  '[ERR_PNPM_FETCH_404] GET https://registry.npmmirror.com/dsh-orb-cordis: Not Found - 404',
  '',
  'This error happened while installing a direct dependency of C:\\Temp\\dsh-lab-x\\home\\profiles\\lab-1',
  '',
  'dsh-orb-cordis is not in the npm registry, or you have no permission to fetch it.',
].join('\n');

const GITHUB_RETRY_LOG = [
  '[WARN] GET https://codeload.github.com/mini-yifan/dsh-orb-cordis/tar.gz/f540317 error (23). Will retry in 10 seconds. 2 retries left.',
  '[WARN] GET https://codeload.github.com/mini-yifan/dsh-orb-cordis/tar.gz/f540317 error (ECONNRESET). Will retry in 1 minute. 1 retries left.',
].join('\n');

test('a registry 404 becomes LAB-INSTALL-NOTFOUND with the real pnpm line', () => {
  const diagnosis = classifyInstallFailure({ code: 1, stdout: NOT_FOUND_LOG, stderr: '' });
  assert.equal(diagnosis.code, INSTALL_ERROR_CODES.NOTFOUND);
  assert.equal(diagnosis.category, 'notfound');
  assert.equal(diagnosis.timedOut, false);
  assert.match(diagnosis.keyLines[0], /ERR_PNPM_FETCH_404/);
  assert.match(diagnosis.keyLines[0], /dsh-orb-cordis/);
  const detail = formatInstallDetail(diagnosis, { code: 1 });
  assert.match(detail, /^exit 1; /);
  assert.match(detail, /ERR_PNPM_FETCH_404/);
  assert.match(detail, /dsh-orb-cordis/);
  const message = installFailureMessage(diagnosis, { code: 1 });
  assert.equal(message.split('\n').length, 1, 'the GUI banner only reads the first line');
  assert.match(message, /ERR_PNPM_FETCH_404/);
});

test('a codeload retry loop becomes LAB-INSTALL-NETWORK and flags the GitHub download', () => {
  const diagnosis = classifyInstallFailure({ code: 1, stdout: GITHUB_RETRY_LOG, stderr: '' });
  assert.equal(diagnosis.code, INSTALL_ERROR_CODES.NETWORK);
  assert.equal(diagnosis.category, 'network');
  assert.equal(diagnosis.githubDownload, true);
  assert.match(diagnosis.keyLines.join('\n'), /codeload\.github\.com/);
});

test('a timeout with an empty log is still LAB-INSTALL-NETWORK, not an empty report', () => {
  const diagnosis = classifyInstallFailure({ code: null, stdout: '', stderr: '', timedOut: true, durationMs: 120_000 });
  assert.equal(diagnosis.code, INSTALL_ERROR_CODES.NETWORK);
  assert.equal(diagnosis.timedOut, true);
  assert.deepEqual(diagnosis.keyLines, []);
  assert.equal(formatInstallDetail(diagnosis, { code: null, timedOut: true }), 'exit timeout (timeout)');
  assert.match(installFailureMessage(diagnosis, { code: null, timedOut: true, durationMs: 120_000 }), /timed out after 120000ms/);
});

test('an unrecognized failure is LAB-INSTALL-UNKNOWN', () => {
  const diagnosis = classifyInstallFailure({ code: 2, stdout: 'something went sideways', stderr: '' });
  assert.equal(diagnosis.code, INSTALL_ERROR_CODES.UNKNOWN);
  assert.equal(diagnosis.category, 'unknown');
  assert.match(installFailureMessage(diagnosis, { code: 2 }), /no pnpm error line captured/);
});

test('extractInstallKeyLines keeps log order, dedupes, and caps the count', () => {
  const text = [NOT_FOUND_LOG, NOT_FOUND_LOG, 'plain noise', GITHUB_RETRY_LOG].join('\n');
  const lines = extractInstallKeyLines(text, 3);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /ERR_PNPM_FETCH_404/);
  assert.match(lines[1], /codeload/);
  assert.equal(new Set(lines).size, lines.length);
});

test('describePluginInstall passes once the install stage is over', () => {
  const failure = classifyInstallFailure({ code: 1, stdout: NOT_FOUND_LOG, stderr: '' });
  assert.equal(describePluginInstall('install', { code: 1 }, failure).pass, false);
  assert.equal(describePluginInstall('postcheck', { code: 0 }, null).pass, true);
  assert.match(describePluginInstall('install', { code: 1 }, failure).detail, /ERR_PNPM_FETCH_404/);
});
