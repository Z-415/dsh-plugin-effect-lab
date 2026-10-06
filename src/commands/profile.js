import fs from 'node:fs';
import path from 'node:path';
import {
  createLabProfile,
  forgetProfilePlugins,
  labProfileDir,
  labProfilesRoot,
  listLabProfiles,
  openLabProfileHome,
  readLabProfile,
  removeLabProfile,
} from '../lab-profile.js';
import { removeProfilePlugins } from '../plugin-install.js';
import { locateRuntime } from '../runtime-locator.js';

/**
 * `lab profile list|create|remove|path <name>` plus
 * `lab profile remove-plugin <name> <plugin...>`.
 *
 * Plugins are installed into a profile by running `verify`/`shell` with
 * `--profile-lab <name> --plugin <spec>`; the profile command manages the
 * skeleton and can uninstall a single plugin without deleting the profile.
 */
export async function runProfileCommand(options = {}) {
  const action = options.action ?? 'list';

  if (action === 'list') {
    const profiles = listLabProfiles();
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ root: labProfilesRoot(), profiles }, null, 2)}\n`);
    } else {
      process.stdout.write(`lab profiles: ${profiles.length} (${labProfilesRoot()})\n`);
      for (const profile of profiles) {
        const specs = profile.plugins.map((entry) => entry.spec);
        const cloneNote = profile.clonedFrom
          ? `cloned from ${profile.clonedFrom.kind} (${profile.clonedFrom.copiedFiles ?? 0} file(s))`
            + `${profile.clonedFrom.installed ? `, ${profile.clonedFrom.installed} plugin(s) installed` : ''}, `
          : '';
        process.stdout.write(`- ${profile.name}: ${cloneNote}${specs.length ? specs.join(', ') : 'no plugins recorded'}\n`);
      }
      if (!profiles.length) process.stdout.write('(none yet - create one with: lab shell --profile-lab dev --plugin <spec>)\n');
    }
    return 0;
  }

  if (!options.name) {
    process.stderr.write(`profile ${action} needs a name\n`);
    return 2;
  }

  if (action === 'create') {
    const { dir, manifest, created } = createLabProfile(options.name);
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: true, dir, manifest, created }, null, 2)}\n`);
    else process.stdout.write(`lab profile "${manifest.name}" ${created ? 'created' : 'already exists'}: ${dir}\n`);
    return 0;
  }

  if (action === 'remove') {
    const result = removeLabProfile(options.name);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.error) process.stderr.write(`${result.error}\n`);
    else process.stdout.write(`${result.removed ? 'removed' : 'not found'}: ${result.dir}\n`);
    return result.error ? 1 : 0;
  }

  if (action === 'remove-plugin' || action === 'remove-plugins') {
    return runRemovePlugin(options);
  }

  if (action === 'path') {
    process.stdout.write(`${labProfileDir(options.name)}\n`);
    return 0;
  }

  process.stderr.write(`unknown profile action: ${action} (use list|create|remove|remove-plugin|path)\n`);
  return 2;
}

/**
 * Uninstall one or more plugins from a persistent lab profile, keeping the
 * profile and its other plugins intact.
 */
async function runRemovePlugin(options) {
  const manifest = readLabProfile(options.name);
  if (!manifest) {
    process.stderr.write(`lab profile "${options.name}" not found (see: lab profile list)\n`);
    return 2;
  }
  const selectors = options.plugins ?? [];
  if (!selectors.length) {
    process.stderr.write('profile remove-plugin needs at least one plugin name or spec\n');
    return 2;
  }

  const home = openLabProfileHome(manifest.name);
  const profileName = `lab-${manifest.name}`;
  const profileDir = home.profileDir(profileName);
  if (!fs.existsSync(path.join(profileDir, 'package.json'))) {
    process.stderr.write(`lab profile "${manifest.name}" has no installed DSH profile yet; run a shell/verify with --profile-lab first\n`);
    return 2;
  }

  const runtime = locateRuntime(options.runtimePath);
  const result = await removeProfilePlugins({
    runtime,
    env: {
      DSH_HOME: home.home,
      ...(home.agents ? { DSH_AGENTS_HOME: home.agents } : {}),
      DSH_TELEMETRY_DISABLED: '1',
      TEMP: home.tmp,
      TMP: home.tmp,
    },
    profileDir,
    profileName,
    plugins: selectors,
    timeoutMs: options.installTimeoutMs,
  });

  const forgotten = result.removed.length ? forgetProfilePlugins(manifest.name, result.removed) : { removed: [] };
  const report = {
    ok: result.ok && !result.unmatched.length,
    profile: manifest.name,
    stage: result.stage,
    removed: result.removed,
    unmatched: result.unmatched,
    installed: result.installed,
    stillInstalled: result.stage === 'removed' ? result.installed.filter((name) => !result.removed.includes(name)) : result.installed,
    recordedRemoved: forgotten.removed.map((entry) => entry.spec),
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!result.targets.length) {
    process.stderr.write(`no installed plugin matched: ${selectors.join(', ')}\n`);
    process.stderr.write(`installed: ${result.installed.length ? result.installed.join(', ') : '(none)'}\n`);
  } else if (!result.ok) {
    const detail = result.removeCommand
      ? `exit ${result.removeCommand.code}`
      : 'nothing removed';
    process.stderr.write(`lab profile "${manifest.name}" remove-plugin failed: ${detail}\n`);
    if (result.removeCommand) process.stderr.write(`${result.removeCommand.stdout}\n${result.removeCommand.stderr}\n`);
  } else {
    process.stdout.write(`lab profile "${manifest.name}": removed ${result.removed.join(', ')}\n`);
    process.stdout.write(`still installed: ${report.stillInstalled.length ? report.stillInstalled.join(', ') : '(none)'}\n`);
  }
  if (result.unmatched.length) {
    process.stderr.write(`unmatched (not installed): ${result.unmatched.join(', ')}\n`);
  }
  return report.ok ? 0 : 1;
}
