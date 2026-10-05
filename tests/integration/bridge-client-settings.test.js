import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bootWeb } from '../../src/boot-supervisor.js';
import { openUi } from '../../src/browser-driver.js';
import { createIsolatedHome } from '../../src/home-manager.js';
import { installProfilePlugins } from '../../src/plugin-install.js';
import { mintAuthCookie } from '../../src/port-and-token.js';
import { writeMinimalProfile } from '../../src/profile-builder.js';
import { locateRuntime, readRuntimeVersion } from '../../src/runtime-locator.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const bridgeDir = path.resolve('bridge-plugin');

/**
 * Click the bridge settings section, wait for its summary fetch, then click the
 * inline-preview button and inspect the sandboxed srcdoc iframe.
 */
const BRIDGE_SECTION_PROBE = `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const realFetch = window.fetch.bind(window);
  let statusCalls = 0;
  const runningJob = { id: 'ui-job', status: 'running', plugin: 'fixtures/plugins/dup-slot-one', online: false, startedAt: Date.now(), finishedAt: null, summary: null, error: null };
  const doneSummary = { ok: true, runId: 'b2-client-run', checks: { total: 1, passed: 1, failed: 0 }, hasReport: true, loopbackReportUrl: 'http://127.0.0.1:1/dsh-lab-bridge/latest/report.html' };
  const doneJob = { ...runningJob, status: 'done', finishedAt: Date.now(), summary: doneSummary };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/dsh-lab-bridge/verify/status')) {
      statusCalls += 1;
      const job = statusCalls === 1 ? null : (statusCalls === 2 ? runningJob : doneJob);
      return new Response(JSON.stringify({ job }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/dsh-lab-bridge/verify/cancel')) {
      return new Response(JSON.stringify({ job: doneJob }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/dsh-lab-bridge/shell')) {
      return new Response(JSON.stringify({ launched: { pid: 4321, args: ['lab.js', 'shell'] } }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/dsh-lab-bridge/verify')) {
      return new Response(JSON.stringify({ job: runningJob }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  };
  const nav = [...document.querySelectorAll('[data-slot="settings.section"]')]
    .find((el) => el.textContent.includes('实验舱桥接'))
    ?? [...document.querySelectorAll('button, [role="button"], a')].find((el) => el.textContent.includes('实验舱桥接'));
  if (!nav) return JSON.stringify({ found: false });
  (nav.closest('button, [role="button"], a') ?? nav).click();
  await wait(2000);
  const locationBefore = window.location.href;
  const bridgeAnchors = [...document.querySelectorAll('a')]
    .filter((el) => (el.getAttribute('href') ?? '').includes('/dsh-lab-bridge')).length;
  const input = document.querySelector('input[placeholder^="插件规格"]') ?? document.querySelector('input[type="text"]');
  const reactPropsKey = input
    ? Object.getOwnPropertyNames(input).find((key) => key.startsWith('__reactProps$'))
    : null;
  const reactProps = reactPropsKey ? input[reactPropsKey] : null;
  const nextValue = 'fixtures/plugins/dup-slot-one';
  let reactPropsUsed = false;
  if (reactProps && typeof reactProps.onInput === 'function') {
    reactProps.onInput({ target: { value: nextValue } });
    reactPropsUsed = true;
  } else if (reactProps && typeof reactProps.onChange === 'function') {
    reactProps.onChange({ target: { value: nextValue } });
    reactPropsUsed = true;
  } else {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await wait(300);
  const startButton = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('开始验证'));
  if (startButton) startButton.click();
  await wait(600);
  const runningSeen = document.body.innerText.includes('进行中');
  await wait(3400);
  const textAfterDone = document.body.innerText;
  const shellButton = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('打开壳界面'));
  if (shellButton) shellButton.click();
  await wait(300);
  const shellMessageSeen = document.body.innerText.includes('已打开壳窗口');
  let openedUrl = null;
  const originalOpen = window.open;
  window.open = (url, target, features) => { openedUrl = url; return { url, target, features }; };
  const externalButton = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('在浏览器打开'));
  if (externalButton) externalButton.click();
  window.open = originalOpen;
  const previewButton = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('内嵌查看报告'));
  if (previewButton) previewButton.click();
  await wait(2000);
  const iframe = document.querySelector('iframe[title="实验舱报告"]');
  window.fetch = realFetch;
  return JSON.stringify({
    found: true,
    runningSeen,
    shellMessageSeen,
    inputFound: Boolean(input),
    inputValue: input ? input.value : null,
    reactPropsUsed,
    startFound: Boolean(startButton),
    startDisabled: startButton ? startButton.disabled : null,
    tokenPresent: Boolean(globalThis.__DSH_LAB_BRIDGE__ && globalThis.__DSH_LAB_BRIDGE__.token),
    bodySample: document.body.innerText.slice(0, 800),
    hasRunId: textAfterDone.includes('b2-client-run'),
    hasPreviewButton: Boolean(previewButton),
    hasExternalButton: Boolean(externalButton),
    openedUrl,
    bridgeAnchors,
    locationUnchanged: window.location.href === locationBefore,
    hasIframe: Boolean(iframe),
    iframeHasReport: Boolean(iframe && iframe.srcdoc && iframe.srcdoc.includes('B2 inline report')),
  });
})()`;

