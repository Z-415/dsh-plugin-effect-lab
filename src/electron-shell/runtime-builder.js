import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PREFIX = 'dsh-lab-electron-';

export const COPY_FILES = [
  'DeepSeek Harness.exe',
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'd3dcompiler_47.dll',
  'dxcompiler.dll',
  'dxil.dll',
  'ffmpeg.dll',
  'icudtl.dat',
  'libEGL.dll',
  'libGLESv2.dll',
  'resources.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'version',
  'vk_swiftshader_icd.json',
  'vk_swiftshader.dll',
  'vulkan-1.dll',
];

export const COPY_DIRS = ['locales'];

/** Files copied into the cached app dir; refreshed when their source changes. */
export const APP_FILES = ['main.js', 'preload.js', 'desktop-bridge.cjs', 'close-policy.cjs'];

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
 * Build a cached, copied Electron runtime with our minimal app in
 * `resources/app`. The official installation is only read.
 */
export async function buildShellRuntime(officialInstallDir, options = {}) {
  const { force = false } = options;
  const version = fs.readFileSync(path.join(officialInstallDir, 'version'), 'utf8').trim();
  const dir = path.join(os.tmpdir(), `${CACHE_PREFIX}${version}`);
  const appDir = path.join(dir, 'resources', 'app');
  const exe = path.join(dir, 'DeepSeek Harness.exe');
  const stamp = path.join(dir, '.dsh-lab-ready');
  const sources = new Map(APP_FILES.map((name) => [name, fs.readFileSync(path.join(here, name))]));
  const cachedFiles = new Map(APP_FILES.map((name) => [name, path.join(appDir, name)]));
  if (!force && fs.existsSync(stamp) && fs.existsSync(exe) && APP_FILES.every((name) => fs.existsSync(cachedFiles.get(name)))) {
    for (const name of APP_FILES) {
      const cached = fs.readFileSync(cachedFiles.get(name));
      if (!cached.equals(sources.get(name))) fs.writeFileSync(cachedFiles.get(name), sources.get(name));
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
    fs.copyFileSync(source, path.join(dir, name));
    bytes += fs.statSync(source).size;
  }
  for (const name of COPY_DIRS) {
    const source = path.join(officialInstallDir, name);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(dir, name), { recursive: true });
    bytes += directorySize(source);
  }
  for (const name of APP_FILES) fs.writeFileSync(cachedFiles.get(name), sources.get(name));
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-lab-electron-shell', version: '0.1.0', private: true, main: 'main.js' }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(stamp, `${new Date().toISOString()}\n`, 'utf8');
  return { dir, exe, appDir, version, cached: false, bytes, copyMs: Date.now() - started };
}
