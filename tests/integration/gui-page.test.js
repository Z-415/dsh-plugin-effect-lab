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
window.__profileDirCalls = [];
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
      {
        name: 'dev',
        plugins: [{ spec: 'dsh-plugin-wallpaper-engine@1.2.0' }, { spec: 'dsh-ui-tweaks@0.20.0' }],
        nodeModulesExists: true,
        dependenciesCount: 2,
        bundlesCount: 4,
        lastRunAt: 1700000000000,
      },
      { name: 'plain', plugins: [], nodeModulesExists: false, dependenciesCount: 0, bundlesCount: 0, lastRunAt: null },
    ],
  }),
  openProfileDir: async (name) => { window.__profileDirCalls.push(name); return { opened: true }; },
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

/** The source dropdown must build npm:/github: specs and pick the network flag. */
const SOURCE_SELECT = `(async () => {
  const input = document.getElementById('plugin');
  const source = document.getElementById('pluginSource');
  const button = document.getElementById('runResolvePlugin');
  const calls = {};
  for (const [value, raw] of [
    ['npm', 'dsh-plugin-x@1.2.3'],
    ['github', 'owner/repo#v1'],
    ['path', 'C:\\\\tmp\\\\my-plugin'],
    ['tarball', 'C:\\\\tmp\\\\my-plugin.tgz'],
  ]) {
    source.value = value;
    input.value = raw;
    window.__calls = [];
    button.disabled = false;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    calls[value] = window.__calls.at(-1) ?? null;
  }
  return JSON.stringify({
    options: [...source.options].map((option) => option.value),
    calls,
    errors: window.__rendererErrors,
  });
})()`;

