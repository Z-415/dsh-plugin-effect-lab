import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a real Node executable for spawning the lab.
 *
 * In the DSH desktop host `process.execPath` is `DeepSeek Harness.exe`, not
 * Node: using it would launch Electron instead of the lab script. Prefer the
 * plugin config `nodePath`, then look for `node` on PATH, and fail readably.
 */
export function findNodeExecutable(options = {}) {
  const {
    nodePath,
    env = process.env,
    exists = fs.existsSync,
    platform = process.platform,
  } = options;
  const configured = typeof nodePath === 'string' && nodePath.trim() ? path.resolve(nodePath.trim()) : null;
  if (configured) {
    if (!exists(configured)) {
      throw new Error(`nodePath 不存在：${configured}。请修正插件配置，或把 Node 加入 PATH。`);
    }
    return configured;
  }
  const pathValue = String(env.PATH ?? env.Path ?? env.path ?? '');
  const separator = platform === 'win32' ? ';' : ':';
  const names = platform === 'win32' ? ['node.exe'] : ['node'];
  for (const entry of pathValue.split(separator)) {
    const dir = entry.trim().replace(/^"+|"+$/g, '');
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  throw new Error('找不到真正的 node.exe。请在插件配置里设置 nodePath，或把 Node 加入 PATH。');
}
