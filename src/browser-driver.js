import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { killTree, stopTracked } from './process-tree.js';
import { ensureDir, sleep } from './util.js';

export function browserCandidates(explicitPath) {
  const out = [];
  if (explicitPath) out.push(explicitPath);
  if (process.env.DSH_LAB_BROWSER) out.push(process.env.DSH_LAB_BROWSER);
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  if (programFilesX86) out.push(path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  if (programFiles) out.push(path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  if (programFilesX86) out.push(path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (programFiles) out.push(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (localAppData) out.push(path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return [...new Set(out.map((value) => path.resolve(value)))];
}

export function findBrowser(explicitPath) {
  if (explicitPath && !fs.existsSync(explicitPath)) {
    throw new Error(`browser not found at the explicit path: ${path.resolve(explicitPath)}`);
  }
  const candidates = browserCandidates(explicitPath);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`no Edge/Chrome executable found; checked: ${candidates.join(', ')}`);
  return found;
}

class CdpClient {
  constructor(wsUrl) {
    if (typeof WebSocket === 'undefined') throw new Error('global WebSocket is unavailable; Node 22+ is required');
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = null;
  }

  async connect(timeoutMs = 15_000) {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket connect timed out')), timeoutMs);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP websocket error: ${event?.message ?? 'unknown'}`));
      };
    });
    this.ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      if (message.method) {
        for (const handler of this.handlers.get(message.method) ?? []) handler(message.params ?? {});
        for (const handler of this.handlers.get('*') ?? []) handler(message);
      }
    };
    return this;
  }

  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // Best-effort close.
    }
  }
}

async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const file = path.join(userDataDir, 'DevToolsActivePort');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file)) {
      const [port] = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      if (/^\d+$/.test(port.trim())) return Number(port.trim());
    }
    await sleep(200);
  }
  throw new Error('browser did not publish DevToolsActivePort');
}

async function createPageTarget(devtoolsPort, url) {
  const base = `http://127.0.0.1:${devtoolsPort}`;
  try {
    const response = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (response.ok) return await response.json();
  } catch {
    // Fall through to the existing-target path.
  }
  const list = await fetch(`${base}/json/list`).then((res) => res.json());
  const page = list.find((item) => item.type === 'page') ?? list[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('no CDP page target available');
  return page;
}

async function evaluate(client, expression, timeoutMs = 20_000) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

async function waitForUi(client, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await evaluate(client, `(() => {
        const root = document.querySelector('[data-slot="root"], #root, #app');
        return JSON.stringify({
          readyState: document.readyState,
          rootFound: !!root,
          slots: document.querySelectorAll('[data-slot]').length,
          bodyChildren: document.body ? document.body.children.length : 0
        });
      })()`);
      const parsed = JSON.parse(last);
      if (parsed.readyState === 'complete' && (parsed.slots > 0 || parsed.rootFound)) {
        return { ready: true, ...parsed };
      }
    } catch {
      // The page may still be navigating.
    }
    await sleep(500);
  }
  return { ready: false, last };
}

/** Wait until the [`data-slot`] count stops changing, so probes are comparable. */
async function waitForStableUi(client, options = {}) {
  const { stableMs = 1500, timeoutMs = 25_000, intervalMs = 500 } = options;
  const started = Date.now();
  let last = -1;
  let stableSince = Date.now();
  let current = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      current = await evaluate(client, "document.querySelectorAll('[data-slot]').length");
    } catch {
      current = last;
    }
    if (current !== last) {
      last = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return { stable: true, slots: current, waitedMs: Date.now() - started };
    }
    await sleep(intervalMs);
  }
  return { stable: false, slots: current, waitedMs: Date.now() - started };
}

