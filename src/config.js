import os from 'node:os';
import path from 'node:path';

/** Official Desktop runtime launcher required by the task baseline. */
export const DEFAULT_RUNTIME_CMD = 'D:\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd';

/** The shipped `web` template: empty dependencies plus two first-party bundles. */
export const MINIMAL_WEB_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
];

/** Short temp-home prefix used for every isolated run. */
export const TEMP_PREFIX = 'dsh-lab-';

export const DEFAULT_BOOT_TIMEOUT_MS = 90_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_BROWSER_TIMEOUT_MS = 90_000;

export const REAL_HOME = path.join(os.homedir(), '.dsh');

export function defaultArtifactsRoot(cwd = process.cwd()) {
  return path.join(cwd, 'artifacts');
}
