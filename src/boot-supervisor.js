import fs from 'node:fs';
import path from 'node:path';
import { waitForPortFree, waitForPortListening } from './net-utils.js';
import { parseWebUrl } from './port-and-token.js';
import { spawnTracked, stopTracked } from './process-tree.js';
import { sleep, tail } from './util.js';

/** How long to keep waiting for the host's IPC `ready` once stdout has the URL. */
const IPC_GRACE_MS = 2000;

function hostArgs(profileName) {
  return ['--profile', profileName, '--no-open', '--port', '0'];
}

/**
 * `dsh.cmd` is a batch file that ends up running
 *
 *   "<install>\DeepSeek Harness.exe" --expose-internals
 *   "<install>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" <args>
 *
 * with `ELECTRON_RUN_AS_NODE=1`. Reading those two paths out of the launcher
 * lets the lab spawn the host with an **IPC channel**, which is how the desktop
 * app receives its typed boot rows (`{ type: 'ready', url, injections }`); a
 * channel handed to `cmd.exe` never reaches the Node process.
 *
 * Returns null when the launcher is not that shape, so the caller can fall back
 * to parsing stdout (the pre-existing path).
 */
export function resolveHostLauncher(runtime) {
  if (!runtime?.cmd || !/\.(cmd|bat)$/i.test(runtime.cmd)) return null;
  let text;
  try {
    text = fs.readFileSync(runtime.cmd, 'utf8');
  } catch {
    return null;
  }
  const base = `${path.dirname(runtime.cmd)}${path.sep}`;
  const expanded = text.replace(/%~dp0/gi, base).replace(/%dp0%/gi, base);
  if (!/--expose-internals/i.test(expanded)) return null;
  const quoted = [...expanded.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const exe = quoted.find((candidate) => /\.exe$/i.test(candidate));
  const entry = quoted.find((candidate) => /\.(?:cjs|mjs|js)$/i.test(candidate));
  if (!exe || !entry) return null;
  return { exe: path.resolve(exe), entry: path.resolve(entry) };
}

/**
 * Boot one isolated `dsh web` on an OS-assigned port.
 *
 * Only the official launcher is invoked; the profile and home are caller-owned.
 * The preferred transport spawns the host directly with an IPC channel and
 * receives `{ type: 'ready', url, injections }`; when the launcher does not have
 * the expected shape (or the message never arrives) it falls back to spawning
 * `dsh.cmd` and parsing the readiness line from stdout.
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
    // 'stdout' is the default because the isolated `dsh web` app does not send
    // the desktop host's IPC ready message; 'ipc' is available explicitly for a
    // launcher that does (see docs/ELECTRON-SHELL.md).
    transport: requestedTransport = 'stdout',
  } = options;
  if (!runtime?.cmd) throw new Error('bootWeb needs a located runtime');
  const childEnvVars = {
    ...process.env,
    DSH_HOME: home,
    ...(agentsHome ? { DSH_AGENTS_HOME: agentsHome } : {}),
    DSH_TELEMETRY_DISABLED: '1',
    TEMP: tmpDir,
    TMP: tmpDir,
    ...env,
  };

  const launcher = requestedTransport === 'ipc' ? resolveHostLauncher(runtime) : null;
  const spawnOptions = {
    cwd: profileDir,
    env: childEnvVars,
    onStdout: (line) => onLine?.('stdout', line),
    onStderr: (line) => onLine?.('stderr', line),
  };
  let timed;
  let usedTransport = 'stdout';
  let readyMessage = null;
  if (launcher) {
    usedTransport = 'ipc';
    timed = spawnTracked(
      launcher.exe,
      ['--expose-internals', launcher.entry, ...hostArgs(profileName)],
      { ...spawnOptions, ipc: true, runAsNode: true },
    );
    timed.child.on('message', (message) => {
      if (message && message.type === 'ready' && typeof message.url === 'string') {
        readyMessage = message;
      }
    });
  } else {
    timed = spawnTracked(runtime.cmd, hostArgs(profileName), spawnOptions);
  }

  const startedAt = Date.now();
  let parsed = null;
  let injections = null;
  let stdoutSeenAt = null;
  let fallbackReason = launcher
    ? null
    : requestedTransport === 'ipc'
      ? 'launcher is not the expected batch shape'
      : 'ipc transport not requested';
  while (Date.now() - startedAt < timeoutMs) {
    if (readyMessage) {
      parsed = parseWebUrl(`dsh web: ${readyMessage.url}`);
      injections = Array.isArray(readyMessage.injections) ? readyMessage.injections : [];
      usedTransport = 'ipc';
      break;
    }
    const { stdout, stderr } = timed.getOutput();
    const fromStdout = parseWebUrl(`${stdout}\n${stderr}`);
    if (fromStdout) {
      if (usedTransport === 'ipc') {
        // Give the IPC message a short grace window before degrading.
        stdoutSeenAt ??= Date.now();
        if (Date.now() - stdoutSeenAt >= IPC_GRACE_MS) {
          parsed = fromStdout;
          usedTransport = 'stdout';
          fallbackReason = 'host never sent the IPC ready message';
          break;
        }
      } else {
        parsed = fromStdout;
        break;
      }
    }
    if (timed.child.exitCode !== null) {
      const { stdout: out, stderr: err } = timed.getOutput();
      throw new Error(
        `dsh exited before publishing the web URL (code ${timed.child.exitCode})\n${tail(`${out}\n${err}`, 6000)}`,
      );
    }
    await sleep(200);
  }
  if (!parsed) {
    await stopTracked(timed, { label: 'boot timeout' });
    const { stdout, stderr } = timed.getOutput();
    throw new Error(`timed out waiting for the dsh web URL\n${tail(`${stdout}\n${stderr}`, 6000)}`);
  }
  const listening = await waitForPortListening(parsed.port, 15_000);
  return {
    ...parsed,
    startedAt,
    tracked: timed,
    pid: timed.pid,
    listening,
    transport: usedTransport,
    transportRequested: requestedTransport,
    fallbackReason,
    injections,
    injectionKinds: injections ? [...new Set(injections.map((row) => row?.kind ?? 'unknown'))] : [],
    getOutput: timed.getOutput,
    async stop() {
      const result = await stopTracked(timed, { label: `dsh pid ${timed.pid}` });
      const freed = await waitForPortFree(parsed.port, 20_000);
      return { ...result, port: parsed.port, portFreed: freed };
    },
  };
}
