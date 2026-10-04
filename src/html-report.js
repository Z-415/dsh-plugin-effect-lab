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
  if (pass) return '<span class="badge pass">通过</span>';
  if (informational) return '<span class="badge info">提示</span>';
  return '<span class="badge fail">失败</span>';
}

function embedImage(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_EMBED_BYTES) return `<p class="muted">${esc(path.basename(file))}（${Math.round(stat.size / 1024)} kB，过大未内嵌）</p>`;
    const base64 = fs.readFileSync(file).toString('base64');
    return `<figure><img alt="${esc(path.basename(file))}" src="data:image/png;base64,${base64}"><figcaption>${esc(path.basename(file))} · ${Math.round(stat.size / 1024)} kB</figcaption></figure>`;
  } catch (error) {
    return `<p class="muted">${esc(path.basename(file))}（无法读取：${esc(error?.message ?? error)}）</p>`;
  }
}

function table(headers, rows) {
  if (!rows.length) return '<p class="muted">无</p>';
  const head = headers.map((item) => `<th>${esc(item)}</th>`).join('');
  const body = rows.slice(0, MAX_TABLE_ROWS)
    .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
    .join('');
  const extra = rows.length > MAX_TABLE_ROWS ? `<p class="muted">还有 ${rows.length - MAX_TABLE_ROWS} 行，完整内容见 report.json</p>` : '';
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${extra}`;
}

function checksTable(checks) {
  const rows = checks
    .map((check) => `<tr><td>${badge(check.pass, check.informational)}</td><td>${esc(check.name)}</td><td>${esc(check.detail ?? '')}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>结果</th><th>检查项</th><th>详情</th></tr></thead><tbody>${rows}</tbody></table>`;
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
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>DSH 插件效果实验舱 - ${esc(report.runId ?? 'run')}</title>`,
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
    '<h1>DSH 插件效果实验舱</h1>',
    `<div class="summary">
       <span class="status ${report.ok ? 'pass' : 'fail'}">${report.ok ? '通过' : '未通过'}</span>
       <span>模式 <code>${esc(report.mode ?? 'n/a')}</code></span>
       <span>运行 <code>${esc(report.runId ?? 'n/a')}</code></span>
       <span>DSH <code>${esc(report.runtime?.version ?? 'n/a')}</code></span>
       <span>${esc(report.startedAt ?? '')} → ${esc(report.finishedAt ?? '')}</span>
     </div>`,
    `<p class="muted">共 ${checks.length} 项检查，${failed.length} 项未通过。机器可读详情见 <code>report.json</code>。</p>`,
  ];

  if (report.plugins?.length) {
    parts.push(section('插件', table(['名称', '版本', '来源', '夹具', '阻塞项'], report.plugins.map((plugin) => [
      plugin.name, plugin.version ?? '', plugin.source ?? '', plugin.fixture === true ? 'yes' : '', plugin.findingSummary?.blockers ?? 0,
    ]))));
  }

  parts.push(section('检查项', checksTable(checks)));

  if (report.signatureHits?.length) {
    parts.push(section('启动日志特征', table(['级别', '编号', '根因', '建议'], report.signatureHits.map((hit) => [
      hit.severity, hit.id, hit.rootCause ?? '', hit.fix ?? '',
    ]))));
  }

  if (screenshotFiles.length) {
    parts.push(section('截图', screenshotFiles.map(embedImage).join('')));
  }

  const shell = report.shell;
  if (shell?.shellVsWeb) {
    const diff = shell.shellVsWeb;
    parts.push(section('壳 vs web', [
      `<p>slot 数 web=${esc(diff.counts?.slots?.web ?? '')} shell=${esc(diff.counts?.slots?.shell ?? '')}；`
        + `token 数 web=${esc(diff.counts?.tokens?.web ?? '')} shell=${esc(diff.counts?.tokens?.shell ?? '')}</p>`,
      table(['维度', '键', '值'], [
        ...diffRows(diff.tokens).map(([key, value]) => ['token', key, value]),
        ...diffRows(diff.bodyAttributes).map(([key, value]) => ['body 属性', key, value]),
      ]),
      `<p class="muted">桌面专属属性：${esc((diff.desktopOnly?.hintedBodyAttributes ?? []).join(', ') || '无')}</p>`,
    ].join('')));
  }
  if (shell?.screenshotDiff) {
    parts.push(section('截图差异', table(['字段', '值'], [
      ['是否完全一致', String(shell.screenshotDiff.identical)],
      ['尺寸是否一致', String(shell.screenshotDiff.dimensionsMatch)],
      ['像素变化比例', String(shell.screenshotDiff.pixels?.changedRatio ?? 'n/a')],
    ])));
  }
  if (report.browser?.dom) {
    const dom = report.browser.dom;
    parts.push(section('DOM 探测', [
      `<p>slot=${esc(dom.slotCount)} token=${esc(dom.tokenCount)} slot 错误=${esc(dom.slotErrors ?? 0)}</p>`,
      table(['body 属性', '值'], Object.entries(dom.bodyAttributes ?? {}).map(([key, value]) => [key, value])),
    ].join('')));
  }
  if (report.pluginValidation?.entries?.length) {
    const rows = [];
    for (const entry of report.pluginValidation.entries) {
      for (const finding of entry.findings ?? []) {
        rows.push([entry.resolved?.name ?? 'plugin', finding.severity, finding.id, finding.message]);
      }
    }
    parts.push(section('插件校验结果', table(['插件', '级别', '编号', '说明'], rows)));
  }
  if (report.agentCoverage) {
    parts.push(section('模型 / 代理覆盖', [
      `<p>模式 <code>${esc(report.agentCoverage.mode)}</code> · 是否发生真实模型请求：<strong>${report.agentCoverage.realModelRequests === true}</strong></p>`,
      `<p class="muted">未覆盖：${esc((report.agentCoverage.uncovered ?? []).join('；'))}</p>`,
    ].join('')));
  }
  if (report.cleanup) {
    parts.push(section('清理', table(['字段', '值'], [
      ['临时 home 已删除', String(report.cleanup.homeRemoved)],
      ['保留的 lab profile', String(report.cleanup.homeKept ?? false)],
      ['残留端口', (report.cleanup.portsLeft ?? []).join(', ') || '无'],
      ['残留进程', String(report.cleanup.processesLeft ?? 0)],
      ['无残留校验', String(report.cleanup.residue?.ok ?? 'n/a')],
    ])));
  }
  if (report.settings) {
    parts.push(section('设置页', `<p>新增 slot：${esc((report.settings.added ?? []).join(', ') || '无')}</p>`));
  }
  if (report.errors?.length) {
    parts.push(section('错误', `<pre>${esc(report.errors.join('\n'))}</pre>`));
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
      section('分类', table(['运行', '分类', '截图变化比例', 'token 变化', 'body 属性变化', '新增 slot'], rows)),
      section('冲突', table(['维度', '键', '涉及运行'], conflictRows)),
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
