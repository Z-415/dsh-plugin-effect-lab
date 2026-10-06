import { runCaptureCommand } from './commands/capture.js';
import { runCleanCommand } from './commands/clean.js';
import { runDiagnoseCommand } from './commands/diagnose.js';
import { runDoctor } from './commands/doctor.js';
import { runGuiCommand } from './commands/gui.js';
import { runProfileCommand } from './commands/profile.js';
import { runRealProfilesCommand } from './commands/real-profiles.js';
import { runRuntimesCommand } from './commands/runtimes.js';
import { runMatrixCommand } from './commands/matrix.js';
import { runScanCommand } from './commands/scan.js';
import { runShellCommand } from './commands/shell.js';
import { runVerifyCommand } from './commands/verify.js';
import { profileExists } from './lab-profile.js';

const VALUE_FLAGS = new Set([
  'runtime',
  'plugin',
  'with',
  'screenshot',
  'assert-token',
  'assert-slot',
  'assert-body-attr',
  'min-slots',
  'fixture-variant',
  'show-hold',
  'profile-lab',
  'clone-profile',
  'clone-plugins',
  'clone-exclude',
  'clone-to',
  'diagnostics-bundle',
  'report',
  'bundle',
  'artifacts',
  'browser',
  'boot-timeout',
  'boot-transport',
  'browser-timeout',
  'install-timeout',
  'runtime-timeout',
  'log',
  'older-than',
  'config',
  'profile',
  'run-id',
  'route',
]);

const REPEATABLE = new Set(['plugin', 'with', 'screenshot', 'assert-token', 'assert-slot', 'assert-body-attr', 'log', 'route', 'clone-exclude']);

const BOOLEAN_FLAGS = new Set([
  'json', 'offline', 'online', 'no-fixture', 'mock-model', 'strict-console',
  'no-cache', 'no-compare-web', 'dry-run', 'help', 'h',
  'no-html', 'native-desktop', 'probe-native-dialog',
  'list', 'latest', 'explain', 'runtime-matrix',
  'rebuild', 'install-shortcut', 'no-open',
  'clone-drop-local', 'force', 'clone-accept-risk',
]);

/**
 * `--assert-token` values are CSS custom properties, so they legitimately
 * start with `--` themselves. Accept a token-shaped value that is not one of
 * this CLI's own flags; anything else is still treated as the next flag.
 */
function isTokenValue(value) {
  const text = String(value ?? '');
  return /^--[A-Za-z0-9_-]+$/.test(text) && !BOOLEAN_FLAGS.has(text.slice(2)) && !VALUE_FLAGS.has(text.slice(2));
}

