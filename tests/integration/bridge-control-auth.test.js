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

async function readInjectedToken(origin, cookie) {
  const index = await fetch(`${origin}/`, { headers: { cookie } });
  assert.equal(index.status, 200);
  const html = await index.text();
  const injected = /__DSH_LAB_BRIDGE__[^=]*=\s*(\{.*?\})<\/script>/.exec(html);
  assert.ok(injected, 'the index must carry the __DSH_LAB_BRIDGE__ injection');
  const token = JSON.parse(injected[1]).token;
  assert.equal(typeof token, 'string');
  assert.equal(token.length >= 32, true);
  return token;
}

async function withBridgeHost(fn, options = {}) {
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
      env: options.env ?? {},
    });
    const auth = await mintAuthCookie(boot.url);
    assert.equal(auth.status, 303);
    const token = await readInjectedToken(boot.origin, auth.cookie);
    return await fn({ boot, auth, token });
  } finally {
    if (boot) {
      try { await boot.stop(); } catch { /* ignore */ }
    }
    await iso.dispose();
    fs.rmSync(iso.root, { recursive: true, force: true });
  }
}

test('the real host injects the control token and the control route enforces it', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  await withBridgeHost(async ({ boot, token }) => {
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
  });
});

test('the control plane runs a real verification and exposes its report', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  await withBridgeHost(async ({ boot, token }) => {
    const start = await fetch(`${boot.origin}/dsh-lab-bridge/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-lab-token': token },
      body: JSON.stringify({ plugin: 'fixtures/plugins/does-not-exist' }),
    });
    assert.equal(start.status, 202);
    const started = await start.json();
    assert.equal(started.job.status, 'running');

    let job = started.job;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && job.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await fetch(`${boot.origin}/dsh-lab-bridge/verify/status`, {
        headers: { 'x-dsh-lab-token': token },
      });
      assert.equal(status.status, 200);
      job = (await status.json()).job;
    }
    assert.equal(job.status, 'done', JSON.stringify(job));
    assert.equal(job.summary.parsed, true);
    assert.equal(job.summary.ok, false, 'the missing plugin must fail the report');
    assert.equal(typeof job.summary.runId, 'string');

    const latest = await fetch(`${boot.origin}/dsh-lab-bridge/latest.json`);
    assert.equal(latest.status, 200);
    const latestJson = await latest.json();
    assert.equal(latestJson.hasReport, true);
    assert.equal(latestJson.runId, job.summary.runId);
  });
});

test('a selected persistent profile is used and kept', {
  skip: !enabled,
  timeout: 300_000,
}, async () => {
  const profilesRoot = fs.mkdtempSync(path.join(process.env.TEMP ?? '.', 'dsh-lab-profiles-e2e-'));
  try {
    await withBridgeHost(async ({ boot, token }) => {
      const start = await fetch(`${boot.origin}/dsh-lab-bridge/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-lab-token': token },
        body: JSON.stringify({ plugin: 'fixtures/plugins/does-not-exist', profileLab: 'test1' }),
      });
      assert.equal(start.status, 202);
      const started = await start.json();
      assert.equal(started.job.profileLab, 'test1');

      let job = started.job;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && job.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const status = await fetch(`${boot.origin}/dsh-lab-bridge/verify/status`, {
          headers: { 'x-dsh-lab-token': token },
        });
        assert.equal(status.status, 200);
        job = (await status.json()).job;
      }
      assert.equal(job.status, 'done', JSON.stringify(job));
      assert.equal(job.profileLab, 'test1');
      assert.equal(fs.existsSync(path.join(profilesRoot, 'test1', 'lab-profile.json')), true);
    }, { env: { DSH_LAB_PROFILES: profilesRoot } });
  } finally {
    fs.rmSync(profilesRoot, { recursive: true, force: true });
  }
});
