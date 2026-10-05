import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Launch the lab's own Electron GUI as a detached process.
 *
 * Fixed command only: `<node> <lab>/bin/lab.js gui`. No caller-supplied argv,
 * so this can never become an arbitrary command execution surface.
 */

export const DEFAULT_LAUNCH_THROTTLE_MS = 5000;

export function launchArgs(labEntry) {
  return [labEntry, 'gui'];
}

/** The host must not pass its Electron/real-home environment to the lab GUI. */
export function sanitizeLaunchEnv(env = process.env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.DSH_HOME;
  delete next.DSH_AGENTS_HOME;
  return next;
}

export function createGuiLauncher(options = {}) {
  const {
    getConfig,
    spawnImpl = spawn,
    now = () => Date.now(),
    throttleMs = DEFAULT_LAUNCH_THROTTLE_MS,
    exists = fs.existsSync,
    env = process.env,
  } = options;
  let lastLaunchAt = 0;
  let lastPid = null;

  return function launchGui() {
    const config = getConfig();
    const labEntry = path.join(config.labRoot, 'bin', 'lab.js');
    if (!exists(labEntry)) throw new Error(`实验舱入口不存在：${labEntry}`);
    if (!config.nodeExe || !exists(config.nodeExe)) {
      throw new Error(`Node 可执行文件不可用：${config.nodeExe ?? '(未配置)'}。请设置 nodePath 或把 Node 加入 PATH。`);
    }
    const elapsed = now() - lastLaunchAt;
    if (lastLaunchAt > 0 && elapsed < throttleMs) {
      const error = new Error(`实验舱正在启动中，请 ${Math.ceil((throttleMs - elapsed) / 1000)} 秒后再试。`);
      error.code = 'LAUNCH_THROTTLED';
      throw error;
    }
    const args = launchArgs(labEntry);
    const child = spawnImpl(config.nodeExe, args, {
      cwd: config.labRoot,
      detached: true,
      stdio: 'ignore',
      env: sanitizeLaunchEnv(env),
      windowsHide: false,
    });
    try { child.unref?.(); } catch { /* best effort */ }
    lastLaunchAt = now();
    lastPid = child.pid ?? null;
    return { pid: lastPid, nodeExe: config.nodeExe, labEntry, args };
  };
}
