const {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, protocol, session, Tray,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createDesktopBridge } = require('./desktop-bridge.cjs');
const { earlyCloseOutcome } = require('./close-policy.cjs');

const configFile = process.env.DSH_LAB_SHELL_CONFIG;
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

/**
 * Typed boot rows the host sent over its IPC channel (written by the runner).
 * `null` means "no rows available": the shell then serves the index the host
 * rendered for the web path, which already has them inlined.
 */
function loadBootInjections(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.injections) ? parsed.injections : null;
  } catch {
    return null;
  }
}
const bootInjections = loadBootInjections(config.injectionsFile);
const indexSource = bootInjections ? 'packaged-dist' : 'host-rendered';
const consoleErrors = [];
const pageErrors = [];
let finished = false;
let mainWindow = null;
let tray = null;
let probePayload = null;

/** 16x16 opaque dot, so the minimal shell ships no asset files. */
const TRAY_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR4nGNgGDRAP//Cf1LwqAGjBgxXAwYMAADtRF1gVZC2EwAAAABJRU5ErkJggg==';

/** The globals the host's index injections are expected to leave behind. */
const BOOT_GLOBAL_NAMES = [
  '__DSH_BOOT__',
  '__DSH_BOOT_READY__',
  '__DSH_TRANSPORT__',
  '__DSH_CONTACT_CONFIG__',
  '__DSH_SHORTCUTS_CONFIG__',
  '__DSH_DOCUMENT_PREVIEW_CONFIG__',
  '__DSH_MODELS_ONBOARDING__',
  '__DSH_CONNECTION_RECOVERY__',
];
/** Only these gate the check; the rest depend on host configuration. */
const REQUIRED_BOOT_GLOBALS = ['__DSH_BOOT__', '__DSH_BOOT_READY__', '__DSH_TRANSPORT__'];

/**
 * The official app always has a tray; the lab creates one only for a visible
 * run so automated runs stay invisible and quiet.
 */
function createTrayFacts(window) {
  const facts = { created: false, skipped: false, tooltip: null, menuItems: [], error: null };
  try {
    tray = new Tray(nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG, 'base64')));
    facts.created = true;
    facts.tooltip = 'DSH Plugin Effect Lab (lab shell)';
    tray.setToolTip(facts.tooltip);
    facts.menuItems = ['显示窗口', '退出'];
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示窗口', click: () => { if (!window.isDestroyed()) { window.show(); window.focus(); } } },
      { type: 'separator' },
      { label: '退出', click: () => { if (!window.isDestroyed()) window.close(); } },
    ]));
    tray.on('click', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
    return facts;
  } catch (error) {
    facts.error = String(error?.message ?? error);
    return facts;
  }
}

/**
 * Which of the host's index-injected globals actually reached the renderer.
 * The host inlines its injection rows into the served index, so the effects are
 * present even though the lab does not transport typed rows over IPC.
 */
async function probeBootGlobals(window) {
  const booleans = await window.webContents.executeJavaScript(`(() => {
    const out = {};
    for (const name of ${JSON.stringify(BOOT_GLOBAL_NAMES)}) out[name] = typeof globalThis[name] !== 'undefined';
    return out;
  })()`);
  return {
    present: Object.entries(booleans).filter(([, value]) => value).map(([name]) => name),
    missing: Object.entries(booleans).filter(([, value]) => !value).map(([name]) => name),
    requiredPresent: REQUIRED_BOOT_GLOBALS.every((name) => booleans[name] === true),
  };
}

/**
 * The host renders its injection rows into the index it serves for the web
 * path. Parsing them back gives the *content* of the rows — which globals,
 * plugin scripts and inline styles the host contributed — which is real
 * evidence even when the typed-row IPC transport is not in use.
 */
