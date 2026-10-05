import fs from 'node:fs';
import path from 'node:path';
import { readArtifactFile, readLatestReport } from './artifacts-store.js';
import { summarizeReport } from './report-summary.js';

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

function placeholderPage(message) {
  const text = String(message ?? '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>实验舱桥接报告</title></head>
<body>
<h1>还没有实验舱报告</h1>
<p>${text}</p>
<p>先调用工具 <code>lab_verify_plugin</code>，完成后刷新本页。</p>
</body>
</html>
`;
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
export function createBridgeRouteHandler({ getConfig }) {
  return async function handleBridgeRequest(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end('method not allowed');
      return;
    }
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
    if (rest === '' || rest === '/') {
      json(res, 200, {
        routes: {
          summary: `${prefix}/latest.json`,
          reportHtml: `${prefix}/latest/report.html`,
          reportJson: `${prefix}/latest/report.json`,
          reportMarkdown: `${prefix}/latest/report.md`,
        },
        artifactsDir: config.artifactsDir,
      });
      return;
    }
    if (rest === '/latest.json') {
      const latest = readLatestReport(config.artifactsDir);
      if (!latest) {
        json(res, 200, {
          hasReport: false,
          ok: false,
          message: '还没有实验舱报告。先调用 lab_verify_plugin。',
          reportUrl: `${prefix}/latest/report.html`,
        });
        return;
      }
      json(res, 200, {
        hasReport: true,
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
