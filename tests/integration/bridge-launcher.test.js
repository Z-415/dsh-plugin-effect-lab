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

const LAUNCH_PROBE = `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const realFetch = window.fetch.bind(window);
  let launchToken = null;
  let launchBody = null;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/dsh-lab-bridge/launch')) {
      launchToken = init && init.headers ? init.headers['x-dsh-lab-token'] : null;
      launchBody = init ? init.body : null;
      return new Response(JSON.stringify({ launched: { pid: 4321, args: ['lab.js', 'gui'] } }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  };
  const nav = [...document.querySelectorAll('[data-slot="settings.section"]')]
    .find((el) => el.textContent.includes('实验舱桥接'))
    ?? [...document.querySelectorAll('button, [role="button"], a')].find((el) => el.textContent.includes('实验舱桥接'));
  if (!nav) return JSON.stringify({ found: false });
  (nav.closest('button, [role="button"], a') ?? nav).click();
  await wait(1500);
  const locationBefore = window.location.href;
  const anchors = [...document.querySelectorAll('a')]
    .filter((el) => (el.getAttribute('href') ?? '').includes('/dsh-lab-bridge')).length;
  const iframes = document.querySelectorAll('iframe').length;
  const launchButton = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('启动实验舱'));
  if (launchButton) launchButton.click();
  await wait(600);
  window.fetch = realFetch;
  return JSON.stringify({
    found: true,
    anchors,
    iframes,
    launchButtonFound: Boolean(launchButton),
    launchToken,
    launchBody,
    launchedStatusSeen: document.body.innerText.includes('实验舱已启动'),
    locationUnchanged: window.location.href === locationBefore,
  });
})()`;

test('the bridge panel is a single launch button that never leaves DSH', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const runtime = locateRuntime();
  const version = (await readRuntimeVersion(runtime)).version;
  const iso = createIsolatedHome({ withAgents: true });
  const uiArtifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-bridge-launch-ui-'));
  let boot = null;
  let ui = null;
  try {
    const profileName = 'lab-bridge-launcher';
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
    });
    const auth = await mintAuthCookie(boot.url);
    assert.equal(auth.status, 303);

    ui = await openUi({
      baseUrl: boot.url,
      screenshots: [],
      openSettings: true,
      probesAfter: { launchPanel: LAUNCH_PROBE },
      assertTokens: ['--dsw-alias-bg-base'],
      artifactsDir: uiArtifacts,
    });
    const probe = JSON.parse(ui.extraAfter.launchPanel);
    assert.equal(probe.found, true, 'the 实验舱桥接 settings section must be present');
    assert.equal(probe.anchors, 0, 'no report/navigation anchor may remain');
    assert.equal(probe.iframes, 0, 'no report iframe may remain');
    assert.equal(probe.launchButtonFound, true, 'the single 启动实验舱 button must be present');
    assert.equal(typeof probe.launchToken === 'string' && probe.launchToken.length > 0, true, 'the launch nonce must be injected');
    assert.equal(probe.launchBody, '{}', 'the launch request carries no caller arguments');
    assert.equal(probe.launchedStatusSeen, true, 'the panel must report a successful launch');
    assert.equal(probe.locationUnchanged, true, 'clicking launch must not navigate the DSH SPA');
  } finally {
    if (ui) {
      try { await ui.close(); } catch { /* ignore */ }
    }
    if (boot) {
      try { await boot.stop(); } catch { /* ignore */ }
    }
    await iso.dispose();
    fs.rmSync(uiArtifacts, { recursive: true, force: true });
  }
});