async function probeInjectedRows() {
  try {
    const response = await fetch(`${config.hostUrl}/`, {
      headers: config.hostCookie ? { cookie: config.hostCookie } : {},
      redirect: 'manual',
    });
    const html = await response.text();
    const rows = [];
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = /\bsrc\s*=\s*"([^"]+)"/i.exec(match[1])?.[1] ?? null;
      if (src) {
        if (/plugins\//i.test(src)) rows.push({ kind: 'script-src', name: src.split('?')[0] });
        continue;
      }
      const globals = [...new Set([...match[2].matchAll(/__DSH_[A-Z_]+/g)].map((item) => item[0]))];
      if (globals.length) rows.push({ kind: 'script', name: globals.join(',') });
    }
    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      if (match[1].trim()) rows.push({ kind: 'style', name: 'inline-style' });
    }
    return {
      source: 'host-rendered-index',
      count: rows.length,
      kinds: [...new Set(rows.map((row) => row.kind))],
      names: rows.map((row) => row.name),
    };
  } catch (error) {
    return {
      source: 'host-rendered-index',
      count: 0,
      kinds: [],
      names: [],
      error: String(error?.message ?? error),
    };
  }
}

/**
 * Click the fixture workspace and its seeded session so the visible shell
 * window shows the conversation (thinking + code + tool), not the empty
 * landing page. The workspace itself is registered by the runner over RPC.
 */
async function openFixtureSession(window) {
  const workspaceName = config.fixtureWorkspaceName;
  const sessionTitle = config.fixtureSessionTitle;
  // The `empty` variant has a workspace but no session row; nothing to open.
  if (!sessionTitle) return { opened: false, reason: 'no fixture session configured' };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const evaluate = (expression) => window.webContents.executeJavaScript(expression);
  const workspaceClickExpression = `(() => {
    const primary = [...document.querySelectorAll('button, a, [role="button"]')];
    const all = [...document.querySelectorAll('body *')];
    const find = (nodes) => nodes.find((node) => node.textContent && node.textContent.includes(${JSON.stringify(workspaceName)}));
    const element = find(primary) ?? find(all)?.closest('button, a, [role="button"], [role="treeitem"], li') ?? find(all);
    if (!element) return false;
    element.click();
    return true;
  })()`;
  const sessionRowExpression = `(() => {
    const root = document.querySelector('[data-slot="sidebar.workspaces"]');
    if (!root) return false;
    const all = [...root.querySelectorAll('*')];
    const wanted = ${JSON.stringify(sessionTitle)};
    const matches = (text) => (wanted ? text.includes(wanted) : false) || /未命名|Untitled|New session/i.test(text);
    const leaf = all.find((node) => node.children.length === 0 && matches(node.textContent || ''));
    const rowSlot = root.querySelector('[data-slot="sidebar.workspaces.session.row.action"]');
    if (!leaf && !rowSlot) return false;
    const clickable = leaf?.closest('button, [role="button"], a, li');
    const target = clickable ?? leaf ?? rowSlot?.closest('button, [role="button"], a, li') ?? rowSlot
      ?? [...root.querySelectorAll('button, [role="button"], a')].at(-1);
    if (!target) return false;
    target.click();
    return true;
  })()`;
  // A profile without usable provider credentials opens the "Add an API Key"
  // onboarding modal, which covers the conversation. Dismiss it with its
  // secondary action so the seeded fixture is visible (the lab never adds a
  // key).
  const dismissOnboardingExpression = `(() => {
    const labels = ['稍后配置', '稍后设置', '跳过', 'Later', 'Skip'];
    const candidates = [...document.querySelectorAll('button, [role="button"], a')];
    const target = candidates.find((node) => labels.includes((node.textContent || '').trim()));
    if (!target) return false;
    target.click();
    return true;
  })()`;
  const expectedText = config.fixtureReasoning || config.fixtureCodeLine || '';
  // `conversation.session` exists even on the empty hero, so it is not proof
  // that the seeded messages rendered. Require the fixture text (or a real
  // message node) and keep re-clicking the workspace/session until it appears.
  const visibleExpression = expectedText
    ? `document.body ? document.body.textContent.includes(${JSON.stringify(expectedText)}) : false`
    : "!!document.querySelector('[data-slot=\"conversation.chat.node\"]')";
  // Evidence for a fixture that does not open: which workspace/session rows the
  // sidebar actually rendered, whether an onboarding modal covers the view, and
  // what the body says. Written into shell-result.json on failure.
  const diagnosticsExpression = `(() => {
    const clip = (value, max = 160) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, max);
    const facts = (el) => ({
      slot: el.getAttribute('data-slot'),
      text: clip(el.textContent),
      selected: el.getAttribute('aria-selected'),
      current: el.getAttribute('aria-current'),
      expanded: el.getAttribute('aria-expanded'),
      className: clip(el.className, 80),
    });
    const sidebar = document.querySelector('[data-slot="sidebar.workspaces"]');
    const slots = [...new Set([...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')))].sort();
    const bodyText = clip(document.body ? document.body.textContent : '', 500);
    return JSON.stringify({
      url: location.href,
      title: document.title,
      bodyText,
      onboarding: /add an api key|api key|sign in|log in|登录|添加 api|欢迎|welcome/i.test(bodyText),
      sidebarPresent: Boolean(sidebar),
      slotNames: slots.slice(0, 80),
      workspaceSlots: (sidebar ? [...sidebar.querySelectorAll('[data-slot*="workspace"]')] : []).slice(0, 20).map(facts),
      sessionSlots: (sidebar ? [...sidebar.querySelectorAll('[data-slot*="session"]')] : []).slice(0, 20).map(facts),
      conversationChatNode: Boolean(document.querySelector('[data-slot="conversation.chat.node"]')),
    });
  })()`;
  const deadline = Date.now() + (config.show || config.keepOpen ? 25_000 : 10_000);
  let clickedWorkspace = false;
  let clickedSession = false;
  let mounted = false;
  while (Date.now() < deadline) {
    try {
      await evaluate(dismissOnboardingExpression);
    } catch {
      // No onboarding modal on this profile.
    }
    try {
      if (await evaluate(workspaceClickExpression)) clickedWorkspace = true;
    } catch {
      // The page may re-render between clicks.
    }
    try {
      if (await evaluate(sessionRowExpression)) clickedSession = true;
    } catch {
      // The sidebar may still be mounting.
    }
    try {
      if (await evaluate(visibleExpression)) {
        mounted = true;
        break;
      }
    } catch {
      // The conversation may still be mounting.
    }
    await sleep(400);
  }
  const opened = clickedSession && mounted;
  let dom = null;
  if (!opened) {
    try {
      dom = JSON.parse(await evaluate(diagnosticsExpression));
    } catch (error) {
      dom = { error: String(error?.message ?? error) };
    }
  }
  return { opened, clickedWorkspace, clickedSession, mounted, ...(dom ? { dom } : {}) };
}

