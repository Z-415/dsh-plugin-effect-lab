import { createLabProfile, labProfileDir, labProfilesRoot, listLabProfiles, removeLabProfile } from '../lab-profile.js';

/**
 * `lab profile list|create|remove <name>`.
 *
 * Plugins are installed into a profile by running `verify`/`shell` with
 * `--profile-lab <name> --plugin <spec>`; this command only manages the
 * skeleton so a profile can be prepared or inspected on its own.
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
        process.stdout.write(`- ${profile.name}: ${specs.length ? specs.join(', ') : 'no plugins recorded'}\n`);
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
    else process.stdout.write(`${result.removed ? 'removed' : 'not found'}: ${result.dir}\n`);
    return 0;
  }

  if (action === 'path') {
    process.stdout.write(`${labProfileDir(options.name)}\n`);
    return 0;
  }

  process.stderr.write(`unknown profile action: ${action} (use list|create|remove|path)\n`);
  return 2;
}