async function probeDom(client, assertTokens) {
  const expression = `(() => {
    const slotNames = [...new Set([...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')))].sort();
    const tokenNames = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          const style = rule.style;
          if (!style) continue;
          for (const prop of style) {
            if (prop.startsWith('--dsw-') || prop.startsWith('--we-')) tokenNames.add(prop);
          }
        }
      } catch {}
    }
    const wanted = new Set([...tokenNames].slice(0, 500).concat(${JSON.stringify(assertTokens ?? [])}));
    const themeCandidates = [
      document.documentElement,
      document.body,
      document.querySelector('[data-slot="root"]'),
      document.querySelector('#root'),
      document.querySelector('#app'),
      ...document.querySelectorAll('body > *')
    ].filter(Boolean);
    const themeProbeTokens = [
      '--dsw-alias-bg-base',
      '--dsw-alias-label-primary',
      '--dsw-specific-sidebar-fill',
      '--dsw-static-neutral-00'
    ];
    let themeRoot = null;
    for (const candidate of themeCandidates) {
      const computed = getComputedStyle(candidate);
      if (themeProbeTokens.some((name) => computed.getPropertyValue(name).trim())) {
        themeRoot = candidate;
        break;
      }
    }
    if (!themeRoot) themeRoot = document.body ?? document.documentElement;
    const tokens = {};
    const root = getComputedStyle(themeRoot);
    for (const name of wanted) tokens[name] = root.getPropertyValue(name).trim();
    // Positioned elements with an explicit z-index carry the visual stacking
    // order (wallpaper/background layers sit at the bottom, overlays on top).
    const layerKey = (element) => {
      const slot = element.getAttribute('data-slot');
      if (slot) return 'slot:' + slot;
      if (element.id) return '#' + element.id;
      for (const attr of element.attributes) {
        if (attr.name.startsWith('data-we-') || attr.name.startsWith('data-lab-')) return attr.name + '=' + attr.value;
      }
      const cls = typeof element.className === 'string' ? element.className : (element.getAttribute('class') || '');
      const first = cls.split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
      return element.tagName.toLowerCase() + (first ? '.' + first : '');
    };
    const layers = [];
    for (const element of document.querySelectorAll('*')) {
      const computed = getComputedStyle(element);
      if (computed.zIndex === 'auto' || computed.position === 'static') continue;
      const numeric = Number(computed.zIndex);
      layers.push({
        key: layerKey(element),
        zIndex: Number.isFinite(numeric) ? numeric : null,
        position: computed.position,
        hasBackgroundImage: computed.backgroundImage !== 'none',
        backgroundColor: computed.backgroundColor,
      });
      if (layers.length >= 400) break;
    }
    layers.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const layerSummary = layers.length
      ? { count: layers.length, min: layers[0].zIndex, max: layers[layers.length - 1].zIndex }
      : { count: 0, min: null, max: null };
    return JSON.stringify({
      source: 'cdp',
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      htmlClass: document.documentElement.className,
      htmlAttributes: document.documentElement ? Object.fromEntries([...document.documentElement.attributes].map((attr) => [attr.name, attr.value])) : {},
      themeRoot: {
        tag: themeRoot.tagName ? themeRoot.tagName.toLowerCase() : null,
        id: themeRoot.id || null,
        className: typeof themeRoot.className === 'string' ? themeRoot.className : '',
        bgBase: root.getPropertyValue('--dsw-alias-bg-base').trim()
      },
      bodyAttributes: document.body ? Object.fromEntries([...document.body.attributes].map((attr) => [attr.name, attr.value])) : {},
      slots: slotNames,
      slotCount: document.querySelectorAll('[data-slot]').length,
      slotErrors: document.querySelectorAll('[data-slot-error]').length,
      bodyChildren: document.body ? document.body.children.length : 0,
      layers: layers.slice(0, 40),
      layerSummary,
      tokens,
      tokenCount: Object.keys(tokens).length
    });
  })()`;
  return JSON.parse(await evaluate(client, expression));
}

