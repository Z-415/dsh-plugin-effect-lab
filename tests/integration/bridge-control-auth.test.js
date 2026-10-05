import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { bootWeb } from '../../src/boot-supervisor.js';
import { createIsolatedHome } from '../../src/home-manager.js';
import { installProfilePlugins } from '../../src/plugin-install.js';
import { mintAuthCookie } from '../../src/port-and-token.js';
import { writeMinimalProfile } from '../../src/profile-builder.js';
import { locateRuntime, readRuntimeVersion } from '../../src/runtime-locator.js';

const enabled = process.env.DSH_LAB_E2E === '1';
const bridgeDir = path.resolve('bridge-plugin');

test('the real host injects the control token and the control route enforces it', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const runtime = locateRuntime();
  const version = (await readRuntimeVersion(runtime)).version;
  const iso = createIsolatedHome({ withAgents: true });
  let boot = null;
  try {
    const profileName = 'lab-bridge-control';
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

    const index = await fetch(`${boot.origin}/`, { headers: { cookie: auth.cookie } });
    assert.equal(index.status, 200);
    const html = await index.text();
    const injected = /__DSH_LAB_BRIDGE__[^=]*=\s*(\{.*?\})<\/script>/.exec(html);
    assert.ok(injected, 'the index must carry the __DSH_LAB_BRIDGE__ injection');
    const token = JSON.parse(injected[1]).token;
    assert.equal(typeof token, 'string');
    assert.equal(token.length >= 32, true);

    const noToken = await fetch(`${boot.origin}/dsh-lab-bridge/verify/status`);
    assert.equal(noToken.status, 401);

    const wrongToken = await fetch(`${boot.origin}/dsh-lab-bridge/verify/status`, {
      headers: { 'x-dsh-lab-token': 'not-the-token' },
    });
    assert.equal(wrongToken.status, 401);

    const withToken = await fetch(`${boot.origin}/dsh-lab-bridge/verify/status`, {
      headers: { 'x-dsh-lab-token': token },
    });
    assert.equal(withToken.status, 200);
    assert.equal((await withToken.json()).job, null);
  } finally {
    if (boot) {
      try { await boot.stop(); } catch { /* ignore */ }
    }
    await iso.dispose();
    fs.rmSync(iso.root, { recursive: true, force: true });
  }
});
