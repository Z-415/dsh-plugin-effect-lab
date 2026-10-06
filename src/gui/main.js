'use strict';

/**
 * DSH Plugin Effect Lab desktop launcher.
 *
 * Runs the same `bin/lab.js` commands the CLI exposes, streams their output
 * into the window, and opens the generated HTML reports. It never talks to the
 * target runtime itself: every action is a child `lab.js` process, so the GUI
 * cannot bypass the lab's isolation rules.
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } = require('electron');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// The built runtime keeps a copy of this app. Refresh it from src/gui at every
// start, so an existing Desktop shortcut picks up UI edits without a rebuild.
let syncAppFiles = null;
try {
  ({ syncAppFiles } = require('./app-sync.cjs'));
} catch {
  // An older build may not ship the helper; run with whatever is on disk.
}

let buildMenuTemplate = null;
try {
  ({ buildMenuTemplate } = require('./menu.cjs'));
} catch {
  // Fall back to Electron's default menu when the helper is missing.
}

/**
 * The GUI is launched both by `lab gui` (which sets DSH_LAB_GUI_CONFIG) and by
 * double-clicking the shortcut / exe (which sets nothing). Fall back to the
 * config written next to this file at build time, and fail with a readable
 * dialog instead of an uncaught exception.
 */
function loadConfig() {
  const candidates = [
    process.env.DSH_LAB_GUI_CONFIG,
    path.join(__dirname, 'gui-config.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // Try the next candidate.
    }
  }
  dialog.showErrorBox(
    'DSH Plugin Effect Lab',
    'Cannot read the GUI config (gui-config.json).\n\n'
      + 'Rebuild it from the project:\n    node bin/lab.js gui\n\n'
      + `Looked in:\n${candidates.join('\n')}`,
  );
  process.exit(1);
  return null;
}

const config = loadConfig();
const repo = config.repo;
const artifactsDir = path.join(repo, 'artifacts');
const logFile = path.join(config.userDataDir, 'gui.log');

app.setName('DSH Plugin Effect Lab');
app.setPath('userData', config.userDataDir);
app.commandLine.appendSwitch('disable-gpu');

let window = null;
let child = null;

function appendLog(text) {
  try {
    fs.appendFileSync(logFile, text);
  } catch {
    // Logging is best-effort.
  }
}

function send(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function finish(code) {
  child = null;
  send('lab:done', { code });
}

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: '关于 DSH Plugin Effect Lab',
    message: 'DSH Plugin Effect Lab',
    detail: `electron ${process.versions.electron}\nnode ${process.versions.node}\n${repo}`,
  });
}

/** Run one lab command; the GUI is single-flight. */
function runLab(args) {
  if (child) return { started: false, reason: 'a command is already running' };
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_LAB_GUI: '1' };
  send('lab:started', { args });
  appendLog(`\n$ lab ${args.join(' ')}\n`);
  child = spawn(process.execPath, [path.join(repo, 'bin', 'lab.js'), ...args], {
    cwd: repo,
    env,
    windowsHide: true,
  });
  const forward = (chunk) => {
    const text = String(chunk);
    appendLog(text);
    send('lab:output', text);
  };
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);
  child.on('error', (error) => {
    send('lab:output', `\n[gui] failed to start: ${error.message}\n`);
    finish(-1);
  });
  child.on('close', (code) => finish(code ?? -1));
  return { started: true };
}

function stopLab() {
  if (!child) return { stopped: false };
  const pid = child.pid;
  child = null;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  send('lab:output', '\n[gui] aborted by user\n');
  send('lab:done', { code: -1 });
  return { stopped: true };
}

/** Newest report.html/matrix.html under artifacts/. */
function latestReport() {
  if (!fs.existsSync(artifactsDir)) return null;
  const found = [];
  for (const entry of fs.readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of ['report.html', 'matrix.html']) {
      const file = path.join(artifactsDir, entry.name, name);
      if (fs.existsSync(file)) found.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found[0]?.file ?? null;
}

/**
 * Existing lab profiles, for the profile dropdown. Uses the same CLI the rest
 * of the launcher does (`profile list --json`) so the path resolution and the
 * name rules stay in one place.
 */
function listProfiles() {
  const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'lab.js'), 'profile', 'list', '--json'], {
    cwd: repo,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_LAB_GUI: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error) return { profiles: [], root: null, error: String(result.error.message ?? result.error) };
  if (result.status !== 0) {
    return { profiles: [], root: null, error: (result.stderr || '').trim() || `exit ${result.status}` };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return { profiles: parsed.profiles ?? [], root: parsed.root ?? null };
  } catch (error) {
    return { profiles: [], root: null, error: String(error?.message ?? error) };
  }
}

/**
 * Read-only real DSH profiles, for the clone-source dropdown. Uses the CLI
 * (`real-profiles --json`) so the discovery rules live in one place; the GUI
 * never offers delete/uninstall for these entries.
 */
function realProfiles() {
  const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'lab.js'), 'real-profiles', '--json'], {
    cwd: repo,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_LAB_GUI: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error) return { profiles: [], root: null, error: String(result.error.message ?? result.error) };
  if (result.status !== 0) {
    return { profiles: [], root: null, error: (result.stderr || '').trim() || `exit ${result.status}` };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return { profiles: parsed.profiles ?? [], root: parsed.root ?? null };
  } catch (error) {
    return { profiles: [], root: null, error: String(error?.message ?? error) };
  }
}

