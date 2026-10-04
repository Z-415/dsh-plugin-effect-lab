import fs from 'node:fs';
import path from 'node:path';

/**
 * Self-contained HTML report.
 *
 * Screenshots are embedded as data URIs (capped), so the file can be opened
 * with a double click and shared without the rest of the run directory.
 */

const MAX_EMBED_BYTES = 2 * 1024 * 1024;
const MAX_TABLE_ROWS = 60;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function badge(pass, informational) {
  if (pass) return '<span class="badge pass">PASS</span>';
  if (informational) return '<span class="badge info">INFO</span>';
  return '<span class="badge fail">FAIL</span>';
}

function embedImage(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_EMBED_BYTES) return `<p class="muted">${esc(path.basename(file))} (${Math.round(stat.size / 1024)} kB, too large to embed)</p>`;
    const base64 = fs.readFileSync(file).toString('base64');
    return `<figure><img alt="${esc(path.basename(file))}" src="data:image/png;base64,${base64}"><figcaption>${esc(path.basename(file))} · ${Math.round(stat.size / 1024)} kB</figcaption></figure>`;
  } catch (error) {
    return `<p class="muted">${esc(path.basename(file))} (unreadable: ${esc(error?.message ?? error)})</p>`;
  }
}

function table(headers, rows) {
  if (!rows.length) return '<p class="muted">none</p>';
  const head = headers.map((item) => `<th>${esc(item)}</th>`).join('');
  const body = rows.slice(0, MAX_TABLE_ROWS)
    .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
    .join('');
  const extra = rows.length > MAX_TABLE_ROWS ? `<p class="muted">… ${rows.length - MAX_TABLE_ROWS} more row(s) in report.json</p>` : '';
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${extra}`;
}

function checksTable(checks) {
  const rows = checks
    .map((check) => `<tr><td>${badge(check.pass, check.informational)}</td><td>${esc(check.name)}</td><td>${esc(check.detail ?? '')}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>result</th><th>check</th><th>detail</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function diffRows(diff) {
  const rows = [];
  for (const [key, value] of Object.entries(diff?.changed ?? {})) rows.push([key, `${value.before} → ${value.after}`]);
  for (const [key, value] of Object.entries(diff?.added ?? {})) rows.push([key, `+ ${typeof value === 'object' ? JSON.stringify(value) : value}`]);
  for (const [key, value] of Object.entries(diff?.removed ?? {})) rows.push([key, `- ${typeof value === 'object' ? JSON.stringify(value) : value}`]);
  return rows;
}

function section(title, body) {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

/** Render one run (verify/capture/shell) as a standalone HTML document. */
export function renderHtmlReport(report = {}) {
  const checks = report.checks ?? [];
  const failed = checks.filter((check) => !check.pass && check.informational !== true);

  const screenshotFiles = [];
  for (const file of Object.values(report.artifacts?.screenshots ?? {})) {
    if (file && fs.existsSync(file) && !screenshotFiles.includes(file)) screenshotFiles.push(file);
  }
  for (const name of ['web-baseline', 'shell']) {
    const file = path.join(report.runDir ?? '', 'screenshots', `${name}.png`);
    if (report.runDir && fs.existsSync(file) && !screenshotFiles.includes(file)) screenshotFiles.push(file);
  }

  const parts = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>DSH Plugin Effect Lab - ${esc(report.runId ?? 'run')}</title>`,
    `<style>
      :root { color-scheme: light dark; }
      body { font: 14px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; padding: 32px; background: #f7f8fa; color: #16181d; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 15px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: .04em; color: #5a6069; }
      section { background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 18px 20px; margin: 0 0 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 13px; }
      th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
      th { color: #5a6069; font-weight: 600; }
      .summary { display: flex; gap: 20px; align-items: baseline; flex-wrap: wrap; }
      .status { font-size: 18px; font-weight: 700; }
      .status.pass { color: #0a7b3e; } .status.fail { color: #b42318; }
      .muted { color: #6b7280; font-size: 12px; }
      .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
      .badge.pass { background: #e6f6ec; color: #0a7b3e; }
      .badge.fail { background: #fde8e6; color: #b42318; }
      .badge.info { background: #eaf0fb; color: #2b4c8c; }
      figure { margin: 0 12px 12px 0; display: inline-block; vertical-align: top; max-width: 460px; }
      img { width: 100%; border: 1px solid #e3e6ea; border-radius: 6px; display: block; }
      figcaption { font-size: 12px; color: #6b7280; margin-top: 4px; }
      code { background: #f1f3f5; padding: 1px 4px; border-radius: 4px; }
    </style></head><body>`,
    '<h1>DSH Plugin Effect Lab</h1>',
    `<div class="summary">
       <span class="status ${report.ok ? 'pass' : 'fail'}">${report.ok ? 'PASS' : 'FAIL'}</span>
       <span>mode <code>${esc(report.mode ?? 'n/a')}</code></span>
       <span>run <code>${esc(report.runId ?? 'n/a')}</code></span>
       <span>dsh <code>${esc(report.runtime?.version ?? 'n/a')}</code></span>
       <span>${esc(report.startedAt ?? '')} → ${esc(report.finishedAt ?? '')}</span>
     </div>`,
    `<p class="muted">${failed.length} failing check(s), ${checks.length} total. Machine-readable detail is in <code>report.json</code>.</p>`,
  ];

  if (report.plugins?.length) {
    parts.push(section('Plugins', table(['name', 'version', 'source', 'fixture', 'blockers'], report.plugins.map((plugin) => [
      plugin.name, plugin.version ?? '', plugin.source ?? '', plugin.fixture === true ? 'yes' : '', plugin.findingSummary?.blockers ?? 0,
    ]))));
  }

  parts.push(section('Checks', checksTable(checks)));

  if (report.signatureHits?.length) {
    parts.push(section('Log signatures', table(['severity', 'id', 'root cause', 'fix'], report.signatureHits.map((hit) => [
      hit.severity, hit.id, hit.rootCause ?? '', hit.fix ?? '',
    ]))));
  }

  if (screenshotFiles.length) {
    parts.push(section('Screenshots', screenshotFiles.map(embedImage).join('')));
  }

  const shell = report.shell;
  if (shell?.shellVsWeb) {
    const diff = shell.shellVsWeb;
    parts.push(section('Shell vs web', [
      `<p>slots web=${esc(diff.counts?.slots?.web ?? '')} shell=${esc(diff.counts?.slots?.shell ?? '')};`
        + ` tokens web=${esc(diff.counts?.tokens?.web ?? '')} shell=${esc(diff.counts?.tokens?.shell ?? '')}</p>`,
      table(['axis', 'key', 'value'], [
        ...diffRows(diff.tokens).map(([key, value]) => ['token', key, value]),
        ...diffRows(diff.bodyAttributes).map(([key, value]) => ['body attribute', key, value]),
      ]),
      `<p class="muted">desktop-only: ${esc((diff.desktopOnly?.hintedBodyAttributes ?? []).join(', ') || 'none')}</p>`,
    ].join('')));
  }
  if (shell?.screenshotDiff) {
    parts.push(section('Screenshot diff', table(['field', 'value'], [
      ['identical', String(shell.screenshotDiff.identical)],
      ['dimensions match', String(shell.screenshotDiff.dimensionsMatch)],
      ['changed ratio', String(shell.screenshotDiff.pixels?.changedRatio ?? 'n/a')],
    ])));
  }
  if (report.browser?.dom) {
    const dom = report.browser.dom;
    parts.push(section('DOM probe', [
      `<p>slots=${esc(dom.slotCount)} tokens=${esc(dom.tokenCount)} slot errors=${esc(dom.slotErrors ?? 0)}</p>`,
      table(['body attribute', 'value'], Object.entries(dom.bodyAttributes ?? {}).map(([key, value]) => [key, value])),
    ].join('')));
  }
  if (report.pluginValidation?.entries?.length) {
    const rows = [];
    for (const entry of report.pluginValidation.entries) {
      for (const finding of entry.findings ?? []) {
        rows.push([entry.resolved?.name ?? 'plugin', finding.severity, finding.id, finding.message]);
      }
    }
    parts.push(section('Plugin findings', table(['plugin', 'severity', 'id', 'message'], rows)));
  }
  if (report.agentCoverage) {
    parts.push(section('Agent coverage', [
      `<p>mode <code>${esc(report.agentCoverage.mode)}</code> · real model requests: <strong>${report.agentCoverage.realModelRequests === true}</strong></p>`,
      `<p class="muted">not covered: ${esc((report.agentCoverage.uncovered ?? []).join('; '))}</p>`,
    ].join('')));
  }
  if (report.cleanup) {
    parts.push(section('Cleanup', table(['field', 'value'], [
      ['home removed', String(report.cleanup.homeRemoved)],
      ['ports left', (report.cleanup.portsLeft ?? []).join(', ') || 'none'],
      ['processes left', String(report.cleanup.processesLeft ?? 0)],
      ['residue ok', String(report.cleanup.residue?.ok ?? 'n/a')],
    ])));
  }
  if (report.settings) {
    parts.push(section('Settings page', `<p>slots added: ${esc((report.settings.added ?? []).join(', ') || 'none')}</p>`));
  }
  if (report.errors?.length) {
    parts.push(section('Errors', `<pre>${esc(report.errors.join('\n'))}</pre>`));
  }

  parts.push('</body></html>');
  return `${parts.join('\n')}\n`;
}

/** Render a matrix result (list of runs plus classification). */
export function renderMatrixHtmlReport(result = {}) {
  const rows = (result.compared ?? []).map((run) => [
    run.id,
    run.classification ?? '',
    run.screenshotDiff?.changedRatio ?? 'n/a',
    Object.keys(run.tokens?.changed ?? {}).length,
    Object.keys(run.bodyAttributes?.changed ?? {}).length,
    (run.slots?.added ?? []).length,
  ]);
  const conflictRows = [
    ...(result.conflicts?.tokens ?? []).map((item) => ['token', item.key, item.runs.join(', ')]),
    ...(result.conflicts?.bodyAttributes ?? []).map((item) => ['body attribute', item.key, item.runs.join(', ')]),
    ...(result.conflicts?.layers ?? []).map((item) => ['layer z-index', item.key, item.runs.join(', ')]),
    ...(result.conflicts?.slots ?? []).map((item) => ['slot', item.slot, item.runs.join(', ')]),
  ];
  const html = renderHtmlReport({
    ok: result.ok,
    mode: 'matrix',
    runId: result.matrixId,
    runDir: result.root,
    artifacts: {
      screenshots: Object.fromEntries(
        (result.runs ?? [])
          .map((run) => [run.id, run.screenshots?.home])
          .filter(([, file]) => Boolean(file)),
      ),
    },
    checks: (result.runs ?? []).map((run) => ({ name: run.id, pass: run.ok, detail: run.runDir })),
    runtime: null,
  });
  return html
    .replace('</body></html>', [
      section('Classification', table(['run', 'class', 'screenshot changedRatio', 'tokens', 'body attrs', 'slots added'], rows)),
      section('Conflicts', table(['axis', 'key', 'runs'], conflictRows)),
      '</body></html>',
    ].join('\n'));
}

export function writeHtmlReport(runDir, report, options = {}) {
  const renderer = options.matrix ? renderMatrixHtmlReport : renderHtmlReport;
  const file = path.join(runDir, options.matrix ? 'matrix.html' : 'report.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderer(report), 'utf8');
  return file;
}
