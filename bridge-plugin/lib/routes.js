import { timingSafeEqual } from 'node:crypto';

/**
 * The bridge's only route: POST /dsh-lab-bridge/launch.
 *
 * It starts the lab's own Electron GUI through a fixed launcher (bin/lab.js
 * gui, no caller argv). Every request must come from loopback and carry the
 * per-host nonce injected into the renderer.
 */

const DEFAULT_PREFIX = '/dsh-lab-bridge';

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload, null, 2));
}

export function isLoopbackRequest(req) {
  const address = String(req?.socket?.remoteAddress ?? '');
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function tokenFromRequest(req) {
  const header = req?.headers?.['x-dsh-lab-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  const auth = req?.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

export function tokensMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (actual.length === 0 || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function authorize(req, res, getToken) {
  if (!isLoopbackRequest(req)) {
    json(res, 403, { error: 'dsh-lab-bridge is loopback-only' });
    return false;
  }
  if (!tokensMatch(tokenFromRequest(req), getToken?.())) {
    json(res, 401, { error: 'missing or invalid launch nonce' });
    return false;
  }
  return true;
}

export function createBridgeRouteHandler({ getConfig, getToken = () => null, launcher = null }) {
  return async function handleBridgeRequest(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://bridge.local').pathname;
    } catch {
      res.statusCode = 400;
      res.end('bad request');
      return;
    }
    let prefix = DEFAULT_PREFIX;
    try { prefix = getConfig?.()?.routePrefix ?? prefix; } catch { /* launcher reports config errors */ }
    const rest = pathname === prefix ? '' : pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : null;
    if (rest === null) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    if (!isLoopbackRequest(req)) {
      json(res, 403, { error: 'dsh-lab-bridge is loopback-only' });
      return;
    }
    const method = (req.method || 'GET').toUpperCase();
    if (rest === '/launch' && method === 'POST') {
      if (!authorize(req, res, getToken)) return;
      if (typeof launcher !== 'function') {
        json(res, 503, { error: 'launcher is not available' });
        return;
      }
      try {
        const launched = await launcher();
        json(res, 202, { launched });
      } catch (error) {
        if (error?.code === 'LAUNCH_THROTTLED') {
          json(res, 429, { error: String(error?.message ?? error) });
          return;
        }
        json(res, 500, { error: String(error?.message ?? error) });
      }
      return;
    }
    if (rest === '/launch') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.end('method not allowed');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  };
}
