import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildGuiRuntime } from '../gui/runtime.js';
import { runCommand } from '../process-tree.js';
import { locateRuntime } from '../runtime-locator.js';
import { ensureDir } from '../util.js';

const SHORTCUT_NAME = 'DSH Plugin Effect Lab';

function desktopShortcutScript(exe, workingDirectory) {
  return [
    `$desktop = [Environment]::GetFolderPath('Desktop')`,
    `$ws = New-Object -ComObject WScript.Shell`,
    `$lnk = $ws.CreateShortcut((Join-Path $desktop "${SHORTCUT_NAME}.lnk"))`,
    `$lnk.TargetPath = "${exe}"`,
    `$lnk.WorkingDirectory = "${workingDirectory}"`,
    `$lnk.IconLocation = "${exe},0"`,
    `$lnk.Description = "${SHORTCUT_NAME}"`,
    `$lnk.Save()`,
  ].join('; ');
}

/** Build (once) and launch the desktop GUI launcher. */
export async function runGuiCommand(options = {}) {
  const runtime = locateRuntime(options.runtimePath);
  const gui = await buildGuiRuntime(runtime.installDir, { force: options.rebuild === true });
  const userDataDir = ensureDir(path.join(gui.dir, 'userdata'));
  const configFile = path.join(userDataDir, 'gui-config.json');
  const config = {
    repo: path.resolve(process.cwd()),
    userDataDir,
  };
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  // Also next to the app, so double-clicking the exe works with no env vars.
  fs.writeFileSync(path.join(gui.appDir, 'gui-config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  let shortcut = null;
  if (options.installShortcut === true) {
    const result = await runCommand('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      desktopShortcutScript(gui.exe, gui.dir),
    ], { timeoutMs: 60_000 });
    shortcut = { created: result.code === 0, detail: (result.stdout + result.stderr).trim() || `exit ${result.code}` };
  }

  let launched = false;
  if (options.open !== false) {
    const child = spawn(gui.exe, [], {
      cwd: gui.dir,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: { ...process.env, DSH_LAB_GUI_CONFIG: configFile },
    });
    child.unref();
    launched = true;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, gui, configFile, shortcut, launched }, null, 2)}\n`);
  } else {
    process.stdout.write(`DSH Plugin Effect Lab GUI: ${launched ? 'launched' : 'built'}\n`);
    process.stdout.write(`exe: ${gui.exe}${gui.cached ? ' (cached)' : ` (copied ${Math.round(gui.bytes / 1024 / 1024)} MB in ${gui.copyMs} ms)`}\n`);
    process.stdout.write(`config: ${configFile}\n`);
    if (shortcut) process.stdout.write(`desktop shortcut: ${shortcut.created ? 'created' : 'FAILED'}${shortcut.created ? '' : ` (${shortcut.detail})`}\n`);
  }
  return 0;
}
