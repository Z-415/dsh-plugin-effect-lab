import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { COPY_DIRS, COPY_FILES } from '../electron-shell/runtime-builder.js';

const require = createRequire(import.meta.url);
const { APP_FILES } = require('./app-sync.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));

/** The copied executable is renamed so the shortcut is self-explanatory. */
export const GUI_EXE_NAME = 'DSH Plugin Effect Lab.exe';
/** One source of truth: the launcher syncs the same list at every start. */
export const GUI_APP_FILES = APP_FILES;

/**
 * Home for the copied runtime. It deliberately lives *inside the project*
 * rather than under %LOCALAPPDATA%: the lab is often run from a packaged host
 * (for example the Codex app), where %LOCALAPPDATA% is redirected into that
 * package's sandbox and a Desktop shortcut to it cannot be opened normally.
 */
export function guiRuntimeBase() {
  if (process.env.DSH_LAB_GUI_HOME) return path.resolve(process.env.DSH_LAB_GUI_HOME);
  return path.resolve(here, '..', '..', 'gui-runtime');
}

export function guiRuntimeDir(officialInstallDir) {
  const version = fs.readFileSync(path.join(officialInstallDir, 'version'), 'utf8').trim();
  return path.join(guiRuntimeBase(), `gui-${version}`);
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/**
 * Copy the official Electron runtime once into LOCALAPPDATA and drop the GUI
 * app beside it. The official install is only read; nothing is modified.
 */
export async function buildGuiRuntime(officialInstallDir, options = {}) {
  const { force = false } = options;
  const version = fs.readFileSync(path.join(officialInstallDir, 'version'), 'utf8').trim();
  const dir = path.join(guiRuntimeBase(), `gui-${version}`);
  const appDir = path.join(dir, 'resources', 'app');
  const exe = path.join(dir, GUI_EXE_NAME);
  const stamp = path.join(dir, '.dsh-lab-gui-ready');

  const appSources = Object.fromEntries(
    GUI_APP_FILES.map((name) => [name, fs.readFileSync(path.join(here, name))]),
  );
  // The stamp proves a full copy finished. App files are then refreshed file
  // by file, including ones a newer build added, so shipping a new GUI file
  // never forces the 346 MB copy again (and never needs the window closed).
  const cached = !force
    && fs.existsSync(stamp)
    && fs.existsSync(exe)
    && fs.existsSync(appDir);
  if (cached) {
    for (const [name, bytes] of Object.entries(appSources)) {
      const target = path.join(appDir, name);
      const same = fs.existsSync(target) && fs.readFileSync(target).equals(bytes);
      if (!same) fs.writeFileSync(target, bytes);
    }
    return { dir, exe, appDir, version, cached: true, bytes: 0, copyMs: 0 };
  }

  const started = Date.now();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  let bytes = 0;
  for (const name of COPY_FILES) {
    const source = path.join(officialInstallDir, name);
    if (!fs.existsSync(source)) continue;
    const target = name === 'DeepSeek Harness.exe' ? exe : path.join(dir, name);
    fs.copyFileSync(source, target);
    bytes += fs.statSync(source).size;
  }
  for (const name of COPY_DIRS) {
    const source = path.join(officialInstallDir, name);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(dir, name), { recursive: true });
    bytes += directorySize(source);
  }
  for (const [name, contents] of Object.entries(appSources)) fs.writeFileSync(path.join(appDir, name), contents);
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-plugin-effect-lab-gui', version: '0.1.0', private: true, main: 'main.js' }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(stamp, `${new Date().toISOString()}\n`, 'utf8');
  return { dir, exe, appDir, version, cached: false, bytes, copyMs: Date.now() - started };
}
