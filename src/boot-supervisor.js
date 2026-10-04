import path from 'node:path';
import { waitForPortFree, waitForPortListening } from './net-utils.js';
import { parseWebUrl } from './port-and-token.js';
import { spawnTracked, stopTracked } from './process-tree.js';
import { sleep, tail } from './util.js';

/**
 * Boot one isolated `dsh web` on an OS-assigned port.
 * Only the official launcher is invoked; the profile and home are caller-owned.
 */
export async function bootWeb(options) {
  const {
    runtime,
    home,
    agentsHome,
    profileDir,
    profileName,
    timeoutMs = 90_000,
    env = {},
    tmpDir = path.join(path.dirname(home), 'tmp'),
    onLine,
  } = options;
  if (!runtime?.cmd) throw new Error('bootWeb needs a located runtime');
  const childEnv = {
    ...process.env,
    DSH_HOME: home,
    ...(agentsHome ? { DSH_AGENTS_HOME: agentsHome } : {}),
    DSH_TELEMETRY_DISABLED: '1',
    TEMP: tmpDir,
    TMP: tmpDir,
    ...env,
  };
  const tracked = spawnTracked(
    runtime.cmd,
    ['--profile', profileName, '--no-open', '--port', '0'],
    {
      cwd: profileDir,
      env: childEnv,
      onStdout: (line) => onLine?.('stdout', line),
      onStderr: (line) => onLine?.('stderr', line),
    },
  );
  const startedAt = Date.now();
  let parsed = null;
  while (Date.now() - startedAt < timeoutMs) {
    const { stdout, stderr } = tracked.getOutput();
    parsed = parseWebUrl(`${stdout}\n${stderr}`);
    if (parsed) break;
    if (tracked.child.exitCode !== null) {
      const { stdout: out, stderr: err } = tracked.getOutput();
      throw new Error(
        `dsh exited before publishing the web URL (code ${tracked.child.exitCode})\n${tail(`${out}\n${err}`, 6000)}`,
      );
    }
    await sleep(200);
  }
  if (!parsed) {
    await stopTracked(tracked, { label: 'boot timeout' });
    const { stdout, stderr } = tracked.getOutput();
    throw new Error(`timed out waiting for the dsh web URL\n${tail(`${stdout}\n${stderr}`, 6000)}`);
  }
  const listening = await waitForPortListening(parsed.port, 15_000);
  return {
    ...parsed,
    startedAt,
    tracked,
    pid: tracked.pid,
    listening,
    getOutput: tracked.getOutput,
    async stop() {
      const result = await stopTracked(tracked, { label: `dsh pid ${tracked.pid}` });
      const freed = await waitForPortFree(parsed.port, 20_000);
      return { ...result, port: parsed.port, portFreed: freed };
    },
  };
}
