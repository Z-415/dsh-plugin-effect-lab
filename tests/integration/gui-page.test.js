import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openUi } from '../../src/browser-driver.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const here = path.dirname(fileURLToPath(import.meta.url));
const guiPage = path.resolve(here, '..', '..', 'src', 'gui', 'index.html');

/** A stand-in for the preload bridge that records the commands the UI builds. */
const STUB = `<script>
window.__calls = [];
window.__handlers = {};
window.__notifyCalls = [];
window.__menuCalls = [];
window.__rendererErrors = [];
window.addEventListener('error', (event) => window.__rendererErrors.push(String(event.message)));
window.prompt = () => null;
window.confirm = () => false;
window.labGui = {
  run: async (args) => { window.__calls.push(args); return { started: true }; },
  menu: async (action) => { window.__menuCalls.push(action); return { ok: true }; },
  stop: async () => ({ stopped: true }),
  openReport: async () => ({ opened: false, reason: 'stub' }),
  openArtifacts: async () => ({ opened: false }),
  notify: async (payload) => { window.__notifyCalls.push(payload); return { shown: true }; },
  profiles: async () => ({
    root: 'stub',
    profiles: [
      { name: 'dev', plugins: [{ spec: 'dsh-plugin-wallpaper-engine@1.2.0' }, { spec: 'dsh-ui-tweaks@0.20.0' }] },
      { name: 'plain', plugins: [] },
    ],
  }),
  info: async () => ({ electron: 'stub', node: 'stub', repo: 'stub' }),
  onStarted: (handler) => { window.__handlers.started = handler; },
  onOutput: (handler) => { window.__handlers.output = handler; },
  onDone: (handler) => { window.__handlers.done = handler; },
};
</script>`;

