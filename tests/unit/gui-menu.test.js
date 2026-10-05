import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMenuTemplate } = require('../../src/gui/menu.cjs');

function collect(template, key) {
  const out = [];
  for (const item of template) {
    if (item[key] !== undefined) out.push(item[key]);
    if (Array.isArray(item.submenu)) out.push(...collect(item.submenu, key));
  }
  return out;
}

test('the application menu is Chinese', () => {
  const template = buildMenuTemplate({ onAbout: () => {} });
  assert.deepEqual(template.map((item) => item.label), ['文件', '编辑', '查看', '窗口', '帮助']);
  for (const label of collect(template, 'label')) {
    assert.match(label, /[\u4e00-\u9fff]/, `label is not Chinese: ${label}`);
  }
  assert.equal(collect(template, 'label').includes('File'), false);
});

test('the menu keeps the standard roles behind the Chinese labels', () => {
  const roles = collect(buildMenuTemplate({ onAbout: () => {} }), 'role');
  for (const role of [
    'quit', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
    'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut',
    'togglefullscreen', 'minimize', 'close',
  ]) {
    assert.equal(roles.includes(role), true, `missing role ${role}`);
  }
});

test('the about item runs the dialog callback, or falls back to the about role', () => {
  let shown = 0;
  const withAbout = buildMenuTemplate({ appName: '实验舱', onAbout: () => { shown += 1; } });
  const help = withAbout[withAbout.length - 1];
  assert.equal(help.label, '帮助');
  assert.equal(help.submenu[0].label, '关于 实验舱');
  help.submenu[0].click();
  assert.equal(shown, 1);

  const without = buildMenuTemplate({ appName: '实验舱' });
  assert.equal(without[without.length - 1].submenu[0].role, 'about');
});
