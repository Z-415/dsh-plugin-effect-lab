import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_MODES,
  diffMagnitude,
  diffProbeSnapshots,
  formatDesktopBridges,
  isConnectionLost,
  normalizeProbe,
  resolveDesktopMode,
  summarizeProbe,
} from '../../src/electron-shell/shell-probe.js';

test('normalizeProbe sorts slots and derives counts', () => {
  const probe = normalizeProbe({ slots: ['b', 'a', 'a'], tokens: { '--dsw-x': '1' }, bodyAttributes: { style: 'x' } });
  assert.deepEqual(probe.slots, ['a', 'b']);
  assert.equal(probe.slotCount, 2);
  assert.equal(probe.tokenCount, 1);
  assert.deepEqual(probe.transport, { present: false, ownsHost: false, streamBaseUrl: null });
});

test('diffProbeSnapshots reports shell-only slots, tokens, and body attributes', () => {
  const web = {
    slots: ['root', 'sidebar'],
    slotCount: 2,
    tokens: { '--dsw-alias-bg-base': '#fff', '--dsw-shared': '1' },
    bodyAttributes: { style: '--dsh-content-font-size: 14px;' },
    htmlAttributes: { lang: 'en' },
    transport: { present: false, ownsHost: false, streamBaseUrl: null },
  };
  const shell = {
    slots: ['root', 'sidebar', 'shell.overlay'],
    slotCount: 3,
    tokens: { '--dsw-alias-bg-base': '#fff', '--dsw-shared': '2', '--dsw-desktop-only': 'yes' },
    bodyAttributes: { style: '--dsh-content-font-size: 14px;', 'data-dsh-platform': 'desktop' },
    htmlAttributes: { lang: 'en', 'data-dsh-shell': '1' },
    transport: { present: true, ownsHost: true, streamBaseUrl: 'http://127.0.0.1:1234' },
  };

  const diff = diffProbeSnapshots(web, shell);
  assert.deepEqual(diff.slots, { added: ['shell.overlay'], removed: [] });
  assert.deepEqual(diff.counts.slots, { web: 2, shell: 3 });
  assert.deepEqual(diff.tokens.changed['--dsw-shared'], { before: '1', after: '2' });
  assert.equal(diff.tokens.added['--dsw-desktop-only'], 'yes');
  assert.equal(diff.bodyAttributes.added['data-dsh-platform'], 'desktop');
  assert.deepEqual(diff.desktopOnly.bodyAttributes, ['data-dsh-platform']);
  assert.deepEqual(diff.desktopOnly.htmlAttributes, ['data-dsh-shell']);
  assert.deepEqual(diff.desktopOnly.tokens, ['--dsw-desktop-only']);
  assert.deepEqual(diff.desktopOnly.hintedBodyAttributes, ['data-dsh-platform']);
  assert.deepEqual(diff.transport.shell, { present: true, ownsHost: true, streamBaseUrl: 'http://127.0.0.1:1234' });
  // slots.added(1) + tokens.changed(1) + tokens.added(1) + bodyAttributes.added(1)
  assert.equal(diffMagnitude(diff), 4);
});

test('summarizeProbe exposes the values the CLI prints', () => {
  const summary = summarizeProbe({
    slots: ['root'],
    tokens: { '--dsw-alias-bg-base': '#fff' },
    bodyAttributes: { style: 'x' },
    themeRoot: { tag: 'body' },
    transport: { present: true, ownsHost: true, streamBaseUrl: 'http://127.0.0.1:1' },
  });
  assert.equal(summary.slots, 1);
  assert.equal(summary.bgBase, '#fff');
  assert.equal(summary.themeRoot, 'body');
  assert.deepEqual(summary.bodyAttributeKeys, ['style']);
  assert.equal(summary.transport.ownsHost, true);
});

test('isConnectionLost matches only the stream trust-fence failure', () => {
  assert.equal(isConnectionLost('[connection] connection lost, retry #1'), true);
  assert.equal(isConnectionLost('[connection] generation listener threw'), false);
  assert.equal(isConnectionLost(undefined), false);
});

test('desktopOnly captures a changed body attribute value, not only added ones', () => {
  const diff = diffProbeSnapshots(
    { bodyAttributes: { 'data-we-adapter': 'browser' } },
    { bodyAttributes: { 'data-we-adapter': 'desktop-official' } },
  );
  assert.deepStrictEqual(diff.desktopOnly.bodyAttributes, ['data-we-adapter']);
  assert.deepStrictEqual(diff.desktopOnly.hintedBodyAttributes, ['data-we-adapter']);
  assert.equal(diff.bodyAttributes.changed['data-we-adapter'].after, 'desktop-official');
});

test('resolveDesktopMode defaults to the deterministic stub', () => {
  assert.deepEqual(DESKTOP_MODES, ['stub', 'native']);
  assert.deepEqual(resolveDesktopMode(undefined), { mode: 'stub', native: false, ok: true, reason: 'stub-default' });
  assert.deepEqual(resolveDesktopMode(false, { show: true }), { mode: 'stub', native: false, ok: true, reason: 'stub-default' });
});

test('resolveDesktopMode refuses native without a visible window', () => {
  const refused = resolveDesktopMode(true, { show: false });
  assert.equal(refused.mode, 'stub');
  assert.equal(refused.ok, false);
  assert.equal(refused.native, false);
  assert.equal(refused.reason, 'native-desktop-requires-show');
  assert.match(refused.detail, /--native-desktop needs --show or --keep-open/);
});

test('resolveDesktopMode enables native with a visible window', () => {
  assert.deepEqual(resolveDesktopMode('native', { show: true }), { mode: 'native', native: true, ok: true, reason: 'native-enabled' });
  assert.equal(resolveDesktopMode(true, { show: true }).native, true);
});

test('formatDesktopBridges reports both stub outcomes', () => {
  const text = formatDesktopBridges({
    bridge: {
      directoryPicker: { mode: 'stub', called: true, autoProbed: true },
      notification: { mode: 'stub', requested: 1, suppressed: true, shown: 0 },
    },
  });
  assert.match(text, /directoryPicker=stub \(called\)/);
  assert.match(text, /notifications=stub requested=1 suppressed/);
});

test('formatDesktopBridges marks a native run whose picker was not auto-probed', () => {
  const text = formatDesktopBridges({
    bridge: {
      directoryPicker: { mode: 'native', called: false, autoProbed: false },
      notification: { mode: 'native', requested: 1, suppressed: false, shown: 1, supported: true },
    },
  });
  assert.match(text, /directoryPicker=native \(not auto-probed: a native dialog would block the run\)/);
  assert.match(text, /notifications=native requested=1 shown=1/);
});

test('formatDesktopBridges tolerates a missing capability payload', () => {
  const text = formatDesktopBridges(null);
  assert.match(text, /directoryPicker=stub/);
  assert.match(text, /notifications=stub/);
});
