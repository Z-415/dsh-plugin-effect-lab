'use strict';

/**
 * DSH Plugin Effect Lab desktop launcher.
 *
 * Runs the same `bin/lab.js` commands the CLI exposes, streams their output
 * into the window, and opens the generated HTML reports. It never talks to the
 * target runtime itself: every action is a child `lab.js` process, so the GUI
 * cannot bypass the lab's isolation rules.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(process.env.DSH_LAB_GUI_CONFIG, 'utf8'));
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

ipcMain.handle('lab:run', (_event, args) => runLab(Array.isArray(args) ? args.map(String) : []));
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
ipcMain.handle('lab:info', () => ({
  repo,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  latestReport: latestReport(),
}));

app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#f5f6f8',
    title: 'DSH Plugin Effect Lab',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.on('closed', () => {
    window = null;
  });
});

app.on('window-all-closed', () => {
  stopLab();
  app.exit(0);
});