/** The profile drawer must list rows with the five inline actions. */
const PROFILE_DRAWER = `(async () => {
  await new Promise((resolve) => setTimeout(resolve, 80));
  const listButton = document.getElementById('runListProfiles');
  listButton.disabled = false;
  listButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const drawer = document.getElementById('profileDrawer');
  const rows = [...document.querySelectorAll('#profileList .prow')];
  const first = rows[0];
  const buttons = first ? [...first.querySelectorAll('button')].map((button) => button.textContent.trim()) : [];
  window.__calls = [];
  const cloneButton = first ? [...first.querySelectorAll('button')].find((button) => button.textContent.includes('克隆')) : null;
  if (cloneButton) cloneButton.click();
  window.prompt = () => 'dsh-ui-tweaks';
  window.confirm = () => true;
  const clickRowButton = (label) => {
    const button = first ? [...first.querySelectorAll('button')].find((item) => item.textContent.includes(label)) : null;
    if (!button) return;
    button.disabled = false;
    button.click();
  };
  window.__profileDirCalls = [];
  clickRowButton('打开目录');
  clickRowButton('卸载插件');
  clickRowButton('删除 profile');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const wasOpen = drawer.hidden === false;
  // Close before the layout probes so the fixed drawer is not measured on top
  // of the page buttons.
  drawer.hidden = true;
  return JSON.stringify({
    open: wasOpen,
    rowCount: rows.length,
    firstText: first ? first.textContent : null,
    buttons,
    calls: window.__calls,
    dirCalls: window.__profileDirCalls,
    errors: window.__rendererErrors,
  });
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
  // Label of every 更多 button must stay on one line (the cross-version matrix
  // label used to wrap inside a half-width cell).
  const lineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  };
  const multiline = [...more.querySelectorAll('button')]
    .filter((btn) => btn.getBoundingClientRect().height > 0 && lineCount(btn) > 1)
    .map((btn) => btn.textContent.trim());
  const openLayoutOk = rect(document.getElementById('log')).height >= 120
    && rect(controls).bottom <= rect(document.querySelector('.logwrap')).top + 1;
  // Simulate a failed run finishing so the banner and the toast fire.
  window.__handlers.done({ code: 1 });
  const banner = document.getElementById('banner');
  return JSON.stringify({
    layoutOk,
    moreCollapsed,
    multiline,
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

/** A long output must scroll inside the log pane, not squeeze the controls. */
const LONG_LOG = `(() => {
  const log = document.getElementById('log');
  const controls = document.getElementById('controls');
  const wrap = document.querySelector('.logwrap');
  const footer = document.querySelector('footer');
  const height = (el) => Math.round(el.getBoundingClientRect().height);
  const before = { controls: height(controls), log: height(wrap) };
  log.textContent = Array.from({ length: 600 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(80)).join('\\n');
  const after = { controls: height(controls), log: height(wrap) };
  return JSON.stringify({
    before,
    after,
    logScrolls: log.scrollHeight > log.clientHeight + 1,
    logAboveFooter: wrap.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 1,
    bodyClipped: document.body.scrollHeight > window.innerHeight + 1,
    errors: window.__rendererErrors,
  });
})()`;

/** Buttons carry their state with a fill, not an outline. */
const BUTTONS = `(() => {
  const read = (selector) => {
    const cs = getComputedStyle(document.querySelector(selector));
    const transparent = cs.borderTopColor === 'rgba(0, 0, 0, 0)' || cs.borderTopColor === 'transparent';
    return { bg: cs.backgroundColor, color: cs.color, borderless: transparent };
  };
  return JSON.stringify({
    normal: read('#runShellPluginTimed'),
    strong: read('#runShellPlugin'),
    primary: read('#runVerifyPlugin'),
    danger: read('#runRemovePlugin'),
    preset: read('button[data-args="verify"]'),
    menu: read('.menu-btn'),
    errors: window.__rendererErrors,
  });
})()`;

/** A structured progress line must drive the bar, and plain lines still log. */
const PROGRESS = `(() => {
  const marker = '\\u001eLABPROG\\u001e';
  window.__handlers.output(marker + JSON.stringify({
    phase: 'boot-host', index: 5, total: 8, label: '启动宿主', detail: 'port 1', elapsedMs: 1000, phaseMs: 500,
  }) + '\\n');
  const wrap = document.getElementById('progressWrap');
  const bar = document.getElementById('progress');
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');
  const running = {
    hidden: wrap.hidden,
    width: fill.style.width,
    text: text.textContent,
    running: bar.classList.contains('running'),
  };
  window.__handlers.output('plain progress line\\n');
  window.__handlers.done({ code: 0 });
  const done = {
    width: fill.style.width,
    text: text.textContent,
    done: bar.classList.contains('done'),
    running: bar.classList.contains('running'),
  };
  return JSON.stringify({
    running,
    done,
    logTail: document.getElementById('log').textContent.includes('plain progress line'),
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
        sourceSelect: SOURCE_SELECT,
        profileDrawer: PROFILE_DRAWER,
        layout: LAYOUT_AND_BANNER,
        design: DESIGN,
        theme: THEME,
        menus: MENUS,
        longLog: LONG_LOG,
        buttons: BUTTONS,
        progress: PROGRESS,
      },
    });
    const result = JSON.parse(ui.extra.clickAll);
    const desktop = JSON.parse(ui.extra.desktop);
    const profiles = JSON.parse(ui.extra.profiles);
    const sourceSelect = JSON.parse(ui.extra.sourceSelect);
    const profileDrawer = JSON.parse(ui.extra.profileDrawer);
    const layout = JSON.parse(ui.extra.layout);
    const design = JSON.parse(ui.extra.design);
    const theme = JSON.parse(ui.extra.theme);
    const menus = JSON.parse(ui.extra.menus);
    const longLog = JSON.parse(ui.extra.longLog);
    const buttons = JSON.parse(ui.extra.buttons);
    const progress = JSON.parse(ui.extra.progress);

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
      result.calls.some((args) => args[0] === 'verify' && args.includes('--fixture-variant') && args.includes('rich')),
      true,
      'the 思考 / 代码夹具 button must dispatch the rich variant',
    );
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

    // The source dropdown decides the --plugin prefix and the network flag.
    assert.deepEqual(sourceSelect.options, ['npm', 'github', 'path', 'tarball']);
    const npmCall = sourceSelect.calls.npm;
    assert.equal(npmCall.includes('--plugin'), true, JSON.stringify(sourceSelect));
    assert.equal(npmCall[npmCall.indexOf('--plugin') + 1], 'npm:dsh-plugin-x@1.2.3');
    assert.equal(npmCall.includes('--online'), true);
    const githubCall = sourceSelect.calls.github;
    assert.equal(githubCall[githubCall.indexOf('--plugin') + 1], 'github:owner/repo#v1');
    assert.equal(githubCall.includes('--online'), true);
    const pathCall = sourceSelect.calls.path;
    assert.equal(pathCall[pathCall.indexOf('--plugin') + 1], 'C:\\tmp\\my-plugin');
    assert.equal(pathCall.includes('--offline'), true);
    const tarballCall = sourceSelect.calls.tarball;
    assert.equal(tarballCall[tarballCall.indexOf('--plugin') + 1], 'C:\\tmp\\my-plugin.tgz');
    assert.equal(tarballCall.includes('--offline'), true);
    assert.deepEqual(sourceSelect.errors, []);

    // The profile drawer lists every profile with the five inline actions.
    assert.equal(profileDrawer.open, true);
    assert.equal(profileDrawer.rowCount, 2, JSON.stringify(profileDrawer));
    assert.match(profileDrawer.firstText, /dev/);
    assert.match(profileDrawer.firstText, /dsh-plugin-wallpaper-engine@1\.2\.0/);
    assert.deepEqual(profileDrawer.buttons, [
      '在壳窗口打开',
      '克隆为一次性运行',
      '卸载插件',
      '打开目录',
      '删除 profile',
    ]);
    const cloneCall = profileDrawer.calls.find((args) => args[0] === 'verify' && args.includes('--plugin'));
    assert.equal(cloneCall[0], 'verify');
    assert.equal(cloneCall.includes('--plugin'), true);
    assert.equal(cloneCall[cloneCall.indexOf('--plugin') + 1], 'dsh-plugin-wallpaper-engine@1.2.0');
    assert.equal(cloneCall.includes('--online'), true);
    assert.deepEqual(profileDrawer.dirCalls, ['dev']);
    const uninstallCall = profileDrawer.calls.find((args) => args[0] === 'profile' && args[1] === 'remove-plugin');
    assert.deepEqual(uninstallCall.slice(0, 4), ['profile', 'remove-plugin', 'dev', 'dsh-ui-tweaks']);
    const removeCall = profileDrawer.calls.find((args) => args[0] === 'profile' && args[1] === 'remove');
    assert.deepEqual(removeCall, ['profile', 'remove', 'dev']);
    assert.deepEqual(profileDrawer.errors, []);

    // The log pane must stay on screen; adding controls must not squeeze it out.
    assert.equal(layout.layoutOk, true, JSON.stringify(layout));
    assert.equal(layout.logHeight >= 120, true, JSON.stringify(layout));
    assert.equal(layout.bodyClipped, false, JSON.stringify(layout));
    assert.equal(layout.controls.visible >= 100, true, JSON.stringify(layout));
    assert.equal(layout.moreCollapsed, true, 'the 更多 area must start collapsed so it costs no height');
    assert.deepEqual(layout.multiline, [], `更多 buttons wrapped onto two lines: ${JSON.stringify(layout.multiline)}`);
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

    // A long output scrolls inside the log pane and leaves the controls alone.
    assert.equal(longLog.logScrolls, true, JSON.stringify(longLog));
    assert.equal(longLog.after.controls >= longLog.before.controls - 1, true, JSON.stringify(longLog));
    assert.equal(longLog.after.log <= longLog.before.log + 1, true, JSON.stringify(longLog));
    assert.equal(longLog.logAboveFooter, true, JSON.stringify(longLog));
    assert.equal(longLog.bodyClipped, false, JSON.stringify(longLog));
    assert.deepEqual(longLog.errors, []);

    // Buttons are borderless and filled; the primary keeps the accent fill.
    for (const [name, style] of Object.entries(buttons)) {
      if (name === 'errors') continue;
      assert.equal(style.borderless, true, `${name} keeps a border: ${JSON.stringify(buttons)}`);
    }
    // Plain buttons are the light blue; the accents step apart from them.
    assert.equal(buttons.normal.bg, 'rgb(242, 246, 255)', JSON.stringify(buttons));
    assert.equal(buttons.preset.bg, 'rgb(242, 246, 255)', JSON.stringify(buttons));
    assert.equal(buttons.strong.bg, 'rgb(219, 234, 254)', JSON.stringify(buttons));
    assert.equal(buttons.primary.bg, 'rgb(37, 99, 235)', JSON.stringify(buttons));
    assert.equal(buttons.danger.bg, 'rgb(253, 241, 240)', JSON.stringify(buttons));
    // Title-bar menu buttons keep plain text instead of the accent colour.
    assert.equal(buttons.menu.color, 'rgb(31, 35, 41)', JSON.stringify(buttons));

    // Structured progress drives a real phase fraction; plain lines still log.
    assert.equal(progress.running.hidden, false);
    assert.equal(progress.running.width, '50%', JSON.stringify(progress));
    assert.match(progress.running.text, /\[5\/8\] 启动宿主 · port 1/);
    assert.equal(progress.running.running, true);
    assert.equal(progress.done.width, '100%');
    assert.equal(progress.done.done, true);
    assert.equal(progress.done.running, false);
    assert.equal(progress.logTail, true);
    assert.deepEqual(progress.errors, []);
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