export async function openUi(options) {
  const {
    baseUrl,
    screenshots = ['home'],
    screenshotsAfter = [],
    screenshotsSettings = [],
    clickText = null,
    clickSessionRow = false,
    openSettings = false,
    probes = {},
    probesAfter = {},
    assertTokens = [],
    artifactsDir,
    timeoutMs = 90_000,
    browserPath,
    viewport = { width: 1440, height: 900 },
  } = options;
  const browser = findBrowser(browserPath);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-browser-'));
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--window-size=1440,900',
    'about:blank',
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tracked = { child, pid: child.pid };
  let client = null;
  try {
    const devtoolsPort = await waitForDevToolsPort(userDataDir, 30_000);
    const target = await createPageTarget(devtoolsPort, baseUrl);
    client = await new CdpClient(target.webSocketDebuggerUrl).connect();
    const consoleErrors = [];
    const pageErrors = [];
    const networkFailures = [];
    client.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        consoleErrors.push((params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 1000));
      }
    });
    client.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails?.text ?? params.exceptionDetails?.exception?.description ?? 'exception');
    });
    client.on('Log.entryAdded', (params) => {
      if (params.entry?.level === 'error') consoleErrors.push(`[log] ${params.entry.text ?? ''}`.slice(0, 1000));
    });
    client.on('Network.loadingFailed', (params) => {
      if (!params.canceled) networkFailures.push({ url: params.requestId, error: params.errorText });
    });
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Log.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Page.navigate', { url: baseUrl });
    const ui = await waitForUi(client, timeoutMs);
    const settle = options.settle === false ? null : await waitForStableUi(client, options.settleOptions);
    const dom = await probeDom(client, assertTokens);
    const extra = {};
    for (const [name, expression] of Object.entries(probes)) {
      extra[name] = await evaluate(client, expression);
    }
    const written = {};
    const capture = async (name) => {
      const shot = await client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
      });
      const file = path.join(ensureDir(path.join(artifactsDir, 'screenshots')), `${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      written[name] = file;
    };
    for (const name of screenshots) await capture(name);
    let clicked = null;
    let clickedSession = null;
    const extraAfter = {};
    if (clickText) {
      clicked = await evaluate(client, `(() => {
        const primary = [...document.querySelectorAll('button, a, [role="button"]')];
        const all = [...document.querySelectorAll('body *')];
        const find = (nodes) => nodes.find((node) => node.textContent && node.textContent.includes(${JSON.stringify(clickText)}));
        const element = find(primary) ?? find(all);
        if (!element) return false;
        element.click();
        return true;
      })()`);
      await sleep(1500);
    }
    if (clickSessionRow) {
      clickedSession = await evaluate(client, `(() => {
        const root = document.querySelector('[data-slot="sidebar.workspaces"]');
        if (!root) return false;
        const all = [...root.querySelectorAll('*')];
        const leaf = all.find((node) => node.children.length === 0 && /未命名|Untitled|New session/i.test(node.textContent || ''));
        const clickable = leaf?.closest('button, [role="button"], a, li');
        const target = clickable ?? leaf ?? [...root.querySelectorAll('button, [role="button"], a')].at(-1);
        if (!target) return false;
        target.click();
        return true;
      })()`);
      await sleep(1800);
    }
    for (const name of screenshotsAfter) await capture(name);
    let openedSettings = false;
    let settingsProbe = null;
    if (openSettings) {
      const beforeNames = await evaluate(client, `JSON.stringify([...new Set([...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')))].sort())`);
      const beforeSlots = new Set(JSON.parse(beforeNames));
      openedSettings = await evaluate(client, `(() => {
        const element = [
          document.querySelector('[data-slot="settings.trigger"]'),
          document.querySelector('[data-slot="settings.launcher"]'),
          document.querySelector('[data-slot="sidebar.settings"]'),
        ].filter(Boolean)[0];
        if (!element) return false;
        const target = element.closest('button, [role="button"], a') ?? element;
        target.click();
        return true;
      })()`);
      await sleep(1800);
      if (openedSettings) {
        const names = await evaluate(client, `JSON.stringify([...new Set([...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')))].sort())`);
        const afterSlots = JSON.parse(names);
        settingsProbe = {
          totalSlots: afterSlots.length,
          added: afterSlots.filter((name) => !beforeSlots.has(name)),
        };
      }
    }
    for (const name of screenshotsSettings) await capture(name);
    for (const [name, expression] of Object.entries(probesAfter)) {
      extraAfter[name] = await evaluate(client, expression);
    }
    return {
      browser,
      ui,
      settle,
      dom,
      clicked,
      clickedSession,
      openedSettings,
      settingsProbe,
      extra,
      extraAfter,
      consoleErrors,
      pageErrors,
      networkFailures,
      screenshots: written,
      async close() {
        client?.close();
        const stopped = await stopTracked(tracked, { label: 'browser' });
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch {
          // Windows may keep a lock for a moment; the temp prefix stays cleanable.
        }
        return stopped;
      },
    };
  } catch (error) {
    client?.close();
    killTree(tracked.pid);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
    throw error;
  }
}
