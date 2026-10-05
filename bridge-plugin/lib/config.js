import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findNodeExecutable } from './node-locator.js';

/**
 * Path resolution for the bridge.
 *
 * Priority for the lab root:
 *   1. plugin config `labPath`
 *   2. environment `DSH_LAB_HOME`
 *   3. co-located monorepo fallback: the lab is the parent directory of this
 *      package (works because the official CLI installs local directory
 *      plugins as junctions, so import.meta.url points at the real source)
 *   4. explicit error that says how to configure it
 *
 * The tool never passes `--profile-lab` and never points `DSH_HOME` at a real
 * home; the lab keeps its own temporary isolated home behavior.
 */

export const DEFAULT_ARTIFACTS_DIRNAME = 'dsh-lab-bridge-artifacts';
export const DEFAULT_TIMEOUT_MS = 240_000;

const ENTRY_RELATIVE = path.join('bin', 'lab.js');

export class LabConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LabConfigError';
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Accept either a lab root directory or a direct path to `bin/lab.js`.
 * @returns {{ labRoot: string, labEntry: string }}
 */
export function resolveLabEntry(rawValue) {
  const value = nonEmptyString(rawValue);
  if (!value) {
    throw new LabConfigError(
      '未配置实验舱路径。请在插件配置里设置 labPath，或设置环境变量 DSH_LAB_HOME 指向 dsh-plugin-effect-lab 仓库根目录（例如 C:\\path\\to\\dsh-plugin-effect-lab）。',
    );
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new LabConfigError(`实验舱路径不存在：${resolved}。请设置 labPath 或 DSH_LAB_HOME 指向 dsh-plugin-effect-lab 仓库根目录。`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    if (path.basename(resolved) !== 'lab.js') {
      throw new LabConfigError(`labPath 指向的文件不是 lab.js：${resolved}。请指向仓库根目录或 <lab>/bin/lab.js。`);
    }
    return { labRoot: path.dirname(path.dirname(resolved)), labEntry: resolved };
  }
  const entry = path.join(resolved, ENTRY_RELATIVE);
  if (!fs.existsSync(entry)) {
    throw new LabConfigError(`实验舱目录里缺少 ${ENTRY_RELATIVE}：${entry}。请确认 labPath/DSH_LAB_HOME 指向 dsh-plugin-effect-lab 仓库根目录。`);
  }
  return { labRoot: resolved, labEntry: entry };
}

function resolveArtifactsDir(config, env, labRoot) {
  const configured = nonEmptyString(config?.artifactsDir) ?? nonEmptyString(env.DSH_LAB_BRIDGE_ARTIFACTS);
  if (configured) return path.resolve(configured);
  void labRoot;
  return path.join(os.tmpdir(), DEFAULT_ARTIFACTS_DIRNAME);
}

/**
 * Best-effort detection for the co-located layout `<repo>/bridge-plugin`.
 * Returns the lab root only when `<parent>/bin/lab.js` really exists.
 */
export function detectLabRootFromPackage(packageDir) {
  const value = nonEmptyString(packageDir);
  if (!value) return null;
  const parent = path.dirname(path.resolve(value));
  return fs.existsSync(path.join(parent, ENTRY_RELATIVE)) ? parent : null;
}

function resolveTimeoutMs(rawValue) {
  if (rawValue === undefined || rawValue === null) return DEFAULT_TIMEOUT_MS;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new LabConfigError(`timeoutMs 必须是正数，收到：${String(rawValue)}`);
  }
  return value;
}

/**
 * Resolve the full bridge configuration. Pure apart from filesystem existence
 * checks on the resolved paths.
 *
 * @param {object} [config] plugin row config
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveBridgeConfig(config = {}, env = process.env, options = {}) {
  const rawLabPath = nonEmptyString(config?.labPath)
    ?? nonEmptyString(env.DSH_LAB_HOME)
    ?? detectLabRootFromPackage(options.packageDir);
  const { labRoot, labEntry } = resolveLabEntry(rawLabPath);
  return {
    labRoot,
    labEntry,
    nodeExe: findNodeExecutable({ nodePath: config?.nodePath, env }),
    artifactsDir: resolveArtifactsDir(config, env, labRoot),
    timeoutMs: resolveTimeoutMs(config?.timeoutMs),
    routePrefix: '/dsh-lab-bridge',
  };
}
