const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const configFile = process.env.DSH_LAB_SHELL_CONFIG;
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const consoleErrors = [];
const pageErrors = [];
let finished = false;
let mainWindow = null;

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

/** Wait until the slot count stops changing so shell and web probes agree. */
async function waitForStableShell(window, options = {}) {
  const { stableMs = 1500, timeoutMs = 25_000, intervalMs = 500 } = options;
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
    } else if (Date.now() - stableSince >= stableMs) {
      return { stable: true, slots: current, waitedMs: Date.now() - started };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { stable: false, slots: current, waitedMs: Date.now() - started };
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
  setTimeout(() => app.exit(ok ? 0 : 1), 50);
}

app.whenReady().then(async () => {
  const distDir = path.join(config.officialInstall, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist');
  ipcMain.handle('dsh-lab:boot', (event) => {
    assertAppSender(event);
    if (!config.hostUrl) throw new Error('dsh-lab shell: Host is unavailable');
    // The served index already contains the Host injection rows, so the shell
    // reports an empty list instead of applying them a second time.
    return { injections: [], streamBaseUrl: new URL(config.hostUrl).origin };
  });
  ipcMain.handle('dsh-lab:boot-failed', (event, message) => {
    assertAppSender(event);
    pageErrors.push(`boot-failed: ${String(message ?? '').slice(0, 1000)}`);
    return null;
  });
  protocol.handle('dsh-app', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }));
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveIndexFromHost();
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
    // and stays invisible to the user.
    show: true,
    opacity: 0,
    skipTaskbar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 40, color: '#ffffff', symbolColor: '#000000' },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow = window;
  installWebSocketFence();
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) consoleErrors.push(String(message).slice(0, 1000));
  });
  window.webContents.on('render-process-gone', (_event, details) => pageErrors.push(JSON.stringify(details)));
  window.webContents.on('did-fail-load', (_event, code, description, url) => pageErrors.push(`did-fail-load ${code} ${description} ${url}`));
  try {
    await window.loadURL('dsh-app://app/');
    const settle = await waitForStableShell(window);
    const dom = await probeDom(window);
    const image = await window.webContents.capturePage();
    fs.mkdirSync(path.dirname(config.screenshotFile), { recursive: true });
    fs.writeFileSync(config.screenshotFile, image.toPNG());
    await finish(true, {
      dom,
      settle,
      title: window.getTitle(),
      webContents: { url: window.webContents.getURL(), userAgent: window.webContents.getUserAgent() },
      screenshotFile: config.screenshotFile,
    });
  } catch (error) {
    await finish(false, { error: String(error?.stack ?? error) });
  }
});

setTimeout(() => finish(false, { error: 'shell timeout' }), 120_000);