export function parseArgv(argv) {
  const command = argv[0];
  const flags = { _: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      flags._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (!VALUE_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    const tokenLike = name === 'assert-token' && isTokenValue(value);
    if (value === undefined || (value.startsWith('--') && !tokenLike)) throw new Error(`--${name} needs a value`);
    index += 1;
    if (REPEATABLE.has(name)) {
      flags[name] ??= [];
      flags[name].push(value);
    } else {
      flags[name] = value;
    }
  }
  return { command, flags };
}

function numberFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

/**
 * Options shared by `verify` and `capture` (the help says "capture [same
 * options as verify]"). Building them in one place keeps `--profile-lab` from
 * being silently dropped by either command.
 */
export function browserCommandOptions(flags, common) {
  return {
    ...common,
    plugins: flags.plugin ?? [],
    withPlugins: flags.with ?? [],
    fixture: flags['no-fixture'] !== true,
    fixtureVariant: flags['fixture-variant'] ?? 'default',
    profileLab: flags['profile-lab'],
    cloneProfile: flags['clone-profile'],
    clonePlugins: flags['clone-plugins'] ?? 'all',
    cloneExclude: flags['clone-exclude'] ?? [],
    cloneDropLocal: flags['clone-drop-local'] === true,
    cloneAcceptRisk: flags['clone-accept-risk'] === true,
    diagnosticsBundle: flags['diagnostics-bundle'],
    mockModel: flags['mock-model'] === true,
    online: flags.online === true,
    screenshots: flags.screenshot ?? ['home'],
    assertTokens: flags['assert-token'] ?? ['--dsw-alias-bg-base'],
    assertSlots: flags['assert-slot'] ?? [],
    assertBodyAttributes: flags['assert-body-attr'] ?? [],
    minSlots: numberFlag(flags, 'min-slots'),
    routes: (flags.route ?? []).map((url) => ({ name: url, url, cookie: true, expect: ['ok', 'auth-fence', 'redirect'] })),
    artifactsRoot: flags.artifacts,
    bootTimeoutMs: numberFlag(flags, 'boot-timeout'),
    bootTransport: flags['boot-transport'],
    browserTimeoutMs: numberFlag(flags, 'browser-timeout'),
    installTimeoutMs: numberFlag(flags, 'install-timeout'),
    strictConsole: flags['strict-console'] === true,
    html: flags['no-html'] !== true,
  };
}

/** Indirection so a unit test can assert what `main` forwards without booting a runtime. */
export const browserRunners = { verify: runVerifyCommand, capture: runCaptureCommand };

/**
 * Normalize `--clone-to <name>` / `--profile-lab <name>` + `--clone-profile`
 * and refuse to overwrite an existing lab profile without `--force`.
 *
 * `--clone-to clone-web` is sugar for
 * `--profile-lab clone-web --clone-profile <kind>`, so the kind still comes
 * from `--clone-profile` and the two names must agree when both are given.
 */
export function resolveCloneOptions(flags = {}) {
  const cloneTo = flags['clone-to'];
  const profileLab = flags['profile-lab'];
  const cloneProfile = flags['clone-profile'];
  if (cloneTo !== undefined && cloneProfile === undefined) {
    return { error: '--clone-to needs --clone-profile web|desktop' };
  }
  if (cloneTo !== undefined && profileLab !== undefined && profileLab !== cloneTo) {
    return { error: `--clone-to ${cloneTo} and --profile-lab ${profileLab} must name the same profile` };
  }
  const target = cloneTo ?? (cloneProfile !== undefined ? profileLab : undefined);
  if (target !== undefined) {
    let exists = false;
    try {
      exists = profileExists(target);
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
    if (exists && flags.force !== true) {
      return {
        error: `lab profile "${target}" already exists; pass --force to overwrite it, or choose another name`,
        refused: true,
        target,
      };
    }
  }
  return {
    profileLab: cloneTo ?? profileLab,
    cloneTo,
    target: target ?? null,
  };
}

export async function main(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(helpText());
    return 0;
  }
  const { command, flags } = parseArgv(argv);
  if (flags.help === true || flags.h === true) {
    process.stdout.write(helpText());
    return 0;
  }
  const common = {
    json: flags.json === true,
    runtimePath: flags.runtime,
    browserPath: flags.browser,
  };
  switch (command) {
    case 'doctor':
      return runDoctor(common);
    case 'verify':
    case 'capture': {
      const cloneOptions = resolveCloneOptions(flags);
      if (cloneOptions.error) {
        process.stderr.write(`${cloneOptions.error}\n`);
        return 2;
      }
      const options = {
        ...browserCommandOptions(flags, common),
        profileLab: cloneOptions.profileLab,
        cloneTo: cloneOptions.cloneTo,
        force: flags.force === true,
      };
      return command === 'verify' ? browserRunners.verify(options) : browserRunners.capture(options);
    }
    case 'scan':
      return runScanCommand({
        ...common,
        logs: flags.log ?? [],
        list: flags.list === true,
        latest: flags.latest === true,
        explain: flags.explain === true,
        artifactsRoot: flags.artifacts,
      });
    case 'diagnose':
      return runDiagnoseCommand({
        ...common,
        reportPath: flags.report,
        bundlePath: flags.bundle,
        logPath: flags.log?.[0],
        latest: flags.latest === true,
        artifactsRoot: flags.artifacts,
      });
    case 'clean':
      return runCleanCommand({
        ...common,
        dryRun: flags['dry-run'] === true,
        olderThanMs: flags['older-than'] === undefined ? 0 : Number(flags['older-than']) * 60_000,
      });
    case 'matrix':
      return runMatrixCommand({
        ...common,
        configFile: flags.config,
        online: flags.online === true,
        artifactsRoot: flags.artifacts,
        html: flags['no-html'] !== true,
        runtimeMatrix: flags['runtime-matrix'] === true,
        runtimeTimeoutMs: numberFlag(flags, 'runtime-timeout'),
      });
    case 'runtimes':
      return runRuntimesCommand({
        ...common,
        runtimeTimeoutMs: numberFlag(flags, 'runtime-timeout'),
      });
    case 'real-profiles':
      return runRealProfilesCommand(common);
    case 'shell':
      if (flags['clone-profile'] !== undefined || flags['clone-to'] !== undefined || flags['diagnostics-bundle'] !== undefined) {
        process.stderr.write('--clone-profile / --clone-to / --diagnostics-bundle are only supported by `lab verify` / `lab capture`; `lab shell` keeps its own runner.\n');
        return 2;
      }
      return runShellCommand({
        ...common,
        artifactsRoot: flags.artifacts,
        noCache: flags['no-cache'] === true,
        shellTimeoutMs: numberFlag(flags, 'shell-timeout'),
        bootTransport: flags['boot-transport'],
        plugins: flags.plugin ?? [],
        withPlugins: flags.with ?? [],
        fixture: flags['no-fixture'] !== true,
        fixtureVariant: flags['fixture-variant'] ?? 'default',
        profileLab: flags['profile-lab'],
        online: flags.online === true,
        installTimeoutMs: numberFlag(flags, 'install-timeout'),
        assertTokens: flags['assert-token'] ?? ['--dsw-alias-bg-base'],
        compareWeb: flags['no-compare-web'] !== true,
        nativeDesktop: flags['native-desktop'] === true,
        probeNativeDialog: flags['probe-native-dialog'] === true,
        browserTimeoutMs: numberFlag(flags, 'browser-timeout'),
        html: flags['no-html'] !== true,
        show: flags.show === true || flags['keep-open'] === true,
        keepOpen: flags['keep-open'] === true,
        showHoldMs: numberFlag(flags, 'show-hold'),
      });
    case 'gui':
      return runGuiCommand({
        ...common,
        rebuild: flags.rebuild === true,
        installShortcut: flags['install-shortcut'] === true,
        open: flags['no-open'] !== true,
      });
    case 'profile':
      {
        const [action = 'list', name, ...selectors] = flags._;
        return runProfileCommand({
          action,
          name,
          plugins: [...(flags.plugin ?? []), ...selectors],
          json: flags.json === true,
          runtimePath: flags.runtime,
          installTimeoutMs: numberFlag(flags, 'install-timeout'),
        });
      }
    default:
      process.stderr.write(`unknown command: ${command}\n\n${helpText()}`);
      return 2;
  }
}

export function helpText() {
  return `DSH Plugin Effect Lab

Usage:
  lab doctor [--json] [--runtime <dsh.cmd>]
  lab verify [--plugin <spec>] [--with <spec>] [--offline|--online]
             [--screenshot home] [--assert-token --dsw-alias-bg-base]
             [--assert-slot conversation.view] [--assert-body-attr data-we-wallpaper]
             [--min-slots <n>]
             [--fixture-variant default|empty|long|rich]
             [--profile-lab <name>]
             [--clone-profile web|desktop [--clone-plugins all|none]
              [--clone-exclude <plugin>] [--clone-drop-local] [--clone-accept-risk]]
             [--clone-to <name> [--force]]
             [--diagnostics-bundle <file>]
             [--artifacts <dir>] [--browser <exe>] [--no-fixture]
             [--boot-transport stdout|ipc]
             [--mock-model] [--route /plugin/health] [--no-html] [--json]
  lab capture [same options as verify]
  lab matrix --config <file.json> [--online] [--runtime-matrix] [--json]
  lab runtimes [--runtime-timeout <ms>] [--json]
  lab real-profiles [--json]      (read-only clone sources)
  lab shell [--no-cache] [--no-compare-web] [--shell-timeout <ms>]
            [--plugin <spec>] [--with <spec>] [--offline|--online] [--no-fixture]
            [--fixture-variant default|empty|long|rich]
            [--profile-lab <name>]
            [--boot-transport stdout|ipc]
            [--show] [--keep-open] [--native-desktop] [--probe-native-dialog] [--show-hold <ms>] [--no-html]
            [--browser <exe>] [--browser-timeout <ms>] [--json]
  lab gui [--install-shortcut] [--rebuild] [--no-open] [--json]
  lab profile list|create|remove|path [name] [--json]
  lab profile remove-plugin <name> <plugin...> [--json]
  lab scan --log <boot.err.log> [--explain] [--json]
  lab scan --latest [--explain] [--artifacts <dir>] [--json]
  lab scan --list [--json]
  lab diagnose --report <report.json> | --bundle <bundle.json> | --log <log> | --latest [--json]
  lab clean [--dry-run] [--older-than <minutes>] [--json]

Phase 1 runs entirely inside a temp DSH_HOME and never installs into the real
profile. npm/GitHub plugin specs require explicit --online. The fixed session
fixture is enabled by default; pass --no-fixture to disable it. --mock-model
starts a loopback OpenAI-compatible provider for a real streamed tool turn.
--plugin accepts an npm spec (optionally npm:<spec>), github:<owner/repo#ref>,
a https://github.com/... URL, a local directory, or a .tgz tarball. After
install the report prints the advertised spec next to the real name@version
read back from the isolated profile.
--fixture-variant rich seeds an assistant turn with a reasoning content block
({ type: 'reasoning', text }) plus a fenced code block, and a second turn
with a tool call, so thinking/code/tool rendering are all covered.
--clone-profile web|desktop starts from the real profile's structural files
(package.json / cordis.yml / cordis.patch.yml / pnpm-*.yaml / compatibility.json
/ patches/), never
from node_modules, credentials, settings, sessions, or agents. node_modules is
rebuilt with the official runtime's pnpm install --offline. --clone-plugins
none drops every third-party plugin, --clone-exclude <plugin> drops one, and
--clone-drop-local drops file:/link: directory references. Clones that
fail to install or boot are reported as failures, not hidden. --clone-profile
is supported by lab verify / lab capture; lab shell keeps its own runner
and rejects it.
By default a clone keeps every real plugin. DSH may deny a plugin whose peer
range does not match this runtime; --clone-accept-risk grants the exact-version
exemption inside the clone (allow-version --accept-risk) and re-runs the
install, so the plugin loads. --clone-plugins none / --clone-exclude are the
escape hatches. The report always lists installed, missing, denied, and
exempted plugins. --online also lets the clone install fetch packages missing
from the offline store (the desktop profile needs this for one registry
tarball).
Persistent clones: add --profile-lab <name> (or the sugar --clone-to <name>,
which also needs --clone-profile web|desktop) to keep the clone as a visible
lab profile. It then shows in lab profile list as "cloned from web", keeps
its clonedFrom { kind, at, sourceHash, copiedFiles, excluded } marker, and can
be reopened with lab shell --profile-lab <name>. An existing target is
refused unless --force is given, which overwrites it junction-safely. Without
persistence the clone is temporary and the run prints how to keep it.
--diagnostics-bundle <file> writes a redacted diagnostics bundle (stable error
codes + failed checks + a bounded boot tail). It never contains credentials,
sessions, settings, raw logs, or absolute home paths. lab diagnose turns a
report.json / bundle / log into the same structured codes for the agent.
Progress: verify/shell print [n/8] <phase> lines. The phases are
locate-runtime / snapshot / isolated-home / install-plugins / boot-host /
probe-ui / cleanup / write-report. The GUI renders the completed-phase
fraction plus an indeterminate animation and an elapsed timer for the
in-flight phase; no time percentage is invented.
lab shell boots the same isolated Host, opens it once in headless Edge and once
through a minimal Electron shell, then diffs DOM slots, body attributes, and
--dsw-* tokens. Pass --no-compare-web to skip the Edge baseline. --show makes
the Electron window visible (--show-hold <ms>, default 6000); --keep-open keeps
it open until you close it, then cleans up. Every run also writes an HTML
report next to report.md; pass --no-html to skip it.
The shell bridges the desktop directory picker and notifications as
deterministic stubs by default; add --native-desktop (with --show or
--keep-open) to raise the real Electron folder dialog and OS notification.
--probe-native-dialog also opens the real folder dialog during the run and
waits for you to pick a folder or cancel; it needs --native-desktop + --show.

--boot-transport ipc spawns the host directly with an IPC stdio channel to
receive the desktop host's typed boot rows ({ type: 'ready', url, injections }).
The default stdout parses the readiness line. The isolated dsh web app does not
send that message (only the app's private desktop-host entry does), so ipc
currently reports a fallback instead of failing; see docs/ELECTRON-SHELL.md.

lab gui copies the official Electron runtime into LOCALAPPDATA\\dsh-plugin-effect-lab
(once) and opens a desktop launcher whose buttons run the same commands and
stream their output. --install-shortcut also drops a Desktop shortcut.

--profile-lab <name> keeps the isolated profile under .lab-profiles/<name>/
instead of deleting it after the run. Reuse it to keep plugins installed and
to add plugins one at a time:

  lab shell --profile-lab dev --plugin A@1 --online   # install A into "dev"
  lab shell --profile-lab dev --plugin B@2 --online   # add B, check A+B
  lab shell --profile-lab dev --show --keep-open      # reopen with A+B
  lab profile list                                    # what is installed
  lab profile remove-plugin dev B@2                   # uninstall one plugin
  lab profile remove dev                              # delete the profile
`;
}
