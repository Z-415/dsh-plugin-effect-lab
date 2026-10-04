import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildGuiRuntime, GUI_APP_FILES, GUI_EXE_NAME, guiRuntimeDir } from '../../src/gui/runtime.js';

function makeFakeInstall(version, withExe = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-fake-install-'));
  fs.writeFileSync(path.join(dir, 'version'), `${version}\n`, 'utf8');
  if (withExe) fs.writeFileSync(path.join(dir, 'DeepSeek Harness.exe'), 'fake-binary', 'utf8');
  return dir;
}

test('the GUI runtime dir is keyed by the official Electron version', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-gui-home-'));
  const install = makeFakeInstall('44.9.9');
  process.env.DSH_LAB_GUI_HOME = home;
  try {
    assert.equal(guiRuntimeDir(install), path.join(home, 'gui-44.9.9'));
  } finally {
    delete process.env.DSH_LAB_GUI_HOME;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
  }
});

test('buildGuiRuntime drops the GUI app next to a renamed executable', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-gui-home-'));
  const install = makeFakeInstall('1.2.3');
  process.env.DSH_LAB_GUI_HOME = home;
  try {
    const built = await buildGuiRuntime(install);
    assert.equal(built.cached, false);
    assert.equal(path.basename(built.exe), GUI_EXE_NAME);
    assert.equal(fs.existsSync(built.exe), true);
    for (const name of GUI_APP_FILES) {
      assert.equal(fs.existsSync(path.join(built.appDir, name)), true, name);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(built.appDir, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'main.js');
    assert.equal(manifest.type, undefined, 'the GUI app must stay CommonJS');

    const again = await buildGuiRuntime(install);
    assert.equal(again.cached, true);
  } finally {
    delete process.env.DSH_LAB_GUI_HOME;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
  }
});

test('buildGuiRuntime refreshes a changed app file in the cached runtime', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-gui-home-'));
  const install = makeFakeInstall('2.0.0');
  process.env.DSH_LAB_GUI_HOME = home;
  try {
    const built = await buildGuiRuntime(install);
    const target = path.join(built.appDir, 'index.html');
    fs.writeFileSync(target, 'stale', 'utf8');
    const again = await buildGuiRuntime(install);
    assert.equal(again.cached, true);
    assert.notEqual(fs.readFileSync(target, 'utf8'), 'stale');
  } finally {
    delete process.env.DSH_LAB_GUI_HOME;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
  }
});