test('the bridge settings section shows the latest summary and previews the report inline', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const runtime = locateRuntime();
  const version = (await readRuntimeVersion(runtime)).version;
  const iso = createIsolatedHome({ withAgents: true });
  const seededRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-seed-'));
  const uiArtifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-ui-'));
  let boot = null;
  let ui = null;
  try {
    const runDir = path.join(seededRoot, 'b2-client-run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({
      ok: true,
      runId: 'b2-client-run',
      checks: [{ name: 'runtime-located', pass: true }],
      artifacts: { reportHtml: path.join(runDir, 'report.html') },
    }), 'utf8');
    fs.writeFileSync(
      path.join(runDir, 'report.html'),
      '<!doctype html><html><body><h1>B2 inline report</h1></body></html>',
      'utf8',
    );

    const profileName = 'lab-bridge-client';
    const profileDir = iso.profileDir(profileName);
    writeMinimalProfile(profileDir, { name: profileName });
    const env = {
      DSH_HOME: iso.home,
      DSH_AGENTS_HOME: iso.agents,
      TEMP: iso.tmp,
      TMP: iso.tmp,
    };
    const install = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: [bridgeDir],
      fixture: false,
    });
    assert.equal(install.stage, 'postcheck', JSON.stringify(install.validation?.summary ?? install));

    boot = await bootWeb({
      runtime,
      home: iso.home,
      agentsHome: iso.agents,
      profileDir,
      profileName,
      tmpDir: iso.tmp,
      env: { DSH_LAB_BRIDGE_ARTIFACTS: seededRoot },
    });
    const auth = await mintAuthCookie(boot.url);
    assert.equal(auth.status, 303);

    ui = await openUi({
      baseUrl: boot.url,
      screenshots: [],
      screenshotsSettings: ['settings'],
      openSettings: true,
      probesAfter: { bridgeSection: BRIDGE_SECTION_PROBE },
      assertTokens: ['--dsw-alias-bg-base'],
      artifactsDir: uiArtifacts,
    });
    const probe = JSON.parse(ui.extraAfter.bridgeSection);
    assert.equal(probe.found, true, 'the 实验舱桥接 settings section must be present');
    assert.equal(probe.runningSeen, true, `starting a verification must show the running state: ${JSON.stringify(probe)}`);
    assert.equal(probe.shellMessageSeen, true, 'clicking 打开壳界面 must report the launched shell');
    assert.equal(probe.hasRunId, true, 'the section must show the latest seeded runId');
    assert.equal(probe.hasPreviewButton, true, 'the section must expose the inline preview button');
    assert.equal(probe.bridgeAnchors, 0, 'no anchor may navigate the SPA to the report URL');
    assert.equal(probe.locationUnchanged, true, 'clicking controls must not navigate the top-level SPA');
    assert.equal(probe.hasExternalButton, true, 'the loopback report URL must be offered as an external-open button');
    assert.match(probe.openedUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+\/dsh-lab-bridge\/latest\/report\.html$/);
    assert.equal(probe.hasIframe, true, 'clicking preview must mount the report iframe');
    assert.equal(probe.iframeHasReport, true, 'the iframe must contain the seeded report HTML');
    assert.equal(ui.settingsProbe?.totalSlots > 0, true);
  } finally {
    if (ui) {
      try { await ui.close(); } catch { /* ignore */ }
    }
    if (boot) {
      try { await boot.stop(); } catch { /* ignore */ }
    }
    await iso.dispose();
    fs.rmSync(seededRoot, { recursive: true, force: true });
    fs.rmSync(uiArtifacts, { recursive: true, force: true });
  }
});
