'use strict';

/**
 * The application menu, in Chinese.
 *
 * Labels are written out explicitly instead of relying on Electron's role
 * defaults: the default menu came up in English, but the rest of the lab is
 * Chinese. Roles are still used so the standard accelerators (Ctrl+C/V/Z,
 * Ctrl+R, Ctrl+Shift+I, Ctrl+=/-) keep working.
 */
function buildMenuTemplate(options = {}) {
  const { appName = 'DSH Plugin Effect Lab', onAbout } = options;
  const about = typeof onAbout === 'function'
    ? { label: `关于 ${appName}`, click: onAbout }
    : { label: `关于 ${appName}`, role: 'about' };
  return [
    {
      label: '文件',
      submenu: [
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '查看',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [about],
    },
  ];
}

module.exports = { buildMenuTemplate };
