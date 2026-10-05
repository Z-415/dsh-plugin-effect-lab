import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { readArtifactFile, readLatestReport } from './artifacts-store.js';
import { listProfiles, normalizeProfileLab } from './lab-profiles.js';
import { summarizeReport } from './report-summary.js';
import { BridgeBusyError, publicJobView } from './verify-controller.js';

/**
 * Same-origin report routes.
 *
 *   GET /dsh-lab-bridge/                      -> endpoint index
 *   GET /dsh-lab-bridge/latest.json           -> compact summary of the latest run
 *   GET /dsh-lab-bridge/latest/report.html    -> latest report.html
 *   GET /dsh-lab-bridge/latest/report.json    -> latest report.json
 *   GET /dsh-lab-bridge/latest/report.md      -> latest report.md
 *   GET /dsh-lab-bridge/latest/<artifact path>-> any other file inside the latest run dir
 *
 * When no run exists yet the report route still answers 200 with a small
 * placeholder page. That keeps the plugin-contract route probe green before the
 * tool has ever been called, and it is deliberately honest about having no data.
 */

const REPORT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "script-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

/** Artifact MIME whitelist. Anything else is refused instead of sniffed. */
const SERVABLE_TYPES = new Set([
  'text/html',
  'text/plain',
  'text/markdown',
  'text/css',
  'text/javascript',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
]);

function baseType(contentType) {
  return String(contentType ?? '').split(';')[0].trim().toLowerCase();
}

function isServable(contentType) {
  return SERVABLE_TYPES.has(baseType(contentType));
}

function needsCsp(contentType) {
  const type = baseType(contentType);
  return type.startsWith('text/') || type === 'image/svg+xml';
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload, null, 2));
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', REPORT_CSP);
  res.end(body);
}

/** Only actual loopback peers may reach any bridge route. */
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

/** Control routes require both a loopback peer and the injected token. */
function authorizeControl(req, res, getToken) {
  if (!isLoopbackRequest(req)) {
    json(res, 403, { error: 'control plane is loopback-only' });
    return false;
  }
  if (!tokensMatch(tokenFromRequest(req), getToken?.())) {
    json(res, 401, { error: 'missing or invalid control token' });
    return false;
  }
  return true;
}

function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('request body too large'));
        return;
      }
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

