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
window.__rendererErrors = [];
window.addEventListener('error', (event) => window.__rendererErrors.push(String(event.message)));
window.prompt = () => null;
window.confirm = () => false;
window.labGui = {
  run: async (args) => { window.__calls.push(args); return { started: true }; },
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
      },
    });
    const result = JSON.parse(ui.extra.clickAll);
    const desktop = JSON.parse(ui.extra.desktop);
    const profiles = JSON.parse(ui.extra.profiles);
    const layout = JSON.parse(ui.extra.layout);

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
  } finally {
    if (ui) await ui.close();
    fs.rmSync(page.dir, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
