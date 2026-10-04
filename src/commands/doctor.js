import fs from 'node:fs';
import path from 'node:path';
import { findBrowser } from '../browser-driver.js';
import { createIsolatedHome } from '../home-manager.js';
import { runCommand } from '../process-tree.js';
import { snapshotRealHome } from '../real-home-guard.js';
import { locateRuntime, readRuntimeVersion } from '../runtime-locator.js';
import { tail } from '../util.js';

export async function runDoctor(options = {}) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  let iso = null;
  try {
    const runtime = locateRuntime(options.runtimePath);
    add('runtime-located', fs.existsSync(runtime.cmd), runtime.cmd);

    const version = await readRuntimeVersion(runtime);
    add('runtime-version', version.version === '0.2.0-rc.2', `detected ${version.version ?? 'unknown'}`);

    const major = Number(process.versions.node.split('.')[0]);
    add('node-version', major >= 22, `node ${process.versions.node}`);
    add('global-websocket', typeof WebSocket !== 'undefined', typeof WebSocket);

    iso = createIsolatedHome({ withAgents: true });
    const probeFile = path.join(iso.tmp, 'write-probe.txt');
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    add('temp-home-writable', fs.readFileSync(probeFile, 'utf8') === 'ok', `${iso.root} (${iso.root.length} chars)`);

    const browser = findBrowser(options.browserPath);
    add('browser-found', true, browser);

    const baseline = snapshotRealHome();
    add(
      'real-home-guard',
      true,
      `${Object.keys(baseline.files).length} structural files hashed; no credentials/sessions/settings read`,
    );

    const desktop = await runCommand(runtime.cmd, ['--profile', 'desktop', '--dump-config'], {
      cwd: iso.root,
      env: { DSH_HOME: iso.home, TEMP: iso.tmp, TMP: iso.tmp },
      timeoutMs: 60_000,
    });
    const desktopOutput = `${desktop.stdout}\n${desktop.stderr}`;
    add(
      'desktop-profile-refused',
      desktop.code !== 0 && /managed exclusively by the Electron application/i.test(desktopOutput),
      tail(desktopOutput, 400) || `exit ${desktop.code}`,
    );
  } catch (error) {
    add('doctor-run', false, String(error?.message ?? error));
  } finally {
    if (iso) await iso.dispose();
  }
  const ok = checks.every((check) => check.pass);
  const report = { ok, checks, node: process.versions.node, platform: process.platform, cwd: process.cwd() };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`DSH Plugin Effect Lab doctor: ${ok ? 'PASS' : 'FAIL'}\n`);
    for (const check of checks) process.stdout.write(`[${check.pass ? 'PASS' : 'FAIL'}] ${check.name}: ${check.detail}\n`);
  }
  return ok ? 0 : 1;
}
