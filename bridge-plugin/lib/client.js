/**
 * dsh-plugin-effect-lab-bridge — browser half.
 *
 * A minimal slot in the settings page that shows the latest lab verification
 * summary and a report entry. The summary is plain DOM; the full report is a
 * self-contained HTML document (data-URI screenshots, no scripts) that this
 * slot previews inside a `sandbox=""` srcdoc iframe. That avoids loading a
 * dsh-app:// iframe subresource, which is the part we did not empirically
 * verify; the same-origin link stays available as a normal-page fallback.
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

    function BridgeSection() {
      const [state, setState] = React.useState({ loading: true, error: null, summary: null });
      const [reportHtml, setReportHtml] = React.useState(null);
      const [previewError, setPreviewError] = React.useState(null);

      React.useEffect(() => {
        let alive = true;
        fetch(SUMMARY_URL, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((summary) => { if (alive) setState({ loading: false, error: null, summary }); })
          .catch((error) => { if (alive) setState({ loading: false, error: String(error?.message ?? error), summary: null }); });
        return () => { alive = false; };
      }, []);

      const { loading, error, summary } = state;
      const loadReport = () => {
        setPreviewError(null);
        fetch(REPORT_URL)
          .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then(setReportHtml)
          .catch((fetchError) => setPreviewError(String(fetchError?.message ?? fetchError)));
      };
      const row = (label, value) =>
        React.createElement('div', { key: label, style: { display: 'flex', gap: '8px', marginBottom: '4px' } },
          React.createElement('span', { style: { opacity: 0.7, minWidth: '88px' } }, label),
          React.createElement('span', null, value));

      let body;
      if (loading) body = React.createElement('div', null, '正在读取最近一次验证…');
      else if (error) body = React.createElement('div', null, `读取失败：${error}`);
      else if (!summary?.hasReport) {
        body = React.createElement('div', null, '还没有实验舱报告。调用工具 lab_verify_plugin 之后刷新本页。');
      } else {
        const verdict = summary.ok ? '通过' : '未通过';
        body = React.createElement('div', null,
          row('结论', verdict),
          row('Run', summary.runId ?? '未知'),
          row('检查项', `${summary.checks?.passed ?? 0}/${summary.checks?.total ?? 0} 通过`),
          summary.failedChecks?.length
            ? row('失败项', summary.failedChecks.map((check) => check.name).join('、'))
            : null);
      }

      return React.createElement('div', { style: { padding: '8px 0', fontSize: '13px', lineHeight: '1.5' } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: '8px' } }, '实验舱桥接'),
        body,
        React.createElement('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' } },
          React.createElement('button', { type: 'button', onClick: loadReport }, '内嵌查看报告'),
          React.createElement('a', { href: REPORT_URL }, '打开报告页面')),
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