function placeholderPage(message) {
  const text = String(message ?? '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>实验舱桥接报告</title></head>
<body>
<h1>还没有实验舱报告</h1>
<p>${text}</p>
<p>请在 DSH 的「实验舱桥接」面板里发起验证；本页只读，关闭标签页或返回上一页即可回到 DSH。</p>
</body>
</html>
`;
}

/**
 * Build the loopback origin from the request Host so the client can hand an
 * http:// URL to the OS browser (the shell denies dsh-app:// window opens).
 * Only a loopback Host is accepted; anything else yields null.
 */
export function loopbackOrigin(req) {
  const host = String(req?.headers?.host ?? '').trim();
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/i.test(host)) return null;
  return `http://${host}`;
}

/** The latest run's directory *name* relative to the artifacts root. */
function latestRunName(artifactsDir) {
  const latest = readLatestReport(artifactsDir);
  if (!latest) return null;
  return path.relative(path.resolve(artifactsDir), latest.runDir) || null;
}

/**
 * Build the request handler. All config resolution is deferred to request
 * time through `getConfig`, so plugin startup stays cheap.
 */
export function createBridgeRouteHandler({ getConfig, controller = null, getToken = () => null, shellLauncher = null }) {
  return async function handleBridgeRequest(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://bridge.local').pathname;
    } catch {
      res.statusCode = 400;
      res.end('bad request');
      return;
    }
    let config;
    try {
      config = getConfig();
    } catch (error) {
      json(res, 500, { error: String(error?.message ?? error) });
      return;
    }
    const prefix = config.routePrefix;
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

    // --- Control plane (POST + token + loopback) -------------------------
    if (rest === '/verify' && method === 'POST') {
      if (!authorizeControl(req, res, getToken)) return;
      if (!controller) {
        json(res, 503, { error: 'control plane is not available' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        json(res, 400, { error: String(error?.message ?? error) });
        return;
      }
      const plugin = typeof body?.plugin === 'string' ? body.plugin.trim() : '';
      if (!plugin || plugin.length > 4096) {
        json(res, 400, { error: 'plugin must be a non-empty spec string (<= 4096 chars)' });
        return;
      }
      let profileLab = null;
      try {
        profileLab = normalizeProfileLab(body?.profileLab);
      } catch (error) {
        json(res, 400, { error: String(error?.message ?? error) });
        return;
      }
      try {
        const job = controller.start({ plugin, online: body?.online === true, profileLab });
        json(res, 202, { job: publicJobView(job) });
      } catch (error) {
        if (error instanceof BridgeBusyError) {
          json(res, 409, { error: error.message });
          return;
        }
        json(res, 500, { error: String(error?.message ?? error) });
      }
      return;
    }
    if (rest === '/verify/status' && (method === 'GET' || method === 'HEAD')) {
      if (!authorizeControl(req, res, getToken)) return;
      json(res, 200, { job: publicJobView(controller?.status?.() ?? null) });
      return;
    }
    if (rest === '/verify/cancel' && method === 'POST') {
      if (!authorizeControl(req, res, getToken)) return;
      json(res, 200, { job: publicJobView(controller?.cancel?.() ?? null) });
      return;
    }
    if (rest === '/shell' && method === 'POST') {
      if (!authorizeControl(req, res, getToken)) return;
      if (typeof shellLauncher !== 'function') {
        json(res, 503, { error: 'shell launcher is not available' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        json(res, 400, { error: String(error?.message ?? error) });
        return;
      }
      const plugin = typeof body?.plugin === 'string' ? body.plugin.trim() : '';
      if (plugin.length > 4096) {
        json(res, 400, { error: 'plugin must be <= 4096 chars' });
        return;
      }
      let profileLab = null;
      try {
        profileLab = normalizeProfileLab(body?.profileLab);
      } catch (error) {
        json(res, 400, { error: String(error?.message ?? error) });
        return;
      }
      const holdMs = Number(body?.holdMs);
      try {
        const launched = await shellLauncher({
          plugin,
          online: body?.online === true,
          profileLab,
          ...(Number.isFinite(holdMs) && holdMs > 0 ? { holdMs } : {}),
        });
        json(res, 202, { launched });
      } catch (error) {
        json(res, 500, { error: String(error?.message ?? error) });
      }
      return;
    }
    if (rest === '/profiles' && (method === 'GET' || method === 'HEAD')) {
      if (!authorizeControl(req, res, getToken)) return;
      json(res, 200, { profiles: listProfiles(config.profilesRoot) });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end('method not allowed');
      return;
    }
    if (rest === '' || rest === '/') {
      const origin = loopbackOrigin(req);
      json(res, 200, {
        routes: {
          summary: `${prefix}/latest.json`,
          reportHtml: `${prefix}/latest/report.html`,
          reportJson: `${prefix}/latest/report.json`,
          reportMarkdown: `${prefix}/latest/report.md`,
        },
        artifactsDir: config.artifactsDir,
        loopbackReportUrl: origin ? `${origin}${prefix}/latest/report.html` : null,
      });
      return;
    }
    if (rest === '/latest.json') {
      const origin = loopbackOrigin(req);
      const loopbackReportUrl = origin ? `${origin}${prefix}/latest/report.html` : null;
      const latest = readLatestReport(config.artifactsDir);
      if (!latest) {
        json(res, 200, {
          hasReport: false,
          ok: false,
          message: '还没有实验舱报告。先调用 lab_verify_plugin。',
          reportUrl: `${prefix}/latest/report.html`,
          loopbackReportUrl,
        });
        return;
      }
      json(res, 200, {
        hasReport: true,
        loopbackReportUrl,
        ...summarizeReport({ report: latest.report, exitCode: 0, timedOut: false }),
      });
      return;
    }
    const reportPrefix = '/latest/';
    if (rest.startsWith(reportPrefix)) {
      const relative = rest.slice(reportPrefix.length);
      const runName = latestRunName(config.artifactsDir);
      const artifact = runName ? readArtifactFile(config.artifactsDir, path.join(runName, relative)) : null;
      if (!artifact) {
        if (relative === 'report.html') {
          html(res, 200, placeholderPage('还没有任何一次验证产物。'));
          return;
        }
        res.statusCode = 404;
        res.end('no report');
        return;
      }
      if (!isServable(artifact.contentType)) {
        res.statusCode = 415;
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end('unsupported media type');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (needsCsp(artifact.contentType)) res.setHeader('Content-Security-Policy', REPORT_CSP);
      if (method === 'HEAD') {
        res.setHeader('Content-Length', String(artifact.body.length));
        res.end();
        return;
      }
      res.end(artifact.body);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  };
}

export { REPORT_CSP };
