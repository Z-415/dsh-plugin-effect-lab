import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const preloadFile = path.resolve(here, '..', '..', 'src', 'electron-shell', 'preload.js');

function styleDeclaration(values) {
  return {
    getPropertyValue(name) {
      return values[name] ?? '';
    },
    [Symbol.iterator]() {
      return Object.keys(values)[Symbol.iterator]();
    },
  };
}

function makeRendererSandbox() {
  const tokenValues = {
    '--dsw-alias-bg-base': '#fff',
    '--dsw-alias-label-primary': '#0f1115',
    '--dsw-specific-sidebar-fill': '#f9fafb',
    '--dsw-desktop-only': 'yes',
    '--we-glass-alpha': '0.1',
  };
  const rootSlot = {
    tagName: 'DIV',
    id: 'root',
    attributes: [{ name: 'data-slot', value: 'root' }],
    getAttribute: (name) => (name === 'data-slot' ? 'root' : null),
  };
  const overlaySlot = {
    tagName: 'DIV',
    id: '',
    attributes: [{ name: 'data-slot', value: 'shell.overlay' }],
    getAttribute: (name) => (name === 'data-slot' ? 'shell.overlay' : null),
  };
  const documentElement = {
    tagName: 'HTML',
    className: '',
    attributes: [{ name: 'lang', value: 'en' }],
  };
  const body = {
    tagName: 'BODY',
    className: '',
    attributes: [
      { name: 'style', value: '--dsh-content-font-size: 14px;' },
      { name: 'data-dsh-platform', value: 'desktop' },
    ],
  };
  const document = {
    title: 'DeepSeek Harness',
    readyState: 'complete',
    documentElement,
    body,
    styleSheets: [{
      cssRules: [{ style: styleDeclaration({ '--dsw-alias-bg-base': '#fff', '--we-glass-alpha': '0.1' }) }],
    }],
    querySelector: (selector) => (selector === '[data-slot="root"]' ? rootSlot : null),
    querySelectorAll: (selector) => {
      if (selector === '[data-slot]') return [rootSlot, overlaySlot];
      if (selector === '[data-slot-error]') return [];
      return [];
    },
  };
  const exposed = {};
  const invoked = [];
  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        invoked.push([channel, ...args]);
        return Promise.resolve({ injections: [], streamBaseUrl: 'http://127.0.0.1:5566' });
      },
    },
  };
  const sandbox = {
    document,
    location: { href: 'dsh-app://app/' },
    navigator: {
      windowControlsOverlay: {
        visible: true,
        getTitlebarAreaRect: () => ({ x: 0, y: 0, width: 1440, height: 40 }),
      },
    },
    process: {
      platform: 'win32',
      arch: 'x64',
      isMainFrame: true,
      versions: { electron: '44.0.0', chrome: '152.0.0', node: '24.18.1' },
    },
    __DSH_TRANSPORT__: { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:5566' },
    getComputedStyle: () => ({ getPropertyValue: (name) => tokenValues[name] ?? '' }),
    require: (id) => {
      if (id === 'electron') return fakeElectron;
      throw new Error(`unexpected require: ${id}`);
    },
    module: { exports: {} },
    exports: {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(preloadFile, 'utf8'), sandbox, { filename: 'preload.js' });
  return { sandbox, exposed, invoked };
}

test('preload exposes the desktop boot bridge and calls the lab boot channel', async () => {
  const { exposed, invoked } = makeRendererSandbox();
  assert.ok(exposed.dshDesktopBoot, 'dshDesktopBoot must be exposed');
  const ready = await exposed.dshDesktopBoot.ready();
  assert.deepEqual(ready, { injections: [], streamBaseUrl: 'http://127.0.0.1:5566' });
  await exposed.dshDesktopBoot.failed('boom');
  assert.deepEqual(invoked[0], ['dsh-lab:boot']);
  assert.deepEqual(invoked[1], ['dsh-lab:boot-failed', 'boom']);
});

test('preload probe records slots, tokens, desktop-only body attributes, and transport', async () => {
  const { exposed, sandbox } = makeRendererSandbox();
  assert.ok(exposed.__dshLabShell, '__dshLabShell must be exposed');
  const snapshot = await exposed.__dshLabShell.collect();
  assert.equal(snapshot.source, 'preload');
  assert.equal(snapshot.title, 'DeepSeek Harness');
  assert.equal(snapshot.url, 'dsh-app://app/');
  // The snapshot is built inside the vm realm; re-materialize before strict compare.
  assert.deepStrictEqual([...snapshot.slots], ['root', 'shell.overlay']);
  assert.equal(snapshot.slotCount, 2);
  assert.deepStrictEqual({ ...snapshot.htmlAttributes }, { lang: 'en' });
  assert.equal(snapshot.bodyAttributes['data-dsh-platform'], 'desktop');
  assert.deepStrictEqual([...Object.keys(snapshot.hintedBodyAttributes)], ['data-dsh-platform']);
  assert.equal(snapshot.tokens['--dsw-alias-bg-base'], '#fff');
  assert.equal(snapshot.tokens['--we-glass-alpha'], '0.1');
  assert.deepStrictEqual({ ...snapshot.transport }, {
    present: true,
    ownsHost: true,
    streamBaseUrl: 'http://127.0.0.1:5566',
  });
  assert.equal(snapshot.desktop.platform, 'win32');
  assert.equal(snapshot.desktop.versions.electron, '44.0.0');
  assert.equal(snapshot.titlebar.rect.height, 40);
  assert.deepEqual(sandbox.module.exports.DESKTOP_ATTRIBUTE_HINTS.includes('data-dsh-platform'), true);
});
