import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RUNTIME_CMD } from './config.js';
import { runCommand } from './process-tree.js';
import { classifyRuntimeVersion } from './runtime-versions.js';
import { readJson } from './util.js';

export function runtimeCandidates(explicitPath) {
  const out = [];
  if (explicitPath) out.push(explicitPath);
  if (process.env.DSH_LAB_DSH_CMD) out.push(process.env.DSH_LAB_DSH_CMD);
  for (const extra of extraRuntimeCandidates()) out.push(extra);
  out.push(DEFAULT_RUNTIME_CMD);
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  if (programFiles) out.push(path.join(programFiles, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  if (programFilesX86) out.push(path.join(programFilesX86, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  if (localAppData) out.push(path.join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  return [...new Set(out.map((value) => path.resolve(value)))];
}

/**
 * Extra installs from `DSH_LAB_RUNTIMES` (semicolon-separated). Each entry may
 * be the launcher itself (`...\dsh.cmd`) or the install/runtime directory.
 * This is how the version matrix sees more than the one installed app.
 */
export function extraRuntimeCandidates(env = process.env) {
  const raw = String(env.DSH_LAB_RUNTIMES ?? '').trim();
  if (!raw) return [];
  return raw
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (/dsh\.cmd$/i.test(value)) return value;
      const options = [
        path.join(value, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
        path.join(value, 'runtime', 'cli', 'bin', 'dsh.cmd'),
        path.join(value, 'cli', 'bin', 'dsh.cmd'),
        path.join(value, 'bin', 'dsh.cmd'),
      ];
      return options.find((candidate) => fs.existsSync(candidate)) ?? options[0];
    });
}

/** Every distinct, existing launcher this machine can see, with its version. */
export async function discoverRuntimes(options = {}) {
  const seen = new Set();
  const out = [];
  const defaultCmd = path.resolve(DEFAULT_RUNTIME_CMD).toLowerCase();
  for (const cmd of runtimeCandidates(options.runtimePath)) {
    const key = cmd.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!fs.existsSync(cmd)) continue;
    let version = null;
    let error = null;
    try {
      const result = await readRuntimeVersion({ cmd }, { timeoutMs: options.timeoutMs ?? 60_000 });
      version = result.version;
    } catch (caught) {
      error = String(caught?.message ?? caught);
    }
    const compat = classifyRuntimeVersion(version);
    out.push({
      cmd,
      version,
      isDefault: key === defaultCmd,
      status: compat.status,
      supported: compat.supported,
      verified: compat.verified,
      detail: compat.detail,
      error,
    });
  }
  return out;
}

export function locateRuntime(explicitPath) {
  if (explicitPath && !fs.existsSync(explicitPath)) {
    throw new Error(`dsh runtime not found at the explicit path: ${path.resolve(explicitPath)}`);
  }
  const candidates = runtimeCandidates(explicitPath);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`dsh runtime not found; checked: ${candidates.join(', ')}`);
  }
  const runtimeRoot = path.resolve(path.dirname(found), '..', '..');
  const versionsFile = path.join(runtimeRoot, 'versions.json');
  let versions = null;
  if (fs.existsSync(versionsFile)) versions = readJson(versionsFile);
  return {
    cmd: found,
    installDir: path.resolve(path.dirname(found), '..', '..', '..', '..'),
    runtimeDir: runtimeRoot,
    versions,
    candidates,
  };
}

export async function readRuntimeVersion(runtime, options = {}) {
  const result = await runCommand(runtime.cmd, ['--version'], {
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  const version = `${result.stdout}${result.stderr}`.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? null;
  return { ...result, version };
}