function stubPage() {
  const html = fs.readFileSync(guiPage, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-gui-page-'));
  const file = path.join(dir, 'index.html');
  // The stub must be defined before the page script runs.
  fs.writeFileSync(file, html.replace('<script>', `${STUB}\n<script>`), 'utf8');
  return { dir, file };
}

const CLICK_ALL = `(() => {
  const skip = new Set(['stop', 'report', 'artifacts']);
  const buttons = [...document.querySelectorAll('button')].filter((b) => !skip.has(b.id));
  const thrown = [];
  for (const button of buttons) {
    // setBusy() disables every button during a run; re-enable so this click
    // represents a separate user action.
    button.disabled = false;
    try {
      button.click();
    } catch (error) {
      thrown.push((button.id || button.textContent || '?') + ': ' + error.message);
    }
  }
  return JSON.stringify({ thrown, calls: window.__calls, errors: window.__rendererErrors });
})()`;

const CLICK_DESKTOP = `(() => {
  document.getElementById('nativeDesktop').checked = true;
  document.getElementById('probeDialog').checked = true;
  window.__calls = [];
  // The previous pass left every button disabled (setBusy until onDone).
  for (const id of ['runShellPlugin', 'runShellCompare']) {
    const button = document.getElementById(id);
    button.disabled = false;
    button.click();
  }
  return JSON.stringify({ calls: window.__calls, errors: window.__rendererErrors });
})()`;

const PROFILE_SELECT = `(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60));
  const select = document.getElementById('profileSelect');
  const options = [...select.options].map((option) => option.value);
  window.__calls = [];
  select.value = 'dev';
  select.dispatchEvent(new Event('change'));
  const shellButton = document.getElementById('runShellPlugin');
  shellButton.disabled = false;
  shellButton.click();
  select.value = '__new__';
  select.dispatchEvent(new Event('change'));
  const newVisible = document.getElementById('profileNew').hidden === false;
  document.getElementById('profileNew').value = 'fresh1';
  const verifyButton = document.getElementById('runVerifyPlugin');
  verifyButton.disabled = false;
  verifyButton.click();
  return JSON.stringify({ options, calls: window.__calls, newVisible, errors: window.__rendererErrors });
})()`;

const LAYOUT_AND_BANNER = `(() => {
  const rect = (el) => el.getBoundingClientRect();
  const log = rect(document.getElementById('log'));
  const wrap = rect(document.querySelector('.logwrap'));
  const controls = document.getElementById('controls');
  const controlsRect = rect(controls);
  const footer = rect(document.querySelector('footer'));
  const layoutOk = log.height >= 120
    && wrap.bottom <= footer.top + 1
    && controlsRect.bottom <= wrap.top + 1;
  const more = document.getElementById('moreChecks');
  const moreCollapsed = more.open === false;
  more.open = true;
  const openLayoutOk = rect(document.getElementById('log')).height >= 120
    && rect(controls).bottom <= rect(document.querySelector('.logwrap')).top + 1;
  // Simulate a failed run finishing so the banner and the toast fire.
  window.__handlers.done({ code: 1 });
  const banner = document.getElementById('banner');
  return JSON.stringify({
    layoutOk,
    moreCollapsed,
    openLayoutOk,
    logHeight: Math.round(log.height),
    controls: { visible: Math.round(controlsRect.height), content: controls.scrollHeight },
    bodyClipped: document.body.scrollHeight > window.innerHeight + 1,
    bannerHidden: banner.hidden,
    bannerText: banner.textContent,
    bannerClass: banner.className,
    notifyCalls: window.__notifyCalls,
    errors: window.__rendererErrors,
  });
})()`;

/**
 * Design regression probe: the button area must stay on a regular grid.
 * Every row of a `.actions` grid must have equal-width, equal-height cells,
 * labels must fit inside their buttons, and nothing may overlap or overflow
 * the window horizontally.
 */
const DESIGN = `(() => {
  const approx = (a, b) => Math.abs(a - b) <= 1;
  const buttons = [...document.querySelectorAll('button')];
  const rects = buttons.map((b) => ({ id: b.id || b.textContent.trim(), el: b, r: b.getBoundingClientRect() }));
  const grids = [...document.querySelectorAll('.actions')].map((grid) => {
    const items = [...grid.children].filter((el) => el.tagName === 'BUTTON');
    const rows = [];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const row = rows.find((x) => approx(x.top, r.top));
      if (row) row.items.push(r); else rows.push({ top: r.top, items: [r] });
    }
    return rows.map((row) => ({
      count: row.items.length,
      widths: row.items.map((r) => Math.round(r.width)),
      heights: row.items.map((r) => Math.round(r.height)),
    }));
  });
  const ragged = [];
  for (const rows of grids) {
    for (const row of rows) {
      if (Math.max(...row.widths) - Math.min(...row.widths) > 1) ragged.push({ kind: 'width', row });
      if (Math.max(...row.heights) - Math.min(...row.heights) > 1) ragged.push({ kind: 'height', row });
    }
  }
  const overflow = rects
    .filter(({ r }) => r.width > 0 && (r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1))
    .map(({ id }) => id);
  // A scrolled-out button can sit on top of the footer in viewport coordinates
  // even though its scroll container clips it. Clip every rect to its scroll
  // ancestors before comparing, so only real visual overlaps are reported.
  const visibleBox = (el) => {
    const r = el.getBoundingClientRect();
    const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/auto|scroll|hidden/.test(style.overflowX) || /auto|scroll|hidden/.test(style.overflowY)) {
        const nr = node.getBoundingClientRect();
        box.left = Math.max(box.left, nr.left);
        box.top = Math.max(box.top, nr.top);
        box.right = Math.min(box.right, nr.right);
        box.bottom = Math.min(box.bottom, nr.bottom);
      }
    }
    box.right = Math.min(box.right, window.innerWidth);
    box.bottom = Math.min(box.bottom, window.innerHeight);
    box.width = Math.max(0, box.right - box.left);
    box.height = Math.max(0, box.bottom - box.top);
    return box;
  };
  const boxes = rects.map(({ id, el }) => ({ id, box: visibleBox(el) }));
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box;
      const b = boxes[j].box;
      if (a.width < 2 || b.width < 2 || a.height < 2 || b.height < 2) continue;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
        overlaps.push([boxes[i].id, boxes[j].id]);
      }
    }
  }
  // Input / select / button in one field row must not spill past the row.
  const fieldOverflow = [];
  for (const row of document.querySelectorAll('.fieldrow, .grouphead')) {
    const rr = row.getBoundingClientRect();
    for (const kid of row.children) {
      const kr = kid.getBoundingClientRect();
      if (kr.width === 0) continue;
      if (kr.right > rr.right + 1 || kr.left < rr.left - 1) {
        fieldOverflow.push({ row: row.id || row.className, child: kid.id || kid.tagName });
      }
    }
  }
  return JSON.stringify({
    ragged,
    overflow,
    overlaps,
    fieldOverflow,
    bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    buttonCount: buttons.length,
    errors: window.__rendererErrors,
  });
})()`;

/**
 * The whole window is one light palette: white page, white panels, and a white
 * log pane with dark, readable text. Locks the flat/unified look so the dark
 * console cannot creep back in.
 */
const THEME = `(() => {
  const toRgb = (value) => (value.match(/\\d+(\\.\\d+)?/g) || []).slice(0, 3).map(Number);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const background = (selector) => toRgb(getComputedStyle(document.querySelector(selector)).backgroundColor);
  const isLight = (rgb) => rgb.length === 3 && rgb.every((v) => v >= 235);
  const logBg = background('.logwrap');
  const logFg = toRgb(getComputedStyle(document.getElementById('log')).color);
  return JSON.stringify({
    logBg,
    logFg,
    logLight: isLight(logBg),
    bodyLight: isLight(background('body')),
    panelLight: isLight(background('#pluginGroup')),
    titlebarLight: isLight(background('.titlebar')),
    logContrast: Number(contrast(logFg, logBg).toFixed(2)),
    errors: window.__rendererErrors,
  });
})()`;

/** The in-page menu replaces the English OS menu; clicks go through labGui.menu. */
const MENUS = `(() => {
  window.__menuCalls = [];
  const labels = [...document.querySelectorAll('.menubar .menu-btn')].map((btn) => btn.textContent.trim());
  const opened = [];
  const actions = [];
  for (const menu of document.querySelectorAll('.menu')) {
    const btn = menu.querySelector('.menu-btn');
    btn.click();
    opened.push(menu.classList.contains('open'));
    for (const item of menu.querySelectorAll('[data-action]')) {
      actions.push(item.dataset.action);
      item.click();
    }
  }
  return JSON.stringify({
    labels,
    opened,
    actions,
    remainingOpen: document.querySelectorAll('.menu.open').length,
    calls: window.__menuCalls,
    errors: window.__rendererErrors,
  });
})()`;

test('every GUI button dispatches a lab command without a renderer error', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const page = stubPage();
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-gui-shots-'));
  let ui = null;
  try {
    ui = await openUi({
      baseUrl: pathToFileURL(page.file).href,
      screenshots: [],
      artifactsDir,
      // Match the real launcher window (gui/main.js) so layout regressions that
      // only show up at this size are caught.
      viewport: { width: 1080, height: 760 },
      probes: {
        clickAll: CLICK_ALL,
        desktop: CLICK_DESKTOP,
        profiles: PROFILE_SELECT,
        layout: LAYOUT_AND_BANNER,
        design: DESIGN,
        theme: THEME,
        menus: MENUS,
      },
    });
    const result = JSON.parse(ui.extra.clickAll);
    const desktop = JSON.parse(ui.extra.desktop);
    const profiles = JSON.parse(ui.extra.profiles);
    const layout = JSON.parse(ui.extra.layout);
    const design = JSON.parse(ui.extra.design);
    const theme = JSON.parse(ui.extra.theme);
    const menus = JSON.parse(ui.extra.menus);

    assert.deepEqual(result.errors, [], `renderer errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.thrown, [], `click handlers threw: ${JSON.stringify(result.thrown)}`);
    assert.equal(result.calls.length > 0, true, 'no button dispatched a command');
    // Every dispatch must be a lab subcommand with an argument list.
    for (const args of result.calls) {
      assert.equal(Array.isArray(args), true, JSON.stringify(args));
      assert.equal(typeof args[0], 'string');
      assert.equal(args.some((part) => part === undefined), false, JSON.stringify(args));
    }
    assert.equal(result.calls.some((args) => args[0] === 'verify'), true);
    assert.equal(result.calls.some((args) => args[0] === 'shell'), true);
    assert.equal(result.calls.some((args) => args[0] === 'profile'), true, JSON.stringify(result.calls));
    assert.equal(result.calls.some((args) => args[0] === 'scan'), true, 'the signature-library button must dispatch scan');
    assert.equal(result.calls.some((args) => args[0] === 'matrix'), true, 'the collapsed 更多 area must dispatch matrix');
    assert.equal(result.calls.some((args) => args[0] === 'runtimes'), true, 'the collapsed 更多 area must dispatch runtimes');
    assert.equal(
      result.calls.some((args) => args[0] === 'matrix' && args.includes('--runtime-matrix')),
      true,
      'the cross-version matrix button must pass --runtime-matrix',
    );
    const themeMatrix = result.calls.find((args) => args[0] === 'matrix' && args.includes('--online'));
    assert.deepEqual(
      themeMatrix.slice(0, 3),
      ['matrix', '--config', 'fixtures/matrix/theme-conflict.json'],
      JSON.stringify(result.calls),
    );

    // With both desktop checkboxes ticked, the shell buttons must pass the new flags.
    assert.equal(desktop.calls.length, 2, JSON.stringify(desktop.calls));
    for (const args of desktop.calls) {
      assert.equal(args.includes('--native-desktop'), true, JSON.stringify(args));
      assert.equal(args.includes('--probe-native-dialog'), true, JSON.stringify(args));
    }
    const keepOpen = desktop.calls.find((args) => args.includes('--keep-open'));
    assert.deepEqual(keepOpen.slice(0, 2), ['shell', '--no-compare-web']);
    const compare = desktop.calls.find((args) => args[0] === 'shell' && !args.includes('--keep-open'));
    assert.equal(compare.includes('--show'), true, 'the dialog probe needs a visible window');

    // The profile dropdown lists the existing profiles and drives --profile-lab.
    assert.deepEqual(profiles.options, ['', 'dev', 'plain', '__new__']);
    assert.equal(profiles.calls.length, 2, JSON.stringify(profiles.calls));
    const selected = profiles.calls[0];
    assert.equal(selected.includes('--profile-lab'), true, JSON.stringify(selected));
    assert.equal(selected[selected.indexOf('--profile-lab') + 1], 'dev');
    assert.equal(profiles.newVisible, true, 'choosing 新建 must reveal the name field');
    const created = profiles.calls[1];
    assert.equal(created[created.indexOf('--profile-lab') + 1], 'fresh1');

    // The log pane must stay on screen; adding controls must not squeeze it out.
    assert.equal(layout.layoutOk, true, JSON.stringify(layout));
    assert.equal(layout.logHeight >= 120, true, JSON.stringify(layout));
    assert.equal(layout.bodyClipped, false, JSON.stringify(layout));
    assert.equal(layout.controls.visible >= 100, true, JSON.stringify(layout));
    assert.equal(layout.moreCollapsed, true, 'the 更多 area must start collapsed so it costs no height');
    assert.equal(layout.openLayoutOk, true, JSON.stringify(layout));
    // A failed run must show the banner and raise a desktop notification.
    assert.equal(layout.bannerHidden, false, JSON.stringify(layout));
    assert.match(layout.bannerText, /失败/);
    assert.match(layout.bannerClass, /bad/);
    assert.equal(layout.notifyCalls.length, 1, JSON.stringify(layout.notifyCalls));
    assert.match(layout.notifyCalls[0].title, /失败/);

    // The button area must stay on a regular grid: equal cells, no clipped
    // labels, no overlap, no horizontal scrollbar.
    assert.deepEqual(design.ragged, [], `misaligned grid rows: ${JSON.stringify(design.ragged)}`);
    assert.deepEqual(design.overflow, [], `labels overflow their buttons: ${JSON.stringify(design.overflow)}`);
    assert.deepEqual(design.overlaps, [], `overlapping buttons: ${JSON.stringify(design.overlaps)}`);
    assert.deepEqual(design.fieldOverflow, [], `fields spill out of their row: ${JSON.stringify(design.fieldOverflow)}`);
    assert.equal(design.bodyOverflowX <= 1, true, `body overflows horizontally by ${design.bodyOverflowX}px`);
    assert.equal(design.buttonCount >= 20, true, `expected the full button set, got ${design.buttonCount}`);
    assert.deepEqual(design.errors, []);

    // One flat light palette: white page, panels and log pane, dark log text.
    assert.equal(theme.bodyLight, true, JSON.stringify(theme));
    assert.equal(theme.panelLight, true, JSON.stringify(theme));
    assert.equal(theme.logLight, true, JSON.stringify(theme));
    assert.equal(theme.titlebarLight, true, JSON.stringify(theme));
    assert.equal(theme.logContrast >= 7, true, JSON.stringify(theme));
    assert.deepEqual(theme.errors, []);

    // The top bar is a Chinese in-page menu; every item dispatches its action.
    assert.deepEqual(menus.labels, ['文件', '编辑', '查看', '窗口', '帮助']);
    assert.deepEqual(menus.opened, [true, true, true, true, true], JSON.stringify(menus.opened));
    assert.deepEqual(menus.actions, [
      'quit',
      'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
      'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'toggleFullscreen',
      'minimize', 'close',
      'about',
    ], JSON.stringify(menus.actions));
    assert.equal(menus.remainingOpen, 0, JSON.stringify(menus));
    assert.deepEqual(menus.calls, menus.actions, JSON.stringify(menus.calls));
    assert.deepEqual(menus.errors, []);
  } finally {
    if (ui) await ui.close();
    fs.rmSync(page.dir, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});

/** The window can be resized down to 820x560; the log must survive there too. */
const MIN_LAYOUT = `(() => {
  const rect = (el) => el.getBoundingClientRect();
  const controls = document.getElementById('controls');
  const wrap = document.querySelector('.logwrap');
  const footer = document.querySelector('footer');
  return JSON.stringify({
    logHeight: Math.round(rect(document.getElementById('log')).height),
    controlsVisible: Math.round(rect(controls).height),
    controlsScrolls: controls.scrollHeight > controls.clientHeight,
    controlAboveLog: rect(controls).bottom <= rect(wrap).top + 1,
    logAboveFooter: rect(wrap).bottom <= rect(footer).top + 1,
    bodyClipped: document.body.scrollHeight > window.innerHeight + 1,
    errors: window.__rendererErrors,
  });
})()`;

test('GUI layout stays usable at the minimum window size', {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const page = stubPage();
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-gui-min-'));
  let ui = null;
  try {
    ui = await openUi({
      baseUrl: pathToFileURL(page.file).href,
      screenshots: [],
      artifactsDir,
      // The launcher's minimum size (gui/main.js: minWidth 820, minHeight 560).
      viewport: { width: 820, height: 560 },
      probes: { layout: MIN_LAYOUT, design: DESIGN, theme: THEME },
    });
    const layout = JSON.parse(ui.extra.layout);
    const design = JSON.parse(ui.extra.design);
    const theme = JSON.parse(ui.extra.theme);
    assert.equal(layout.logHeight >= 120, true, JSON.stringify(layout));
    assert.equal(layout.controlAboveLog, true, JSON.stringify(layout));
    assert.equal(layout.logAboveFooter, true, JSON.stringify(layout));
    assert.equal(layout.bodyClipped, false, JSON.stringify(layout));
    assert.deepEqual(layout.errors, []);
    assert.deepEqual(design.ragged, [], JSON.stringify(design.ragged));
    assert.deepEqual(design.overflow, [], JSON.stringify(design.overflow));
    assert.deepEqual(design.overlaps, [], JSON.stringify(design.overlaps));
    assert.deepEqual(design.fieldOverflow, [], JSON.stringify(design.fieldOverflow));
    assert.equal(design.bodyOverflowX <= 1, true, `body overflows horizontally by ${design.bodyOverflowX}px`);
    assert.equal(theme.logLight, true, JSON.stringify(theme));
    assert.equal(theme.titlebarLight, true, JSON.stringify(theme));
    assert.equal(theme.logContrast >= 7, true, JSON.stringify(theme));
  } finally {
    if (ui) await ui.close();
    fs.rmSync(page.dir, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
