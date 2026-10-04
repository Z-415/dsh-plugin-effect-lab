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
window.__rendererErrors = [];
window.addEventListener('error', (event) => window.__rendererErrors.push(String(event.message)));
window.prompt = () => null;
window.confirm = () => false;
window.labGui = {
  run: async (args) => { window.__calls.push(args); return { started: true }; },
  stop: async () => ({ stopped: true }),
  openReport: async () => ({ opened: false, reason: 'stub' }),
  openArtifacts: async () => ({ opened: false }),
  info: async () => ({ electron: 'stub', node: 'stub', repo: 'stub' }),
  onStarted: () => {},
  onOutput: () => {},
  onDone: () => {},
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
      probes: { clickAll: CLICK_ALL },
    });
    const result = JSON.parse(ui.extra.clickAll);
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
  } finally {
    if (ui) await ui.close();
    fs.rmSync(page.dir, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
