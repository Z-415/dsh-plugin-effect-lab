import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createIsolatedHome } from '../../src/home-manager.js';
import { installProfilePlugins } from '../../src/plugin-install.js';
import { writeMinimalProfile } from '../../src/profile-builder.js';
import { locateRuntime, readRuntimeVersion } from '../../src/runtime-locator.js';

const enabled = process.env.DSH_LAB_E2E === '1';

test('adding a second plugin audits the whole profile for cross-plugin conflicts', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  const runtime = locateRuntime();
  const version = (await readRuntimeVersion(runtime)).version;
  const iso = createIsolatedHome({ withAgents: true });
  try {
    const profileName = 'lab-audit';
    const profileDir = iso.profileDir(profileName);
    writeMinimalProfile(profileDir, { name: profileName });
    const env = {
      DSH_HOME: iso.home,
      DSH_AGENTS_HOME: iso.agents,
      TEMP: iso.tmp,
      TMP: iso.tmp,
    };

    const first = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: [path.resolve('fixtures/plugins/dup-slot-one')],
      fixture: false,
    });
    assert.equal(first.stage, 'postcheck', JSON.stringify(first.validation?.summary ?? {}));
    assert.deepEqual(first.profileAudit.conflicts, [], 'one plugin alone must not conflict');

    // Installing the second plugin is what reveals the A+B conflict.
    const second = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: [path.resolve('fixtures/plugins/dup-slot-two')],
      fixture: false,
    });
    const ids = second.profileAudit.conflicts.map((conflict) => conflict.id).sort();
    assert.equal(ids.includes('duplicate-slot-registration-id'), true, JSON.stringify(second.profileAudit.conflicts));
    assert.equal(ids.includes('duplicate-tool-name'), true);
    assert.equal(ids.includes('duplicate-loader-id'), false, 'loader ids are distinct');
    assert.equal(second.summary.ok, false, 'the conflict must reach the findings summary');
  } finally {
    await iso.dispose();
  }
});
