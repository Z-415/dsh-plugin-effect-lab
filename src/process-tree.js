import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { sleep } from './util.js';

/**
 * Environment for a spawned child.
 *
 * `ELECTRON_RUN_AS_NODE` makes an Electron binary behave as plain Node. The GUI
 * launcher sets it to run `bin/lab.js`, but it must never leak into the
 * grandchildren: the lab's own Electron shell would then start as Node, run
 * `main.js` without a browser process, and never show a window.
 */
export function childEnv(overrides) {
  const env = overrides ? { ...process.env, ...overrides } : { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Quote one argv element for cmd.exe. */
export function quoteForCmd(value) {
  const text = String(value);
  if (!/[\s"&|<>^()%!]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Resolve spawn parameters for an executable. Windows `.cmd`/`.bat` launchers
 * must run through cmd.exe; ordinary executables are spawned directly.
 */
export function resolveCommand(file, args = [], platform = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const inner = `"${file}"${args.length ? ` ${args.map(quoteForCmd).join(' ')}` : ''}`;
    // cmd /c strips one outer quote pair; the doubled wrapper keeps a quoted
    // launcher path intact when it contains spaces.
    const line = `"${inner}"`;
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', line] };
  }
  return { file, args };
}

/** Run a command with a hard timeout. Never rejects on a nonzero exit code. */
export function runCommand(file, args = [], options = {}) {
  const { cwd, env, timeoutMs = 120_000, input } = options;
  return new Promise((resolve, reject) => {
    const resolved = resolveCommand(file, args);
    const started = Date.now();
    const child = spawn(resolved.file, resolved.args, {
      cwd,
      env: childEnv(env),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: process.platform === 'win32' && /cmd\.exe$/i.test(resolved.file),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        file,
        args,
      });
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

/**
 * Start a long-lived child and capture stdout/stderr as text.
 * The returned handle owns the child; only these tracked PIDs are killed.
 */
export function spawnTracked(file, args = [], options = {}) {
  const { cwd, env, onStdout, onStderr } = options;
  const resolved = resolveCommand(file, args);
  const child = spawn(resolved.file, resolved.args, {
    cwd,
    env: childEnv(env),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsVerbatimArguments: process.platform === 'win32' && /cmd\.exe$/i.test(resolved.file),
  });
  let stdout = '';
  let stderr = '';
  const outLines = [];
  const errLines = [];
  const splitLines = (text, push) => {
    const parts = text.split(/\r?\n/);
    for (const line of parts.slice(0, -1)) push(line);
    return parts.at(-1) ?? '';
  };
  let outRest = '';
  let errRest = '';
  child.stdout?.on('data', (chunk) => {
    const text = String(chunk);
    stdout += text;
    outRest += text;
    outRest = splitLines(outRest, (line) => {
      outLines.push({ at: new Date().toISOString(), line });
      onStdout?.(line);
    });
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    stderr += text;
    errRest += text;
    errRest = splitLines(errRest, (line) => {
      errLines.push({ at: new Date().toISOString(), line });
      onStderr?.(line);
    });
  });
  const exitPromise = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
  return {
    child,
    pid: child.pid,
    getOutput: () => ({ stdout, stderr, outLines, errLines }),
    exit: exitPromise,
  };
}

/** Kill a process tree. On Windows this is taskkill /T /F. */
export function killTree(pid, platform = process.platform) {
  if (!pid) return { killed: false, detail: 'no pid' };
  if (platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return {
      killed: result.status === 0,
      detail: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    };
  }
  try {
    process.kill(pid, 'SIGKILL');
    return { killed: true, detail: 'SIGKILL' };
  } catch (error) {
    return { killed: false, detail: String(error) };
  }
}

/** Graceful terminate, then force-kill the tracked tree. */
export async function stopTracked(tracked, options = {}) {
  const { graceMs = 2500, label = 'process' } = options;
  const child = tracked?.child;
  if (!child) return { alreadyExited: true, forced: false, detail: 'no child' };
  if (child.exitCode !== null) {
    return { alreadyExited: true, forced: false, detail: 'already exited' };
  }
  if (process.platform === 'win32') {
    // Kill the tree while cmd.exe is still alive. Killing the wrapper first
    // would orphan the Electron grandchild and lose the /T relationship.
    const forced = killTree(child.pid);
    await Promise.race([
      once(child, 'exit').then(() => true),
      sleep(5000).then(() => false),
    ]);
    return { alreadyExited: false, forced: true, detail: `${label}: ${forced.detail}` };
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Fall through to the forced tree kill.
  }
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    sleep(graceMs).then(() => false),
  ]);
  if (exited) return { alreadyExited: false, forced: false, detail: 'SIGTERM accepted' };
  const forced = killTree(child.pid);
  await Promise.race([
    once(child, 'exit').then(() => true),
    sleep(3000).then(() => false),
  ]);
  return { alreadyExited: false, forced: true, detail: `${label}: ${forced.detail}` };
}
