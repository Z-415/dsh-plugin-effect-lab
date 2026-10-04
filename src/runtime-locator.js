import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RUNTIME_CMD } from './config.js';
import { runCommand } from './process-tree.js';
import { readJson } from './util.js';

export function runtimeCandidates(explicitPath) {
  const out = [];
  if (explicitPath) out.push(explicitPath);
  if (process.env.DSH_LAB_DSH_CMD) out.push(process.env.DSH_LAB_DSH_CMD);
  out.push(DEFAULT_RUNTIME_CMD);
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  if (programFiles) out.push(path.join(programFiles, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  if (programFilesX86) out.push(path.join(programFilesX86, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  if (localAppData) out.push(path.join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
  return [...new Set(out.map((value) => path.resolve(value)))];
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
