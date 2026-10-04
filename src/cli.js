import { runCaptureCommand } from './commands/capture.js';
import { runCleanCommand } from './commands/clean.js';
import { runDoctor } from './commands/doctor.js';
import { runGuiCommand } from './commands/gui.js';
import { runMatrixCommand } from './commands/matrix.js';
import { runScanCommand } from './commands/scan.js';
import { runShellCommand } from './commands/shell.js';
import { runVerifyCommand } from './commands/verify.js';

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
  'artifacts',
  'browser',
  'boot-timeout',
  'browser-timeout',
  'install-timeout',
  'log',
  'older-than',
  'config',
  'profile',
  'run-id',
  'route',
]);

const REPEATABLE = new Set(['plugin', 'with', 'screenshot', 'assert-token', 'assert-slot', 'assert-body-attr', 'log', 'route']);

const BOOLEAN_FLAGS = new Set([
  'json', 'offline', 'online', 'no-fixture', 'mock-model', 'strict-console',
  'no-cache', 'no-compare-web', 'dry-run', 'help', 'h',
  'no-html',
  'rebuild', 'install-shortcut', 'no-open',
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
  const domAssertions = {
    assertTokens: flags['assert-token'] ?? ['--dsw-alias-bg-base'],
    assertSlots: flags['assert-slot'] ?? [],
    assertBodyAttributes: flags['assert-body-attr'] ?? [],
    minSlots: numberFlag(flags, 'min-slots'),
  };
  const fixtureOptions = {
    fixture: flags['no-fixture'] !== true,
    fixtureVariant: flags['fixture-variant'] ?? 'default',
  };
  switch (command) {
    case 'doctor':
      return runDoctor(common);
    case 'verify':
      return runVerifyCommand({
        ...common,
        plugins: flags.plugin ?? [],
        withPlugins: flags.with ?? [],
        ...fixtureOptions,
        mockModel: flags['mock-model'] === true,
        online: flags.online === true,
        screenshots: flags.screenshot ?? ['home'],
        ...domAssertions,
        routes: (flags.route ?? []).map((url) => ({ name: url, url, cookie: true, expect: ['ok', 'auth-fence', 'redirect'] })),
        artifactsRoot: flags.artifacts,
        bootTimeoutMs: numberFlag(flags, 'boot-timeout'),
        browserTimeoutMs: numberFlag(flags, 'browser-timeout'),
        installTimeoutMs: numberFlag(flags, 'install-timeout'),
        strictConsole: flags['strict-console'] === true,
        html: flags['no-html'] !== true,
      });
    case 'capture':
      return runCaptureCommand({
        ...common,
        plugins: flags.plugin ?? [],
        withPlugins: flags.with ?? [],
        ...fixtureOptions,
        mockModel: flags['mock-model'] === true,
        online: flags.online === true,
        screenshots: flags.screenshot ?? ['home'],
        ...domAssertions,
        routes: (flags.route ?? []).map((url) => ({ name: url, url, cookie: true, expect: ['ok', 'auth-fence', 'redirect'] })),
        artifactsRoot: flags.artifacts,
        bootTimeoutMs: numberFlag(flags, 'boot-timeout'),
        browserTimeoutMs: numberFlag(flags, 'browser-timeout'),
        installTimeoutMs: numberFlag(flags, 'install-timeout'),
        strictConsole: flags['strict-console'] === true,
        html: flags['no-html'] !== true,
      });
    case 'scan':
      return runScanCommand({ ...common, logs: flags.log ?? [] });
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
      });
    case 'shell':
      return runShellCommand({
        ...common,
        artifactsRoot: flags.artifacts,
        noCache: flags['no-cache'] === true,
        shellTimeoutMs: numberFlag(flags, 'shell-timeout'),
        plugins: flags.plugin ?? [],
        withPlugins: flags.with ?? [],
        fixture: flags['no-fixture'] !== true,
        fixtureVariant: flags['fixture-variant'] ?? 'default',
        online: flags.online === true,
        installTimeoutMs: numberFlag(flags, 'install-timeout'),
        assertTokens: flags['assert-token'] ?? ['--dsw-alias-bg-base'],
        compareWeb: flags['no-compare-web'] !== true,
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
             [--fixture-variant default|empty|long]
             [--artifacts <dir>] [--browser <exe>] [--no-fixture]
             [--mock-model] [--route /plugin/health] [--no-html] [--json]
  lab capture [same options as verify]
  lab matrix --config <file.json> [--online] [--json]
  lab shell [--no-cache] [--no-compare-web] [--shell-timeout <ms>]
            [--plugin <spec>] [--with <spec>] [--offline|--online] [--no-fixture]
            [--fixture-variant default|empty|long]
            [--show] [--keep-open] [--show-hold <ms>] [--no-html]
            [--browser <exe>] [--browser-timeout <ms>] [--json]
  lab gui [--install-shortcut] [--rebuild] [--no-open] [--json]
  lab scan --log <boot.err.log> [--json]
  lab clean [--dry-run] [--older-than <minutes>] [--json]

Phase 1 runs entirely inside a temp DSH_HOME and never installs into the real
profile. npm/GitHub plugin specs require explicit --online. The fixed session
fixture is enabled by default; pass --no-fixture to disable it. --mock-model
starts a loopback OpenAI-compatible provider for a real streamed tool turn.
lab shell boots the same isolated Host, opens it once in headless Edge and once
through a minimal Electron shell, then diffs DOM slots, body attributes, and
--dsw-* tokens. Pass --no-compare-web to skip the Edge baseline. --show makes
the Electron window visible (--show-hold <ms>, default 6000); --keep-open keeps
it open until you close it, then cleans up. Every run also writes an HTML
report next to report.md; pass --no-html to skip it.

lab gui copies the official Electron runtime into LOCALAPPDATA\\dsh-plugin-effect-lab
(once) and opens a desktop launcher whose buttons run the same commands and
stream their output. --install-shortcut also drops a Desktop shortcut.
`;
}
