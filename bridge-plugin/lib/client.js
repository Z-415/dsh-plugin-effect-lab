/**
 * dsh-plugin-effect-lab-bridge — browser half.
 *
 * One button that launches the lab's own Electron GUI as an external process.
 * The DSH SPA stays exactly where it is: no report links, no iframe, no
 * top-level navigation. The launch nonce comes from the host's standard
 * `webserver/index-inject` global row.
 *
 * Registers three seats (0.2.0-rc.2 contract):
 *   - `settings.section` — the 实验舱桥接 settings page;
 *   - `main` keyed by PANEL_ID — the standalone panel;
 *   - `sidebar.panellist` with the same id — the left-sidebar entry (the
 *     registered component is the icon; selecting the row opens the main panel).
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
    const LAUNCH_URL = '/dsh-lab-bridge/launch';
    const PANEL_ID = 'effect-lab-bridge';
    const STYLE_ID = 'dsh-lab-bridge-style';

    const nonce = () => (typeof globalThis !== 'undefined' ? globalThis.__DSH_LAB_BRIDGE__?.token ?? null : null);

    // The lab's flat palette: borderless buttons whose fill carries the state,
    // with DSH label tokens first so dark themes keep the text readable.
    const STYLES = `
.dsh-lab-bridge { color: var(--dsw-alias-label-primary, #1f2329); font: inherit; }
.dsh-lab-bridge__title { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.dsh-lab-bridge__desc { margin: 0 0 10px; color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px; line-height: 1.6; }
.dsh-lab-bridge__button { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 6px 14px;
  font: inherit; font-size: 13px; font-weight: 500; color: #1d4ed8; background: #f2f6ff;
  border: 1px solid transparent; border-radius: 6px; cursor: pointer;
  transition: background-color .12s ease, color .12s ease; }
.dsh-lab-bridge__button:hover:not(:disabled) { background: #e2ebff; }
.dsh-lab-bridge__button:active:not(:disabled) { background: #d3e0fb; }
.dsh-lab-bridge__button:focus-visible { outline: 2px solid #b9cdf6; outline-offset: 1px; }
.dsh-lab-bridge__button:disabled { opacity: .5; cursor: default; }
.dsh-lab-bridge__status { margin-top: 8px; font-size: 12px; }
.dsh-lab-bridge__status--ok { color: #15803d; }
.dsh-lab-bridge__status--bad { color: var(--dsw-alias-label-error, #c0271c); }
.dsh-lab-bridge__panel { max-width: 720px; padding: 28px 32px; }
.dsh-lab-bridge__panel-title { margin: 0 0 6px; font-size: 16px; font-weight: 650; }
.dsh-lab-bridge__panel-desc { margin: 0 0 16px; color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12.5px; line-height: 1.6; }
.dsh-lab-bridge__hint { margin: 14px 0 0; color: var(--dsw-alias-label-tertiary, #9aa1ab); font-size: 12px; }
`;

    function ensureStyles() {
      if (typeof document === 'undefined' || !document.head) return;
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    function useLauncher() {
      const [state, setState] = React.useState({ busy: false, message: null, error: null });
      const launch = async () => {
        if (state.busy) return;
        setState({ busy: true, message: null, error: null });
        try {
          const token = nonce();
          if (!token) throw new Error('控制 token 未注入，请重启 DSH 后重试。');
          const response = await fetch(LAUNCH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-lab-token': token },
            body: '{}',
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
          const pid = payload.launched?.pid;
          setState({
            busy: false,
            message: pid ? `实验舱已启动（pid ${pid}）` : '实验舱已启动',
            error: null,
          });
        } catch (error) {
          setState({ busy: false, message: null, error: String(error?.message ?? error) });
        }
      };
      return { state, launch };
    }

    function LaunchControls() {
      const { state, launch } = useLauncher();
      return React.createElement('div', null,
        React.createElement('button', {
          type: 'button',
          className: 'dsh-lab-bridge__button',
          onClick: launch,
          disabled: state.busy,
        }, state.busy ? '正在启动…' : '启动实验舱'),
        state.message
          ? React.createElement('div', { className: 'dsh-lab-bridge__status dsh-lab-bridge__status--ok' }, state.message)
          : null,
        state.error
          ? React.createElement('div', { className: 'dsh-lab-bridge__status dsh-lab-bridge__status--bad' }, `启动失败：${state.error}`)
          : null);
    }

    function SettingsSection() {
      return React.createElement('div', { className: 'dsh-lab-bridge' },
        React.createElement('div', { className: 'dsh-lab-bridge__title' }, '实验舱桥接'),
        React.createElement('p', { className: 'dsh-lab-bridge__desc' },
          '在实验舱自己的 Electron 窗口里隔离验证 DSH 插件；DSH 界面和当前会话保持不变。'),
        React.createElement(LaunchControls));
    }

    function LabPanel() {
      return React.createElement('div', { className: 'dsh-lab-bridge__panel' },
        React.createElement('h2', { className: 'dsh-lab-bridge__panel-title' }, '实验舱桥接'),
        React.createElement('p', { className: 'dsh-lab-bridge__panel-desc' },
          '实验舱会用自己的临时隔离 DSH_HOME 启动，不读写这个 DSH 的会话与凭据。'),
        React.createElement(LaunchControls),
        React.createElement('p', { className: 'dsh-lab-bridge__hint' },
          '启动后请在实验舱窗口里操作；这个面板可以随时关掉。'));
    }

    /** The sidebar glyph: a small lab flask, drawn at the size the sidebar asks for. */
    function LabIcon(props) {
      const size = Number.isFinite(props?.size) ? props.size : 16;
      return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      React.createElement('path', { d: 'M9 3h6' }),
      React.createElement('path', { d: 'M10 3v5.4L4.9 17.3A2 2 0 0 0 6.7 20h10.6a2 2 0 0 0 1.8-2.7L14 8.4V3' }),
      React.createElement('path', { d: 'M6.6 15h10.8' }));
    }

    /** Register into one seat; a host that does not declare it must not break us. */
    function registerInto(ctx, key, options, component) {
      try {
        ctx.slots.inject(key, () => ctx.slots.register(options, component));
      } catch {
        // The seat is optional on older builds.
      }
    }

    function apply(ctx) {
      if (!React || !ctx?.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return;
      ensureStyles();
      registerInto(ctx, 'settings.section',
        { name: 'settings.section', id: PANEL_ID, order: 600, label: () => '实验舱桥接' },
        SettingsSection);
      registerInto(ctx, 'main',
        { name: 'main', key: PANEL_ID },
        LabPanel);
      registerInto(ctx, 'sidebar.panellist',
        { name: 'sidebar.panellist', id: PANEL_ID, order: 100, label: () => '实验舱' },
        LabIcon);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