/** Does the rendered conversation text contain the seeded thinking/code? */
async function probeFixtureText(window) {
  const reasoning = config.fixtureReasoning ?? '';
  const codeLine = config.fixtureCodeLine ?? '';
  return window.webContents.executeJavaScript(`(() => {
    const text = document.body ? document.body.textContent : '';
    return {
      textLength: text.length,
      textSample: text.replace(/\s+/g, ' ').trim().slice(0, 500),
      reasoningFound: ${reasoning ? `text.includes(${JSON.stringify(reasoning)})` : 'false'},
      codeFound: ${codeLine ? `text.includes(${JSON.stringify(codeLine)})` : 'false'},
    };
  })()`);
}

app.setName('dsh-lab-electron-shell');
app.setPath('userData', config.userDataDir);
app.commandLine.appendSwitch('disable-gpu');
// Keep capturePage() in CSS pixels so it matches the Edge CDP baseline
// regardless of the host display scale (e.g. Windows 150%).
app.commandLine.appendSwitch('force-device-scale-factor', '1');

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    codeCache: true,
  },
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

function serveWebDocument(request, distDir) {
  const url = new URL(request.url);
  const relative = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(distDir, relative.replace(/^\/+/, ''));
  try {
    const data = fs.readFileSync(file);
    return new Response(data, {
      status: 200,
      headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

async function serveIndexFromHost() {
  const response = await fetch(`${config.hostUrl}/`, {
    headers: config.hostCookie ? { cookie: config.hostCookie } : {},
    redirect: 'manual',
  });
  const html = await response.text();
  return new Response(html, {
    status: response.status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function forwardWebRequest(request, hostUrl, cookie) {
  const source = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== 'dsh-app://app') return new Response(null, { status: 403 });
  const target = new URL(hostUrl);
  target.pathname = source.pathname;
  target.search = source.search;
  const headers = new Headers(request.headers);
  for (const name of ['host', 'origin', 'cookie', 'sec-fetch-site']) headers.delete(name);
  if (cookie) headers.set('cookie', cookie);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const response = await fetch(target, { method: request.method, headers, body, redirect: 'manual' });
  const out = new Headers(response.headers);
  for (const name of ['connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization']) {
    out.delete(name);
  }
  return new Response(response.body, { status: response.status, headers: out });
}

async function probeDom(window) {
  const assertedTokens = await readAssertedTokens(window);
  // `__DSH_TRANSPORT__` lives in the page's main world; the preload probe runs
  // in the isolated world, so read it here where it is visible.
  const mainWorldTransport = await window.webContents.executeJavaScript(`(() => {
    const transport = globalThis.__DSH_TRANSPORT__;
    if (!transport || typeof transport !== 'object') return { present: false, ownsHost: false, streamBaseUrl: null };
    return {
      present: true,
      ownsHost: transport.ownsHost === true,
      streamBaseUrl: typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : null
    };
  })()`);
  const fromPreload = await window.webContents.executeJavaScript(
    'typeof globalThis.__dshLabShell?.collect === "function" ? globalThis.__dshLabShell.collect() : null',
  );
  if (fromPreload && typeof fromPreload === 'object') {
    return mergeAssertedTokens({ ...fromPreload, transport: mainWorldTransport, probedBy: 'preload' }, assertedTokens);
  }
  const fallback = await window.webContents.executeJavaScript(`(() => {
    const slotNames = [...new Set([...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')))].sort();
    const tokenNames = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          const style = rule.style;
          if (!style) continue;
          for (const prop of style) if (prop.startsWith('--dsw-') || prop.startsWith('--we-')) tokenNames.add(prop);
        }
      } catch {}
    }
    const themeCandidates = [document.documentElement, document.body, document.querySelector('#root'), document.querySelector('#app'), ...document.querySelectorAll('body > *')].filter(Boolean);
    const probes = ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-specific-sidebar-fill'];
    let themeRoot = null;
    for (const candidate of themeCandidates) {
      const computed = getComputedStyle(candidate);
      if (probes.some((name) => computed.getPropertyValue(name).trim())) { themeRoot = candidate; break; }
    }
    if (!themeRoot) themeRoot = document.body ?? document.documentElement;
    const computed = getComputedStyle(themeRoot);
    const tokens = {};
    for (const name of [...tokenNames].slice(0, 500)) tokens[name] = computed.getPropertyValue(name).trim();
    return JSON.stringify({
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      htmlClass: document.documentElement.className,
      bodyAttributes: document.body ? Object.fromEntries([...document.body.attributes].map((attr) => [attr.name, attr.value])) : {},
      slots: slotNames,
      slotCount: document.querySelectorAll('[data-slot]').length,
      slotErrors: document.querySelectorAll('[data-slot-error]').length,
      themeRoot: { tag: themeRoot.tagName?.toLowerCase() ?? null, id: themeRoot.id || null, className: typeof themeRoot.className === 'string' ? themeRoot.className : '' },
      tokens,
      tokenCount: Object.keys(tokens).length
    });
  })()`);
  return mergeAssertedTokens({ ...JSON.parse(fallback), transport: mainWorldTransport, probedBy: 'inline' }, assertedTokens);
}

/** Read caller-asserted custom properties, which may live only in inline styles. */
async function readAssertedTokens(window) {
  const wanted = Array.isArray(config.assertTokens) ? config.assertTokens : [];
  if (!wanted.length) return {};
  return window.webContents.executeJavaScript(`(() => {
    const root = document.body ?? document.documentElement;
    const computed = getComputedStyle(root);
    const out = {};
    for (const name of ${JSON.stringify(wanted)}) out[name] = computed.getPropertyValue(name).trim();
    return out;
  })()`);
}

function mergeAssertedTokens(snapshot, extra) {
  const tokens = { ...(snapshot.tokens ?? {}) };
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (tokens[name] === undefined) tokens[name] = value;
  }
  return { ...snapshot, tokens, tokenCount: Object.keys(tokens).length };
}

/**
 * Exercise the desktop-only surfaces the official preload exposes. The
 * clipboard round-trip is always real. In `stub` mode the directory picker
 * returns a fixture path and notifications are recorded without an OS toast,
 * so automation never blocks. In `native` mode the picker's real dialog is
 * deliberately *not* auto-probed (it is modal and would block this script),
 * while the notification path does raise a real toast.
 */
async function probeDesktopCapabilities(window, bridge) {
  const autoProbePicker = config.autoProbeDirectoryPicker !== false;
  const bridged = await window.webContents.executeJavaScript(`(async () => {
    const autoProbe = ${autoProbePicker ? 'true' : 'false'};
    const directoryPicker = autoProbe && typeof globalThis.__DSH_DIRECTORY_PICKER__?.pick === 'function'
      ? await globalThis.__DSH_DIRECTORY_PICKER__.pick()
      : { skipped: 'native-modal', reason: 'a native folder dialog is modal; trigger it from the window instead' };
    const hostPaths = typeof globalThis.__DSH_HOST_PATHS__?.pathFor === 'function'
      ? globalThis.__DSH_HOST_PATHS__.pathFor({ path: 'C:/lab/sample.txt', name: 'sample.txt' })
      : null;
    const notification = typeof globalThis.__dshLabShell?.notify === 'function'
      ? await globalThis.__dshLabShell.notify('DSH Plugin Effect Lab', 'shell capability probe')
      : null;
    return { directoryPicker, hostPaths, notification };
  })()`);
  bridge.directoryPicker.autoProbed = autoProbePicker;
  bridge.mode = bridge.directoryPicker.mode;
  const token = `lab-clipboard-${Date.now()}`;
  let clipboardResult = { ok: false, tokenLength: token.length, readLength: 0, attempts: 0 };
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      clipboard.writeText(token);
      const read = clipboard.readText();
      clipboardResult = {
        ok: read === token,
        tokenLength: token.length,
        readLength: typeof read === 'string' ? read.length : -1,
        attempts: attempt,
      };
      if (clipboardResult.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } catch (error) {
    clipboardResult = { ok: false, error: String(error) };
  }
  return { bridged, clipboard: clipboardResult, bridge };
}

/**
 * Wait until the slot count stops changing so shell and web probes agree.
 *
 * A fully transparent window can be throttled by the compositor, so the app
 * sometimes pauses at an early plateau (e.g. 24 slots) for longer than
 * `stableMs` before the conversation view mounts. `minSlots` (the web
 * baseline's slot count) stops that early plateau from being accepted.
 */
async function waitForStableShell(window, options = {}) {
  const { stableMs = 1500, timeoutMs = 25_000, intervalMs = 500, minSlots = 0 } = options;
  const started = Date.now();
  let last = -1;
  let stableSince = Date.now();
  let current = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      current = await window.webContents.executeJavaScript("document.querySelectorAll('[data-slot]').length");
    } catch {
      current = last;
    }
    if (current !== last) {
      last = current;
      stableSince = Date.now();
    } else if (current >= minSlots && Date.now() - stableSince >= stableMs) {
      return { stable: true, slots: current, waitedMs: Date.now() - started };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { stable: false, slots: current, waitedMs: Date.now() - started, minSlots };
}

/**
 * True when a captured frame is essentially one flat colour, i.e. the window
 * was never painted. An opacity-0 window is occasionally skipped by the
 * Windows compositor even though the DOM is complete.
 */
function isUnpaintedFrame(image) {
  let bitmap;
  try {
    bitmap = image.toBitmap();
  } catch {
    return true;
  }
  if (!bitmap || bitmap.length < 64) return true;
  const stride = Math.max(4, Math.floor(bitmap.length / 4096 / 4) * 4);
  let first = null;
  let same = 0;
  let samples = 0;
  for (let offset = 0; offset + 3 < bitmap.length; offset += stride) {
    const key = (bitmap[offset] << 16) | (bitmap[offset + 1] << 8) | bitmap[offset + 2];
    if (first === null) first = key;
    if (key === first) same += 1;
    samples += 1;
  }
  return samples > 0 && same / samples > 0.995;
}

/**
 * Capture the window, retrying when the compositor is not ready.
 *
 * An opacity-0 window is sometimes skipped by the Windows compositor: the
 * first `capturePage()` can reject with `UnknownVizError`, or hand back a
 * stale flat frame. Retrying with a short delay recovers both without
 * `invalidate()`, which was tried and made `capturePage()` hang.
 */
async function captureWindowFrame(window, retries = 4) {
  let lastImage = null;
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const image = await window.webContents.capturePage();
      if (!image.isEmpty() && !isUnpaintedFrame(image)) {
        return { image, attempts: attempt, unpainted: false };
      }
      lastImage = image;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }
  if (lastImage) return { image: lastImage, attempts: retries, unpainted: true };
  return {
    image: null,
    attempts: retries,
    unpainted: true,
    error: String(lastError?.message ?? lastError ?? 'capturePage failed'),
  };
}

/** Only the main `dsh-app://app/` frame may talk to the shell IPC bridge. */
function assertAppSender(event) {
  const frameUrl = event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? '';
  if (!String(frameUrl).startsWith('dsh-app://app/')) {
    throw new Error(`dsh-lab shell: rejected IPC from ${frameUrl || 'unknown frame'}`);
  }
}

/**
 * The desktop trust fence for the Host Remote-stream WebSocket. The renderer
 * dials `ws://127.0.0.1:<port>/api/remote.mux` from the `dsh-app://app`
 * origin, so the handshake must be rewritten to look same-origin and carry the
 * launch cookie. Without this the Host closes the socket and the client logs
 * `[connection] connection lost, retry #1`.
 */
function installWebSocketFence() {
  const target = new URL(config.hostUrl);
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    if (mainWindow && details.webContentsId !== undefined && details.webContentsId !== mainWindow.webContents.id) {
      callback({});
      return;
    }
    let requested;
    try {
      requested = new URL(details.url);
    } catch {
      callback({});
      return;
    }
    if (requested.host !== target.host) {
      callback({});
      return;
    }
    const headers = {};
    for (const [name, value] of Object.entries(details.requestHeaders ?? {})) headers[name.toLowerCase()] = value;
    if (headers.origin !== 'dsh-app://app') {
      callback({ cancel: true });
      return;
    }
    callback({
      requestHeaders: {
        ...headers,
        origin: target.origin,
        cookie: config.hostCookie,
        'sec-fetch-site': 'same-origin',
      },
    });
  });
}

async function finish(ok, extra = {}) {
  if (finished) return;
  finished = true;
  try {
    fs.writeFileSync(config.resultFile, `${JSON.stringify({ ok, consoleErrors, pageErrors, ...extra }, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('shell result write failed', error);
  }
  if (tray) {
    try {
      tray.destroy();
    } catch {
      // Best-effort: the process is about to exit anyway.
    }
    tray = null;
  }
  setTimeout(() => app.exit(ok ? 0 : 1), 50);
}

app.whenReady().then(async () => {
  const distDir = path.join(config.officialInstall, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist');
  ipcMain.handle('dsh-lab:boot', (event) => {
    assertAppSender(event);
    if (!config.hostUrl) throw new Error('dsh-lab shell: Host is unavailable');
    // Desktop path: hand the frontend the real typed rows (it applies them).
    // Web path (no rows): the served index already contains them, so report an
    // empty list instead of applying them a second time.
    return { injections: bootInjections ?? [], streamBaseUrl: new URL(config.hostUrl).origin };
  });
  ipcMain.handle('dsh-lab:boot-failed', (event, message) => {
    assertAppSender(event);
    pageErrors.push(`boot-failed: ${String(message ?? '').slice(0, 1000)}`);
    return null;
  });
  const desktop = createDesktopBridge({
    mode: config.desktopMode,
    fixtureDir: config.fixtureDir ?? null,
    autoProbe: config.autoProbeDirectoryPicker !== false,
    dialog,
    Notification,
    getWindow: () => mainWindow,
  });
  const desktopBridge = desktop.record;
  ipcMain.handle('dsh-lab:pick-directory', async (event) => {
    assertAppSender(event);
    return desktop.pickDirectory();
  });
  ipcMain.handle('dsh-lab:notify', (event, title, body) => {
    assertAppSender(event);
    return desktop.notify(title, body);
  });
  protocol.handle('dsh-app', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }));
    if (url.pathname === '/' || url.pathname === '/index.html') {
      // Desktop path: the packaged index, with the frontend applying the typed
      // rows itself. Web path: the index the host rendered (rows inlined).
      return bootInjections ? Promise.resolve(serveWebDocument(request, distDir)) : serveIndexFromHost();
    }
    if (url.pathname.startsWith('/assets/') || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
      return Promise.resolve(serveWebDocument(request, distDir));
    }
    if (!config.hostUrl || !config.hostCookie) return Promise.resolve(new Response(null, { status: 503 }));
    return forwardWebRequest(request, config.hostUrl, config.hostCookie);
  });
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    // A fully hidden window does not composite on Windows, so capturePage()
    // returns a blank surface. An opacity-0 visible window renders normally
    // and stays invisible to the user; --show makes it a normal window.
    // `capture.unpainted` in the shell result flags a stale frame when the
    // compositor still skips it.
    show: true,
    opacity: config.show ? 1 : 0,
    skipTaskbar: !config.show,
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 40, color: '#ffffff', symbolColor: '#000000' },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow = window;
  // Registered before the (slow) probe on purpose: closing the window while
  // the probe runs must still write shell-result.json. Otherwise Electron
  // quits on window-all-closed and the runner reports "shell-result missing".
  const onWindowClosedEarly = () => {
    if (finished) return;
    const outcome = earlyCloseOutcome({
      keepOpen: config.keepOpen === true,
      show: config.show === true,
      probePayload,
    });
    finish(outcome.ok, outcome.extra);
  };
  window.on('close', onWindowClosedEarly);
  window.on('closed', onWindowClosedEarly);
  const trayFacts = (config.show || config.keepOpen)
    ? createTrayFacts(window)
    : { created: false, skipped: true, reason: 'hidden run (pass --show or --keep-open)', tooltip: null, menuItems: [] };
  installWebSocketFence();
  if (config.show) {
    // Make the deliberately-visible window findable: front, centred, on top.
    window.once('ready-to-show', () => {
      window.show();
      window.center();
      window.focus();
      window.setAlwaysOnTop(true, 'normal');
    });
  }
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) consoleErrors.push(String(message).slice(0, 1000));
  });
  window.webContents.on('render-process-gone', (_event, details) => pageErrors.push(JSON.stringify(details)));
  window.webContents.on('did-fail-load', (_event, code, description, url) => pageErrors.push(`did-fail-load ${code} ${description} ${url}`));
  try {
    await window.loadURL('dsh-app://app/');
    const hasFixture = Boolean(config.fixtureWorkspaceName || config.fixtureSessionTitle);
    const fixtureProbe = hasFixture ? await openFixtureSession(window) : null;
    const settle = await waitForStableShell(window, { minSlots: Number(config.minSlots) || 0 });
    const dom = await probeDom(window);
    const fixtureText = hasFixture ? await probeFixtureText(window) : null;
    const capabilities = await probeDesktopCapabilities(window, desktopBridge);
    const bootGlobals = await probeBootGlobals(window);
    const derivedInjections = await probeInjectedRows();
    const frame = await captureWindowFrame(window);
    if (frame.image) {
      fs.mkdirSync(path.dirname(config.screenshotFile), { recursive: true });
      fs.writeFileSync(config.screenshotFile, frame.image.toPNG());
    }
    const payload = {
      dom,
      settle,
      fixture: fixtureProbe ? { ...fixtureProbe, ...fixtureText } : null,
      capabilities,
      capture: { attempts: frame.attempts, unpainted: frame.unpainted, error: frame.error ?? null },
      bootGlobals,
      derivedInjections,
      indexSource,
      bootInjections: {
        count: bootInjections?.length ?? 0,
        kinds: bootInjections ? [...new Set(bootInjections.map((row) => row?.kind ?? 'unknown'))] : [],
      },
      tray: trayFacts,
      title: window.getTitle(),
      webContents: { url: window.webContents.getURL(), userAgent: window.webContents.getUserAgent() },
      screenshotFile: config.screenshotFile,
    };
    probePayload = payload;
    if (config.keepOpen) {
      // Leave the real window open for the user; the early close handler
      // writes this payload (or a probeIncomplete result) when they close it.
      return;
    }
    if (config.show && Number(config.showHoldMs) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(config.showHoldMs)));
    }
    await finish(true, payload);
  } catch (error) {
    await finish(false, { error: String(error?.stack ?? error) });
  }
});

setTimeout(
  () => finish(false, { error: 'shell timeout' }),
  config.keepOpen ? 35 * 60_000 : 120_000,
);