ipcMain.handle('lab:run', (_event, args) => runLab(Array.isArray(args) ? args.map(String) : []));
/**
 * The window draws its own title bar and menu (the OS one follows the Windows
 * accent colour), so menu clicks arrive here by action name.
 */
ipcMain.handle('lab:menu', (_event, action) => {
  if (!window || window.isDestroyed()) return { ok: false, reason: 'no window' };
  const web = window.webContents;
  switch (String(action)) {
    case 'undo': web.undo(); break;
    case 'redo': web.redo(); break;
    case 'cut': web.cut(); break;
    case 'copy': web.copy(); break;
    case 'paste': web.paste(); break;
    case 'selectAll': web.selectAll(); break;
    case 'reload': web.reload(); break;
    case 'forceReload': web.reloadIgnoringCache(); break;
    case 'toggleDevTools': web.toggleDevTools(); break;
    case 'resetZoom': web.setZoomLevel(0); break;
    case 'zoomIn': web.setZoomLevel(web.getZoomLevel() + 0.5); break;
    case 'zoomOut': web.setZoomLevel(web.getZoomLevel() - 0.5); break;
    case 'toggleFullscreen': window.setFullScreen(!window.isFullScreen()); break;
    case 'toggleMaximize': window.isMaximized() ? window.unmaximize() : window.maximize(); break;
    case 'minimize': window.minimize(); break;
    case 'close': window.close(); break;
    case 'quit': app.quit(); break;
    case 'about': showAbout(); break;
    default: return { ok: false, reason: `unknown menu action: ${action}` };
  }
  return { ok: true };
});
ipcMain.handle('lab:stop', () => stopLab());
ipcMain.handle('lab:open-report', async () => {
  const file = latestReport();
  if (!file) return { opened: false, reason: 'no report.html yet - run a check first' };
  const error = await shell.openPath(file);
  return { opened: !error, file, error: error || null };
});
ipcMain.handle('lab:open-artifacts', async () => {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const error = await shell.openPath(artifactsDir);
  return { opened: !error, error: error || null };
});
ipcMain.handle('lab:notify', (_event, payload) => {
  const title = String(payload?.title ?? 'DSH Plugin Effect Lab');
  const body = String(payload?.body ?? '');
  const supported = typeof Notification.isSupported === 'function' ? Notification.isSupported() === true : true;
  if (!supported) return { shown: false, supported: false };
  try {
    new Notification({ title, body }).show();
    return { shown: true, supported: true };
  } catch (error) {
    return { shown: false, supported, error: String(error?.message ?? error) };
  }
});

ipcMain.handle('lab:profiles', () => listProfiles());
ipcMain.handle('lab:real-profiles', () => realProfiles());

/**
 * Resolve a profile directory through the lab CLI (`profile path <name>`), then
 * open it in Explorer. The renderer never joins paths itself.
 */
ipcMain.handle('lab:open-profile-dir', async (_event, name) => {
  const safe = String(name ?? '');
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(safe)) return { opened: false, error: 'invalid profile name' };
  const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'lab.js'), 'profile', 'path', safe], {
    cwd: repo,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_LAB_GUI: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error) return { opened: false, error: String(result.error.message ?? result.error) };
  if (result.status !== 0) return { opened: false, error: (result.stderr || '').trim() || `exit ${result.status}` };
  const dir = result.stdout.trim();
  if (!dir) return { opened: false, error: 'profile path is empty' };
  const error = await shell.openPath(dir);
  return { opened: !error, dir, error: error || null };
});

ipcMain.handle('lab:info', () => ({
  repo,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  latestReport: latestReport(),
}));

app.whenReady().then(() => {
  // A light native theme keeps the title/menu strip light so it blends with the
  // white page instead of picking up the OS dark palette.
  nativeTheme.themeSource = 'light';
  if (buildMenuTemplate) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({
      appName: 'DSH Plugin Effect Lab',
      onAbout: showAbout,
    })));
  }
  if (syncAppFiles) {
    syncAppFiles({ sourceDir: path.join(repo, 'src', 'gui'), appDir: __dirname, log: appendLog });
  }
  window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#ffffff',
    title: 'DSH Plugin Effect Lab',
    // The native title bar follows the Windows accent colour, which broke the
    // all-white look. A window-controls overlay lets us pin it to white while
    // keeping the standard minimise/maximise/close buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#1f2329', height: 36 },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // The visible menu is drawn in the page; the app menu stays only so its
  // accelerators (Ctrl+C/V/R, Ctrl+Shift+I, zoom) keep working.
  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, 'index.html'));
  // Surface renderer-side errors in gui.log so a broken UI is diagnosable.
  window.webContents.on('console-message', (...args) => {
    const event = args[0];
    const level = typeof event?.level === 'string' ? event.level : args[1];
    const message = typeof event?.message === 'string' ? event.message : args[2];
    if (level === 'error' || level === 3) appendLog(`[renderer] ${message}\n`);
  });
  window.on('closed', () => {
    window = null;
  });
});

app.on('window-all-closed', () => {
  stopLab();
  app.exit(0);
});
