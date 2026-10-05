import net from 'node:net';
import { sleep } from './util.js';

/**
 * Node's fetch reports a dropped connection as `TypeError: fetch failed` with
 * the real code on `cause`. The host socket is occasionally not ready for the
 * first request right after boot, so a short retry turns that into a non-event.
 */
const RETRYABLE_NETWORK_ERRORS = /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|UND_ERR|other side closed|terminated/i;

export function isRetryableNetworkError(error) {
  const cause = error?.cause;
  const parts = [
    error?.message ?? error,
    cause?.code,
    cause?.message,
    ...(Array.isArray(cause?.errors) ? cause.errors.flatMap((item) => [item?.code, item?.message]) : []),
  ];
  return RETRYABLE_NETWORK_ERRORS.test(parts.filter(Boolean).join(' '));
}

/**
 * `fetch` with a bounded retry for connection-level failures only.
 *
 * A timeout is deliberately *not* retried: it means the server accepted the
 * connection and then stalled, and retrying would just multiply the wait. Each
 * attempt gets a fresh `AbortSignal.timeout(timeoutMs)` (a signal cannot be
 * reused once it fires). HTTP error statuses are returned as-is.
 */
export async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    retries = 2,
    delayMs = 250,
    timeoutMs = null,
    fetchImpl = fetch,
    onRetry = null,
  } = options;
  const { signal: callerSignal, ...rest } = init;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : callerSignal;
    try {
      return await fetchImpl(url, signal ? { ...rest, signal } : { ...rest });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableNetworkError(error)) throw error;
      onRetry?.({ attempt: attempt + 1, error });
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError ?? new Error('fetchWithRetry failed');
}

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
