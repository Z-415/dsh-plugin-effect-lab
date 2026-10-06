import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { createIsolatedHome } from '../../src/home-manager.js';
import { installProfilePlugins } from '../../src/plugin-install.js';
import { writeMinimalProfile } from '../../src/profile-builder.js';
import { locateRuntime, readRuntimeVersion } from '../../src/runtime-locator.js';

const enabled = process.env.DSH_LAB_E2E === '1';

function tarHeader(name, size, mtime) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return header;
}

/** Pack a plugin directory into a valid pnpm-installable tarball. */
function packDirectory(dir, prefix = 'package') {
  const chunks = [];
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      const data = fs.readFileSync(full);
      chunks.push(tarHeader(`${prefix}/${rel}`, data.length, Math.floor(fs.statSync(full).mtimeMs / 1000)));
      chunks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  };
  walk(dir, '');
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

async function isolatedRun(fn) {
  const runtime = locateRuntime();
  const version = (await readRuntimeVersion(runtime)).version;
  const iso = createIsolatedHome({ withAgents: true });
  try {
    const profileName = 'lab-sources';
    const profileDir = iso.profileDir(profileName);
    writeMinimalProfile(profileDir, { name: profileName });
    const env = {
      DSH_HOME: iso.home,
      DSH_AGENTS_HOME: iso.agents,
      DSH_TELEMETRY_DISABLED: '1',
      TEMP: iso.tmp,
      TMP: iso.tmp,
    };
    return await fn({ runtime, version, profileDir, profileName, env });
  } finally {
    await iso.dispose();
  }
}

test('a local directory source installs and reports the real name@version', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  await isolatedRun(async ({ runtime, version, profileDir, profileName, env }) => {
    const result = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: [path.resolve('fixtures/plugins/effect-probe')],
      fixture: false,
      online: false,
    });
    assert.equal(result.stage, 'postcheck', JSON.stringify(result.validation?.summary ?? result));
    assert.equal(result.pluginList.length, 1);
    assert.equal(result.pluginList[0].source, 'directory');
    assert.equal(result.pluginList[0].advertisedSpec, path.resolve('fixtures/plugins/effect-probe'));
    assert.equal(result.pluginList[0].resolvedSpec, 'dsh-lab-effect-probe@1.0.0');
    assert.equal(result.pluginList[0].resolved, 'dsh-lab-effect-probe@1.0.0');
  });
});

test('a tarball source installs and reports the real name@version', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-tarball-'));
  const tgz = path.join(packRoot, 'effect-probe.tgz');
  fs.writeFileSync(tgz, packDirectory(path.resolve('fixtures/plugins/effect-probe')));
  try {
    await isolatedRun(async ({ runtime, version, profileDir, profileName, env }) => {
      const result = await installProfilePlugins({
        runtime,
        env,
        profileDir,
        profileName,
        version,
        plugins: [tgz],
        fixture: false,
        online: false,
      });
      assert.equal(result.stage, 'postcheck', JSON.stringify(result.validation?.summary ?? result));
      assert.equal(result.pluginList[0].source, 'tarball');
      assert.equal(result.pluginList[0].resolvedSpec, 'dsh-lab-effect-probe@1.0.0');
    });
  } finally {
    fs.rmSync(packRoot, { recursive: true, force: true });
  }
});

test('npm: is stripped before pnpm sees the spec', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  await isolatedRun(async ({ runtime, version, profileDir, profileName, env }) => {
    // A package that is guaranteed not to exist. The offline install fails,
    // but the recorded argv proves pnpm received the stripped spec.
    const result = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: ['npm:dsh-lab-definitely-missing@9.9.9'],
      fixture: false,
      online: false,
    });
    assert.equal(result.stage, 'install');
    assert.equal(result.resolvedSpecs.includes('dsh-lab-definitely-missing@9.9.9'), true, JSON.stringify(result.resolvedSpecs));
    assert.equal(result.installArgs.includes('npm:dsh-lab-definitely-missing@9.9.9'), false);
    assert.equal(result.installArgs.includes('dsh-lab-definitely-missing@9.9.9'), true);
  });
});

test('a GitHub ref reaches pnpm unchanged', {
  skip: !enabled,
  timeout: 240_000,
}, async () => {
  await isolatedRun(async ({ runtime, version, profileDir, profileName, env }) => {
    const spec = 'github:owner/repo#v9.9.9';
    const result = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version,
      plugins: [spec],
      fixture: false,
      online: false,
    });
    assert.equal(result.stage, 'install', 'an offline GitHub install cannot succeed without a cached checkout');
    assert.equal(result.installArgs.includes(spec), true, JSON.stringify(result.installArgs));
  });
});
