/**
 * dsh-plugin-effect-lab-bridge — browser half.
 *
 * One button: launch the lab's own Electron GUI as an external process. No
 * report links, no iframe, no top-level navigation; the DSH SPA stays exactly
 * where it is. The launch nonce comes from the host's standard
 * `webserver/index-inject` global row.
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

    const nonce = () => (typeof globalThis !== 'undefined' ? globalThis.__DSH_LAB_BRIDGE__?.token ?? null : null);

    function LaunchSection() {
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

      return React.createElement('div', { style: { padding: '8px 0', fontSize: '13px', lineHeight: '1.6' } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: '8px' } }, '实验舱桥接'),
        React.createElement('button', { type: 'button', onClick: launch, disabled: state.busy },
          state.busy ? '正在启动…' : '启动实验舱'),
        state.message
          ? React.createElement('div', { style: { color: '#166534', marginTop: '6px' } }, state.message)
          : null,
        state.error
          ? React.createElement('div', { style: { color: '#b91c1c', marginTop: '6px' } }, `启动失败：${state.error}`)
          : null);
    }

    function apply(ctx) {
      if (!React || !ctx?.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return;
      const register = () => ctx.slots.register(
        { name: 'settings.section', id: 'effect-lab-bridge', order: 600, label: () => '实验舱桥接' },
        () => React.createElement(LaunchSection),
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
