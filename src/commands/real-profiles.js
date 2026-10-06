import path from 'node:path';
import { REAL_HOME } from '../config.js';
import { discoverRealProfiles } from '../real-profiles.js';

/**
 * `lab real-profiles [--json]` — read-only list of the real DSH profiles a
 * clone can start from. The lab-owned profile list stays `lab profile list`.
 */
export async function runRealProfilesCommand(options = {}) {
  const realHome = options.realHome ?? REAL_HOME;
  const profiles = discoverRealProfiles(realHome);
  const root = path.join(path.resolve(realHome), 'profiles');
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ root, profiles }, null, 2)}\n`);
  } else {
    process.stdout.write(`real DSH profiles: ${profiles.length} (${root})\n`);
    for (const profile of profiles) {
      process.stdout.write(
        `- ${profile.name}: ${profile.dependenciesCount} plugin(s), ${profile.bundlesCount} bundle(s)`
          + `${profile.hasPatches ? ', patches/' : ''}\n`,
      );
    }
    if (!profiles.length) process.stdout.write('(none found)\n');
  }
  return 0;
}
