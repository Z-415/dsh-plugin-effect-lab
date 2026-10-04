import net from 'node:net';
import { sleep } from './util.js';

/** True when a TCP connection to host:port succeeds. */
export function canConnect(port, options = {}) {
  const { host = '127.0.0.1', timeoutMs = 1200 } = options;
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export async function waitForPortListening(port, timeoutMs = 60_000, options = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canConnect(port, options)) return true;
    await sleep(300);
  }
  return false;
}

export async function waitForPortFree(port, timeoutMs = 20_000, options = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await canConnect(port, options))) return true;
    await sleep(300);
  }
  return false;
}
