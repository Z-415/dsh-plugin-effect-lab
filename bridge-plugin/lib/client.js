/**
 * dsh-plugin-effect-lab-bridge — browser half.
 *
 * The settings panel is the control surface: enter a plugin spec, start a
 * verification, watch the running state, cancel it, then read the summary and
 * an inline (sandboxed srcdoc) report. Nothing here navigates the top-level
 * SPA; the optional "open in browser" action hands the host-derived loopback
 * http:// URL to window.open, which the desktop shell routes to the OS browser.
 *
 * The control token is injected by the host through the standard
 * `webserver/index-inject` global row (`globalThis.__DSH_LAB_BRIDGE__`).
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-effect-lab-bridge',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    let React;
    try {
      React = require('react');
    } catch {
      React = null;
    }

    const inject = ['slots'];
    const SUMMARY_URL = '/dsh-lab-bridge/latest.json';
    const REPORT_URL = '/dsh-lab-bridge/latest/report.html';
    const VERIFY_URL = '/dsh-lab-bridge/verify';
    const STATUS_URL = '/dsh-lab-bridge/verify/status';
    const CANCEL_URL = '/dsh-lab-bridge/verify/cancel';

    const token = () => (typeof globalThis !== 'undefined' ? globalThis.__DSH_LAB_BRIDGE__?.token ?? null : null);
    const controlFetch = (url, options = {}) => fetch(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        ...(token() ? { 'x-dsh-lab-token': token() } : {}),
      },
    });

    function BridgeSection() {
      const [summary, setSummary] = React.useState(null);
      const [summaryError, setSummaryError] = React.useState(null);
      const [reportHtml, setReportHtml] = React.useState(null);
      const [previewError, setPreviewError] = React.useState(null);
      const [spec, setSpec] = React.useState('');
      const [online, setOnline] = React.useState(false);
      const [job, setJob] = React.useState(null);
      const [actionError, setActionError] = React.useState(null);
      const [, setTick] = React.useState(0);

      const refreshSummary = React.useCallback(async () => {
        try {
          const response = await fetch(SUMMARY_URL, { headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setSummary(await response.json());
          setSummaryError(null);
        } catch (error) {
          setSummaryError(String(error?.message ?? error));
        }
      }, []);

      const loadReport = React.useCallback(async () => {
        setPreviewError(null);
        try {
          const response = await fetch(REPORT_URL);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setReportHtml(await response.text());
        } catch (error) {
          setPreviewError(String(error?.message ?? error));
        }
      }, []);

      const fetchStatus = React.useCallback(async () => {
        const response = await controlFetch(STATUS_URL, { headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        return payload?.job ?? null;
      }, []);

      React.useEffect(() => {
        let alive = true;
        refreshSummary();
        fetchStatus()
          .then((next) => { if (alive) setJob(next); })
          .catch((error) => { if (alive) setActionError(String(error?.message ?? error)); });
        return () => { alive = false; };
      }, [refreshSummary, fetchStatus]);

      React.useEffect(() => {
        if (job?.status !== 'running') return undefined;
        const timer = setInterval(async () => {
          try {
            const next = await fetchStatus();
            setJob(next);
            if (next?.status && next.status !== 'running') {
              await refreshSummary();
              if (next.status === 'done') loadReport();
            }
          } catch (error) {
            setActionError(String(error?.message ?? error));
          }
        }, 1200);
        return () => clearInterval(timer);
      }, [job?.status, fetchStatus, refreshSummary, loadReport]);

      React.useEffect(() => {
        if (job?.status !== 'running') return undefined;
        const timer = setInterval(() => setTick((value) => value + 1), 1000);
        return () => clearInterval(timer);
      }, [job?.status]);

      const start = async () => {
        setActionError(null);
        const plugin = spec.trim();
        if (!plugin) {
          setActionError('请先输入插件规格（本地路径 / tarball / npm spec）。');
          return;
        }
        if (!token()) {
          setActionError('控制 token 未注入，请重启 DSH 后重试。');
          return;
        }
        try {
          const response = await controlFetch(VERIFY_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ plugin, online }),
          });
          const payload = await response.json().catch(() => ({}));
          if (response.status === 202) {
            setJob(payload.job);
            setReportHtml(null);
          } else if (response.status === 409) {
            setJob(payload.job ?? job);
            setActionError('已有验证在运行，请等待完成或取消。');
          } else {
            setActionError(payload.error ?? `HTTP ${response.status}`);
          }
        } catch (error) {
          setActionError(String(error?.message ?? error));
        }
      };

      const cancel = async () => {
        setActionError(null);
        try {
          const response = await controlFetch(CANCEL_URL, { method: 'POST' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
          setJob(payload.job ?? job);
        } catch (error) {
          setActionError(String(error?.message ?? error));
        }
      };

      const openExternal = () => {
        const url = summary?.loopbackReportUrl;
        if (!url || typeof window === 'undefined' || typeof window.open !== 'function') return;
        window.open(url, '_blank', 'noopener');
      };

      const row = (label, value) =>
        React.createElement('div', { key: label, style: { display: 'flex', gap: '8px', marginBottom: '4px' } },
          React.createElement('span', { style: { opacity: 0.7, minWidth: '88px' } }, label),
          React.createElement('span', null, value));

      const running = job?.status === 'running';
      const elapsed = running ? Math.max(0, Math.round((Date.now() - (job.startedAt ?? Date.now())) / 1000)) : null;
      const verdictSource = job?.status === 'done' && job.summary ? job.summary : summary;

      let jobStatus = null;
      if (running) {
        jobStatus = React.createElement('div', { style: { color: '#1d4ed8' } }, `进行中… 已用 ${elapsed ?? 0}s`);
      } else if (job?.status === 'done' && job.summary) {
        jobStatus = React.createElement('div', null,
          row('结论', job.summary.ok ? '通过' : '未通过'),
          row('Run', job.summary.runId ?? '未知'),
          row('检查项', `${job.summary.checks?.passed ?? 0}/${job.summary.checks?.total ?? 0} 通过`));
      } else if (job?.status === 'cancelled') {
        jobStatus = React.createElement('div', null, '已取消。');
      } else if (job?.status === 'error') {
        jobStatus = React.createElement('div', null, `运行失败：${job.error ?? '未知错误'}`);
      }

      let reportBlock = null;
      if (verdictSource?.hasReport) {
        reportBlock = React.createElement('div', null,
          row('最近一次', verdictSource.runId ?? '未知'),
          row('结论', verdictSource.ok ? '通过' : '未通过'),
          row('检查项', `${verdictSource.checks?.passed ?? 0}/${verdictSource.checks?.total ?? 0} 通过`),
          verdictSource.failedChecks?.length
            ? row('失败项', verdictSource.failedChecks.map((check) => check.name).join('、'))
            : null);
      } else if (summaryError) {
        reportBlock = React.createElement('div', null, `读取最近报告失败：${summaryError}`);
      } else {
        reportBlock = React.createElement('div', null, '还没有实验舱报告。输入插件规格后点击「开始验证」。');
      }

      return React.createElement('div', { style: { padding: '8px 0', fontSize: '13px', lineHeight: '1.6' } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: '8px' } }, '实验舱桥接'),
        React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } },
          React.createElement('input', {
            type: 'text',
            value: spec,
            placeholder: '插件规格：本地路径 / tarball / npm spec',
            onInput: (event) => setSpec(event.target.value),
            onChange: (event) => setSpec(event.target.value),
            style: { flex: 1, padding: '6px 8px', minWidth: '260px' },
          }),
          React.createElement('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' } },
            React.createElement('input', { type: 'checkbox', checked: online, onChange: (event) => setOnline(event.target.checked) }),
            '允许联网'),
          React.createElement('button', { type: 'button', onClick: start, disabled: running }, '开始验证'),
          running ? React.createElement('button', { type: 'button', onClick: cancel }, '取消') : null),
        jobStatus,
        actionError ? React.createElement('div', { style: { color: '#b91c1c' } }, actionError) : null,
        React.createElement('div', { style: { marginTop: '8px' } }, reportBlock),
        React.createElement('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' } },
          React.createElement('button', { type: 'button', onClick: loadReport }, '内嵌查看报告'),
          verdictSource?.loopbackReportUrl
            ? React.createElement('button', { type: 'button', onClick: openExternal }, '在浏览器打开')
            : null),
        previewError ? React.createElement('div', null, `报告加载失败：${previewError}`) : null,
        reportHtml
          ? React.createElement('iframe', {
            title: '实验舱报告',
            srcDoc: reportHtml,
            sandbox: '',
            style: { width: '100%', height: '360px', marginTop: '8px', border: '1px solid rgba(127,127,127,0.35)', borderRadius: '6px' },
          })
          : null);
    }

    function apply(ctx) {
      if (!React || !ctx?.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return;
      const register = () => ctx.slots.register(
        { name: 'settings.section', id: 'effect-lab-bridge', order: 600, label: () => '实验舱桥接' },
        () => React.createElement(BridgeSection),
      );
      try {
        ctx.slots.inject('settings.section', register);
      } catch {
        // The host may not declare settings.section; a missing slot is not fatal.
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
