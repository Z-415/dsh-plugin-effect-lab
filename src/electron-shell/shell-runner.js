import fs from 'node:fs';
import path from 'node:path';
import { bootWeb } from '../boot-supervisor.js';
import { openUi } from '../browser-driver.js';
import { snapshotLabResidue, verifyNoResidue } from '../cleanup.js';
import { evaluateDomAssertions } from '../dom-assertions.js';
import { writeHtmlReport } from '../html-report.js';
import { isClonedLabProfile, openLabProfileHome, recordProfilePlugins } from '../lab-profile.js';
import { hasFatal, scanSources, summarize, tailLines } from '../log-scanner.js';
import { defaultArtifactsRoot } from '../config.js';
import { createIsolatedHome } from '../home-manager.js';
import { mintAuthCookie } from '../port-and-token.js';
import { FIXTURE_SESSION_ID, fixtureEnv, readFixtureSpec } from '../fixture-manager.js';
import { installProfilePlugins } from '../plugin-install.js';
import { spawnTracked, stopTracked } from '../process-tree.js';
import { reapProcessesByCommandLine } from '../process-reaper.js';
import { writeMinimalProfile } from '../profile-builder.js';
import { progressEvent } from '../progress.js';
import { diffRealHome, snapshotRealHome } from '../real-home-guard.js';
import { copyIfExists, prepareArtifacts, renderReportMarkdown, writeJson, writeText } from '../report-writer.js';
import { locateRuntime, readRuntimeVersion } from '../runtime-locator.js';
import { classifyRuntimeVersion, isInformationalRuntime } from '../runtime-versions.js';
import { ensureDir, makeProfileName, makeRunId, nowIso, sleep, tail } from '../util.js';
import { buildShellRuntime } from './runtime-builder.js';
import { compareScreenshots } from '../screenshot-diff.js';
import {
  diffMagnitude,
  diffProbeSnapshots,
  formatDesktopBridges,
  isConnectionLost,
  normalizeProbe,
  resolveDesktopMode,
  summarizeProbe,
} from './shell-probe.js';

function addCheck(checks, name, pass, detail, extra = {}) {
  checks.push({ name, pass: Boolean(pass), detail, ...extra });
}

/**
 * Describe the shell child's outcome for the `shell-run` check.
 *
 * When `shell-result.json` is missing the runner already reports
 * `shell-result: missing`; this helper keeps the accompanying `shell-run`
 * failure readable (exit code + stderr tail) instead of a TypeError from
 * dereferencing the null result.
 *
 * @param {object|null} result parsed shell-result.json, or null when absent
 * @param {{ exitCode?: number|null, stderr?: string }} [facts]
 */
export function describeShellRun(result, facts = {}) {
  if (result) return { pass: true, detail: 'shell result written' };
  const exitCode = facts.exitCode ?? null;
  const stderrTail = tailLines(String(facts.stderr ?? ''), 3).join(' | ').slice(0, 400);
  return {
    pass: false,
    detail: `shell-result 缺失（壳进程 exitCode=${exitCode}）`
      + `${stderrTail ? `; stderr=${stderrTail}` : '; stderr=空'}`,
  };
}

/** Minimal standalone Electron shell prototype: official frontend + isolated host. */
export async function runShell(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const progress = (phase, detail) => {
    try {
      onProgress(progressEvent(phase, detail));
    } catch {
      // Progress reporting must never break a run.
    }
  };
  const runId = options.runId ?? makeRunId();
  const artifactsRoot = options.artifactsRoot ?? defaultArtifactsRoot();
  const runDir = prepareArtifacts(artifactsRoot, runId);
  const checks = [];
  const errors = [];
  const showWindow = options.show === true || options.keepOpen === true;
  const desktop = resolveDesktopMode(options.nativeDesktop, { show: showWindow });
  const probeDialogRequested = options.probeNativeDialog === true;
  const probeDialog = probeDialogRequested && desktop.mode === 'native' && showWindow;
  desktop.probeNativeDialog = probeDialog;
  const report = {
    ok: false,
    mode: 'shell',
    runId,
    runDir,
    startedAt: nowIso(),
    finishedAt: null,
    runtime: null,
    isolation: null,
    shell: null,
    pluginValidation: null,
    plugins: [],
    desktopBridge: desktop,
    checks,
    errors,
    cleanup: { homeRemoved: null, portsLeft: [], processesLeft: 0 },
    realHome: null,
    artifacts: {},
  };
  let iso = null;
  let boot = null;
  let shellProc = null;
  let shellUserDataDir = null;
  let webBrowser = null;
  let realBefore = null;
  let webProbe = null;
  let webConsoleTexts = [];
  let shellResult = null;
  let shellRunRecorded = false;
  const recordShellRun = (pass, detail) => {
    if (shellRunRecorded) return;
    shellRunRecorded = true;
    addCheck(checks, 'shell-run', pass, detail);
  };
  let shellVsWeb = null;
  let residueBefore = null;
  let shellScreenshotDiff = null;
  try {
    const runtime = locateRuntime(options.runtimePath);
    const version = await readRuntimeVersion(runtime);
    progress('locate-runtime', `runtime ${version.version ?? 'unknown'}`);
    report.runtime = { cmd: runtime.cmd, installDir: runtime.installDir, version: version.version };
    addCheck(checks, 'runtime-located', fs.existsSync(runtime.cmd), runtime.cmd);
    const runtimeCompat = classifyRuntimeVersion(version.version);
    report.runtime.compat = runtimeCompat;
    addCheck(checks, 'runtime-version', runtimeCompat.supported, runtimeCompat.detail, {
      informational: isInformationalRuntime(runtimeCompat),
    });
    realBefore = snapshotRealHome();
    residueBefore = snapshotLabResidue();
    addCheck(checks, 'real-home-baseline', true, `${Object.keys(realBefore.files).length} structural files hashed`);
    progress('snapshot', `${Object.keys(realBefore.files).length} structural file(s) hashed`);

    iso = options.profileLab
      ? openLabProfileHome(options.profileLab)
      : createIsolatedHome({ withAgents: true });
    const profileName = iso.persistent ? `lab-${iso.name}` : makeProfileName();
    const profileDir = iso.profileDir(profileName);
    if (!fs.existsSync(path.join(profileDir, 'package.json'))) {
      writeMinimalProfile(profileDir, { name: profileName });
    }
    report.isolation = {
      root: iso.root,
      home: iso.home,
      ...(iso.persistent ? { persistent: true, labProfile: iso.name } : {}),
    };
    addCheck(
      checks,
      'isolated-home',
      true,
      iso.persistent ? `reused lab profile "${iso.name}": ${iso.home}` : iso.home,
    );
    progress('isolated-home', `isolated home ${iso.home}`);

    const fixtureEnabled = options.fixture !== false;
    const fixtureVariant = options.fixtureVariant ?? 'default';
    const fixtureSessionId = fixtureEnabled
      ? (readFixtureSpec(fixtureVariant).sessionId ?? FIXTURE_SESSION_ID)
      : FIXTURE_SESSION_ID;
    const pipeline = await installProfilePlugins({
      runtime,
      env: {
        DSH_HOME: iso.home,
        ...(iso.agents ? { DSH_AGENTS_HOME: iso.agents } : {}),
        DSH_TELEMETRY_DISABLED: '1',
        TEMP: iso.tmp,
        TMP: iso.tmp,
      },
      profileDir,
      profileName,
      version: report.runtime.version,
      plugins: [...(options.plugins ?? []), ...(options.withPlugins ?? [])],
      fixture: fixtureEnabled,
      fixtureRoot: iso.root,
      online: options.online === true,
      installTimeoutMs: options.installTimeoutMs,
    });
    addCheck(
      checks,
      'plugin-precheck',
      pipeline.stage !== 'precheck',
      pipeline.stage === 'precheck'
        ? `${pipeline.summary.blockers.length} blocker(s)`
        : `${pipeline.entries.length} package(s) checked`,
    );
    if (pipeline.stage === 'precheck') {
      report.pluginValidation = pipeline.validation;
      throw new Error(`plugin precheck failed: ${pipeline.summary.blockers.map((item) => `${item.plugin}:${item.id}`).join(', ')}`);
    }
    if (pipeline.install) {
      writeText(runDir, 'install.log', `$ dsh ${pipeline.installArgs.join(' ')}\n\n${pipeline.install.stdout}\n${pipeline.install.stderr}`);
      addCheck(
        checks,
        'plugin-install',
        pipeline.stage !== 'install',
        `exit ${pipeline.install.code}${pipeline.install.timedOut ? ' (timeout)' : ''}`,
      );
      if (pipeline.stage === 'install') {
        throw new Error(`plugin install failed (exit ${pipeline.install.code})\n${tail(`${pipeline.install.stdout}\n${pipeline.install.stderr}`, 4000)}`);
      }
      addCheck(
        checks,
        'plugin-postcheck',
        pipeline.summary.ok,
        pipeline.summary.ok ? 'installed manifests are compatible' : `${pipeline.summary.blockers.length} blocker(s)`,
      );
    } else {
      writeText(runDir, 'install.log', '(no plugins requested)\n');
      addCheck(checks, 'plugin-install', true, 'no plugins requested');
    }
    report.pluginValidation = pipeline.validation;
    report.plugins = pipeline.pluginList;
    if (pipeline.profileAudit) {
      const audit = pipeline.profileAudit;
      report.profileAudit = { names: audit.names, conflicts: audit.conflicts };
      addCheck(
        checks,
        'plugin-profile-audit',
        audit.conflicts.length === 0,
        audit.conflicts.length
          ? audit.conflicts.map((conflict) => `${conflict.id}:${conflict.key}`).join(', ')
          : `${audit.names.length} installed package(s), no cross-plugin conflict`,
        { informational: isClonedLabProfile(options.profileLab) },
      );
    }
    const fixtureWorkspace = pipeline.fixtureWorkspace;
    const recordedPlugins = (pipeline.pluginList ?? []).filter((entry) => !entry.fixture);
    if (options.profileLab && recordedPlugins.length) {
      recordProfilePlugins(options.profileLab, recordedPlugins);
      progress('install-plugins', `lab profile "${options.profileLab}" now records ${recordedPlugins.length} plugin spec(s)`);
    }
    progress(
      'install-plugins',
      pipeline.install ? `installed ${pipeline.resolvedSpecs.length} plugin spec(s)` : 'no plugins requested',
    );

    boot = await bootWeb({
      runtime,
      home: iso.home,
      agentsHome: iso.agents,
      profileDir,
      profileName,
      tmpDir: iso.tmp,
      timeoutMs: options.bootTimeoutMs ?? 90_000,
      transport: options.bootTransport,
      env: fixtureEnabled
        ? fixtureEnv({ enabled: true, sessionId: fixtureSessionId, cwd: fixtureWorkspace, variant: fixtureVariant })
        : fixtureEnv({ enabled: false }),
    });
    addCheck(checks, 'host-boot', Number(boot.port) > 0, `port ${boot.port}`);
    progress('boot-host', `isolated host booted on port ${boot.port}`);
    let auth = { status: 0, cookie: '', error: null };
    try {
      auth = await mintAuthCookie(boot.url);
    } catch (error) {
      auth = { status: 0, cookie: '', error: String(error?.message ?? error) };
      errors.push(`token mint failed: ${auth.error}`);
    }
    addCheck(
      checks,
      'host-token',
      Boolean(auth.cookie),
      auth.error ? `mint failed: ${auth.error}` : `status ${auth.status}`,
    );

    if (options.compareWeb !== false) {
      progress('probe-ui', 'capturing web baseline in headless Edge');
      try {
        webBrowser = await openUi({
          baseUrl: boot.url,
          screenshots: ['web-baseline'],
          assertTokens: options.assertTokens ?? ['--dsw-alias-bg-base'],
          artifactsDir: runDir,
          timeoutMs: options.browserTimeoutMs,
          browserPath: options.browserPath,
          captureBeyondViewport: false,
        });
        webProbe = normalizeProbe(webBrowser.dom);
        writeJson(runDir, 'dom/web-dom.json', webProbe);
        addCheck(checks, 'web-baseline-ui', webBrowser.ui.ready, `${webProbe.slotCount} slot(s), ${webProbe.tokenCount} token(s)`);
        addCheck(
          checks,
          'web-baseline-console',
          webBrowser.consoleErrors.length === 0,
          `${webBrowser.consoleErrors.length} console error(s)`,
          { informational: true },
        );
        progress('probe-ui', `web baseline captured (${webProbe.slotCount} slots, ${webProbe.tokenCount} tokens)`);
        webConsoleTexts = [...(webBrowser.consoleErrors ?? []), ...(webBrowser.pageErrors ?? [])];
      } catch (error) {
        addCheck(checks, 'web-baseline-ui', false, String(error?.message ?? error), { informational: true });
      } finally {
        if (webBrowser) {
          try {
            await webBrowser.close();
          } catch (error) {
            errors.push(`web baseline cleanup failed: ${String(error)}`);
          }
          webBrowser = null;
        }
      }
    } else {
      addCheck(checks, 'web-baseline-ui', true, 'skipped (--no-compare-web)', { informational: true });
    }

    const shell = await buildShellRuntime(runtime.installDir, { force: options.noCache === true });
    addCheck(
      checks,
      'shell-runtime',
      fs.existsSync(shell.exe),
      shell.cached ? `cached ${shell.dir}` : `built ${shell.dir} (${shell.bytes} bytes, ${shell.copyMs}ms)`,
    );
    addCheck(
      checks,
      'shell-desktop-mode',
      desktop.ok,
      desktop.ok
        ? `desktop bridges: ${desktop.mode}${desktop.native ? ' (real dialog + OS notification)' : ' (deterministic stub)'}`
        : desktop.detail,
      { informational: desktop.ok },
    );
    progress('probe-ui', `launching Electron shell window${options.keepOpen ? ' (close it to finish)' : ''}`);

    const userDataDir = ensureDir(path.join(iso.root, 'electron-userdata'));
    shellUserDataDir = userDataDir;
    const screenshotFile = path.join(runDir, 'screenshots', 'shell.png');
    const resultFile = path.join(runDir, 'shell-result.json');
    const configFile = path.join(iso.root, 'shell-config.json');
    // The typed boot rows the host sent over IPC, handed to the shell so the
    // frontend applies them itself (the packaged-desktop path instead of the
    // server-rendered index).
    const injectionsFile = path.join(iso.root, 'shell-injections.json');
    const desktopInjections = Array.isArray(boot.injections) ? boot.injections : null;
    if (desktopInjections) {
      const payload = `${JSON.stringify({
        transport: boot.transport,
        injections: desktopInjections,
      }, null, 2)}\n`;
      fs.writeFileSync(injectionsFile, payload, 'utf8');
      writeText(runDir, 'boot-injections.json', payload);
    }
    fs.writeFileSync(configFile, `${JSON.stringify({
      officialInstall: runtime.installDir,
      hostUrl: boot.origin,
      hostCookie: auth.cookie,
      userDataDir,
      resultFile,
      screenshotFile,
      fixtureDir: fixtureWorkspace ?? null,
      show: options.show === true || options.keepOpen === true,
      keepOpen: options.keepOpen === true,
      showHoldMs: options.showHoldMs ?? 6000,
      injectionsFile: desktopInjections ? injectionsFile : null,
      desktopMode: desktop.mode,
      // Do not accept an early DOM plateau below the web baseline's slot count.
      minSlots: webProbe?.slotCount ?? 0,
      // A native folder dialog is modal, so the probe only opens it when the
      // human explicitly asked for it with --probe-native-dialog.
      autoProbeDirectoryPicker: desktop.mode !== 'native' ? true : probeDialog,
      assertTokens: options.assertTokens ?? ['--dsw-alias-bg-base'],
    }, null, 2)}\n`, 'utf8');

    // The per-run user-data-dir is what lets a cleanup find this Electron tree
    // if the process outlives a killed or timed-out run.
    shellProc = spawnTracked(shell.exe, [`--user-data-dir=${userDataDir}`], {
      cwd: shell.dir,
      env: { DSH_LAB_SHELL_CONFIG: configFile },
    });
    addCheck(checks, 'shell-launched', Boolean(shellProc.pid), `pid ${shellProc.pid}`);
    const defaultShellTimeout = options.keepOpen ? 30 * 60_000 : 150_000;
    const deadline = Date.now() + (options.shellTimeoutMs ?? defaultShellTimeout);
    while (Date.now() < deadline) {
      if (fs.existsSync(resultFile)) break;
      if (shellProc.child.exitCode !== null) break;
      await sleep(500);
    }
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
    shellResult = result;
    progress('probe-ui', result ? 'shell result received' : 'shell result missing');
    addCheck(checks, 'shell-result', result?.ok === true, result?.error ?? (result ? 'written' : 'missing'));
    {
      const described = describeShellRun(result, {
        exitCode: shellProc.child.exitCode ?? null,
        stderr: shellProc.getOutput().stderr,
      });
      recordShellRun(described.pass, described.detail);
    }
    if (result?.capture) {
      addCheck(
        checks,
        'shell-capture-painted',
        result.capture.unpainted !== true,
        `attempts=${result.capture.attempts}${result.capture.unpainted === true ? ', frame still unpainted' : ''}`,
      );
    }
    if (result?.dom) {
      const shellProbe = normalizeProbe(result.dom);
      result.dom = shellProbe;
      addCheck(checks, 'shell-ui-ready', shellProbe.slotCount > 0, `${shellProbe.slotCount} slot(s), ${shellProbe.tokenCount} token(s)`);
      if (result.settle) {
        addCheck(
          checks,
          'shell-dom-stable',
          result.settle.stable === true,
          `${result.settle.slots} slot(s) after ${result.settle.waitedMs}ms`
            + `${result.settle.stable ? '' : `, did not reach minSlots=${result.settle.minSlots ?? 'n/a'}`}`,
          { informational: result.settle.stable === true },
        );
      }
      addCheck(
        checks,
        'shell-token',
        Boolean(shellProbe.tokens['--dsw-alias-bg-base']),
        shellProbe.tokens['--dsw-alias-bg-base'] ?? 'empty',
      );
      const shellAssertions = evaluateDomAssertions(shellProbe, {
        tokens: options.assertTokens ?? ['--dsw-alias-bg-base'],
      });
      for (const check of shellAssertions.checks) {
        checks.push({ ...check, name: `shell-${check.name}` });
      }

      const connectionLost = (result.consoleErrors ?? []).filter(isConnectionLost);
      addCheck(
        checks,
        'shell-stream-connected',
        connectionLost.length === 0,
        connectionLost.length ? connectionLost.join(' | ') : 'no connection-lost console error',
      );
      addCheck(
        checks,
        'shell-transport-bridge',
        shellProbe.transport.present && shellProbe.transport.ownsHost && Boolean(shellProbe.transport.streamBaseUrl),
        JSON.stringify(shellProbe.transport),
      );
      addCheck(
        checks,
        'shell-window-controls',
        shellProbe.titlebar?.available === true,
        `available=${shellProbe.titlebar?.available === true};`
          + ` visible=${shellProbe.titlebar?.visible === true};`
          + ` height=${shellProbe.titlebar?.rect?.height ?? 'n/a'}`,
      );
      const capabilities = result.capabilities ?? null;
      addCheck(
        checks,
        'shell-clipboard',
        capabilities?.clipboard?.ok === true,
        capabilities?.clipboard?.ok === true
          ? `round-trip ok (${capabilities.clipboard.tokenLength} chars)`
          : `not verified: ${JSON.stringify(capabilities?.clipboard ?? null)} (the OS clipboard is shared; another process may own it)`,
        { informational: true },
      );
      addCheck(
        checks,
        'shell-desktop-bridges',
        true,
        `${formatDesktopBridges(capabilities)}; hostPaths=${capabilities?.bridged?.hostPaths ?? 'n/a'}`,
        { informational: true },
      );
      const notificationFacts = capabilities?.bridge?.notification ?? null;
      addCheck(
        checks,
        'shell-notification',
        desktop.mode !== 'native' || notificationFacts?.shown >= 1,
        desktop.mode === 'native'
          ? `native toast shown=${notificationFacts?.shown ?? 0} supported=${notificationFacts?.supported ?? 'n/a'} requested=${notificationFacts?.requested ?? 0}`
          : `stub: recorded ${notificationFacts?.requested ?? 0}, suppressed (no OS toast)`,
        { informational: desktop.mode !== 'native' },
      );
      if (probeDialogRequested) {
        const pickerFacts = capabilities?.bridge?.directoryPicker ?? null;
        addCheck(
          checks,
          'shell-native-dialog',
          probeDialog && pickerFacts?.called === true && !pickerFacts?.error,
          probeDialog
            ? `real folder dialog answered: canceled=${pickerFacts?.canceled ?? 'n/a'} value=${pickerFacts?.value ?? 'null'}`
            : '--probe-native-dialog needs --native-desktop and --show/--keep-open',
        );
      }
      if (result.tray) {
        addCheck(
          checks,
          'shell-tray',
          result.tray.created === true,
          result.tray.created
            ? `tray created (tooltip=${result.tray.tooltip}; menu=[${(result.tray.menuItems ?? []).join(', ')}])`
            : result.tray.skipped
              ? `skipped: ${result.tray.reason}`
              : `not created: ${result.tray.error ?? 'unknown'}`,
          { informational: result.tray.skipped === true },
        );
      }
      if (result.bootGlobals) {
        const present = result.bootGlobals.present ?? [];
        const missing = result.bootGlobals.missing ?? [];
        addCheck(
          checks,
          'shell-boot-globals',
          result.bootGlobals.requiredPresent === true,
          `present=${present.length}/${present.length + missing.length} [${present.join(', ')}]`
            + `${missing.length ? ` missing=[${missing.join(', ')}]` : ''}`,
        );
      }

      addCheck(
        checks,
        'shell-boot-transport',
        boot.transport === 'ipc' && Array.isArray(boot.injections),
        boot.transport === 'ipc'
          ? `ipc ready message: ${boot.injections?.length ?? 0} injection row(s)`
            + ` kinds=[${(boot.injectionKinds ?? []).join(', ')}]`
          : `stdout fallback (${boot.fallbackReason ?? 'unknown'})`,
        { informational: boot.transport !== 'ipc' },
      );
      addCheck(
        checks,
        'shell-index-source',
        result.indexSource === (boot.transport === 'ipc' ? 'packaged-dist' : 'host-rendered'),
        `indexSource=${result.indexSource ?? 'unknown'} transport=${boot.transport}`,
        { informational: true },
      );
      if (result?.derivedInjections) {
        const derived = result.derivedInjections;
        addCheck(
          checks,
          'shell-boot-injections',
          derived.count > 0,
          `derived from the ${derived.source}: ${derived.count} row(s)`
            + ` kinds=[${(derived.kinds ?? []).join(', ')}]`
            + ` names=[${(derived.names ?? []).slice(0, 6).join(', ')}]`
            + `${derived.error ? ` error=${derived.error}` : ''}`,
        );
      }

      if (webProbe) {
        shellVsWeb = diffProbeSnapshots(webProbe, shellProbe);
        writeJson(runDir, 'dom/shell-vs-web.json', shellVsWeb);
        const slotDetail = `web=${shellVsWeb.counts.slots.web} shell=${shellVsWeb.counts.slots.shell}`
          + ` added=[${shellVsWeb.slots.added.join(', ')}] removed=[${shellVsWeb.slots.removed.join(', ')}]`;
        addCheck(checks, 'shell-web-slots', true, slotDetail, { informational: true });
        addCheck(
          checks,
          'shell-web-body-attributes',
          true,
          `changed=${Object.keys(shellVsWeb.bodyAttributes.changed).length}`
            + ` added=[${Object.keys(shellVsWeb.bodyAttributes.added).join(', ')}]`
            + ` removed=[${Object.keys(shellVsWeb.bodyAttributes.removed).join(', ')}]`,
          { informational: true },
        );
        addCheck(
          checks,
          'shell-web-tokens',
          true,
          `web=${shellVsWeb.counts.tokens.web} shell=${shellVsWeb.counts.tokens.shell}`
            + ` changed=${Object.keys(shellVsWeb.tokens.changed).length}`
            + ` bg-base web=${webProbe.tokens['--dsw-alias-bg-base'] ?? ''} shell=${shellProbe.tokens['--dsw-alias-bg-base'] ?? ''}`,
          { informational: true },
        );
        addCheck(
          checks,
          'shell-desktop-only',
          true,
          `hinted=[${(shellVsWeb.desktopOnly.hintedBodyAttributes ?? []).join(', ')}]`
            + ` body=[${shellVsWeb.desktopOnly.bodyAttributes.join(', ')}]`
            + ` tokens=[${shellVsWeb.desktopOnly.tokens.slice(0, 12).join(', ')}]`,
          { informational: true },
        );
      }
      writeJson(runDir, 'dom/shell-dom.json', shellProbe);

      const baselineShot = path.join(runDir, 'screenshots', 'web-baseline.png');
      const shellShot = path.join(runDir, 'screenshots', 'shell.png');
      if (webProbe && fs.existsSync(baselineShot) && fs.existsSync(shellShot)) {
        try {
          shellScreenshotDiff = await compareScreenshots({
            before: baselineShot,
            after: shellShot,
            browserPath: options.browserPath,
          });
          writeJson(runDir, 'dom/shell-screenshot-diff.json', shellScreenshotDiff);
          addCheck(
            checks,
            'shell-screenshot-diff',
            shellScreenshotDiff.visuallyIdentical === true,
            `identical=${shellScreenshotDiff.identical}`
              + ` visuallyIdentical=${shellScreenshotDiff.visuallyIdentical === true}`
              + ` changedRatio=${(shellScreenshotDiff.pixels?.changedRatio ?? 0).toFixed(5)}`
              + ` tolerance=${shellScreenshotDiff.ratioTolerance}`
              + ` dimensionsMatch=${shellScreenshotDiff.dimensionsMatch}`,
          );
        } catch (error) {
          addCheck(checks, 'shell-screenshot-diff', false, String(error?.message ?? error), { informational: true });
        }
      }
    }
    const shellProbeForReport = result?.dom ? normalizeProbe(result.dom) : null;
    report.shell = {
      runtimeDir: shell.dir,
      bootTransport: boot.transport,
      bootInjections: {
        count: boot.injections?.length ?? 0,
        kinds: boot.injectionKinds ?? [],
      },
      derivedInjections: result?.derivedInjections ?? null,
      childExitCode: shellProc.child.exitCode ?? null,
      cached: shell.cached,
      result,
      screenshotFile,
      probe: shellProbeForReport,
      probeSummary: shellProbeForReport ? summarizeProbe(shellProbeForReport) : null,
      webSummary: webProbe ? summarizeProbe(webProbe) : null,
      shellVsWeb,
      diffMagnitude: shellVsWeb ? diffMagnitude(shellVsWeb) : null,
      screenshotDiff: shellScreenshotDiff,
      capabilities: result?.capabilities ?? null,
      stdout: tail(shellProc.getOutput().stdout, 4000),
      stderr: tail(shellProc.getOutput().stderr, 4000),
    };
  } catch (error) {
    errors.push(String(error?.stack ?? error));
    recordShellRun(false, `shell-run 异常: ${String(error?.message ?? error)}（详见 errors 与 shell-result）`);
  } finally {
    progress('cleanup', 'cleaning up processes and the isolated home');
    if (webBrowser) {
      try {
        await webBrowser.close();
      } catch (error) {
        errors.push(`web baseline cleanup failed: ${String(error)}`);
      }
      webBrowser = null;
    }
    if (shellProc) {
      try {
        await stopTracked(shellProc, { label: 'electron shell' });
      } catch (error) {
        errors.push(`shell cleanup failed: ${String(error)}`);
      }
    }
    if (shellUserDataDir) {
      try {
        const reaped = reapProcessesByCommandLine(shellUserDataDir, { names: ['DeepSeek Harness.exe'] });
        report.cleanup.shellProcessesReaped = reaped.matched;
      } catch (error) {
        errors.push(`shell process reap failed: ${String(error)}`);
      }
    }
    if (boot) {
      try {
        const stopped = await boot.stop();
        if (!stopped.portFreed) report.cleanup.portsLeft.push(boot.port);
        writeText(runDir, 'boot.out.log', boot.getOutput().stdout ?? '');
        writeText(runDir, 'boot.err.log', boot.getOutput().stderr ?? '');
      } catch (error) {
        errors.push(`host cleanup failed: ${String(error)}`);
      }
    }
    if (iso) {
      const cleanup = await iso.dispose();
      report.cleanup.homeRemoved = cleanup.removed;
      report.cleanup.homeKept = cleanup.kept === true;
    }
    if (realBefore) {
      try {
        const diff = diffRealHome(realBefore, snapshotRealHome());
        report.realHome = { diff };
        addCheck(checks, 'real-home-unchanged', diff.ok, diff.ok ? 'unchanged' : `${diff.changed.length} changed`);
      } catch (error) {
        addCheck(checks, 'real-home-unchanged', false, String(error));
      }
    }
    addCheck(
      checks,
      'cleanup-home',
      report.cleanup.homeRemoved === true || report.cleanup.homeKept === true,
      report.cleanup.homeKept === true ? `kept lab profile "${options.profileLab}"` : String(report.cleanup.homeRemoved),
    );
    addCheck(checks, 'cleanup-ports', report.cleanup.portsLeft.length === 0, report.cleanup.portsLeft.join(', ') || 'none');
    try {
      const residue = await verifyNoResidue({
        isolatedRoot: iso?.persistent ? null : (iso?.root ?? null),
        ports: boot?.port ? [boot.port] : [],
        before: residueBefore,
      });
      report.cleanup.residue = residue;
      addCheck(
        checks,
        'cleanup-no-residue',
        residue.ok,
        residue.ok
          ? `root removed, ports released; new lab homes: ${residue.newHomes.length}`
          : `failed: ${residue.failures.join(', ')}`,
      );
      const orphans = residue.labProcesses?.orphans ?? [];
      report.cleanup.orphanProcesses = orphans.map((entry) => ({ pid: entry.pid, name: entry.name }));
      addCheck(
        checks,
        'cleanup-orphan-processes',
        orphans.length === 0,
        orphans.length
          ? `${orphans.length} orphan lab process(es): ${orphans.map((entry) => `${entry.pid} ${entry.name}`).join(', ')} (run: lab clean)`
          : 'no orphan lab process',
        { informational: true },
      );
    } catch (error) {
      addCheck(checks, 'cleanup-no-residue', false, String(error?.message ?? error));
    }
    {
      const bootOutput = boot?.getOutput?.() ?? { stdout: '', stderr: '' };
      const consoleTexts = [
        ...webConsoleTexts,
        ...(shellResult?.consoleErrors ?? []),
        ...(shellResult?.pageErrors ?? []),
      ];
      report.signatureHits = scanSources([`${bootOutput.stdout ?? ''}\n${bootOutput.stderr ?? ''}`, ...consoleTexts]);
      report.consoleSignatureHits = scanSources(consoleTexts);
      addCheck(
        checks,
        'boot-signatures',
        !hasFatal(report.signatureHits),
        report.signatureHits.length ? summarize(report.signatureHits) : 'No known failure signatures matched.',
      );
      addCheck(
        checks,
        'console-signatures',
        !hasFatal(report.consoleSignatureHits),
        report.consoleSignatureHits.length
          ? summarize(report.consoleSignatureHits)
          : 'no known failure signature in console/page errors',
        { informational: true },
      );
    }
    report.finishedAt = nowIso();
    report.ok = checks.every((check) => check.pass || check.informational === true);
    if (!hasFatal(report.signatureHits) && (!report.ok || errors.length)) {
      const bootForContext = boot?.getOutput?.() ?? { stdout: '', stderr: '' };
      report.failureContext = {
        reason: 'no known failure signature matched',
        errors: errors.slice(0, 10),
        bootTail: tailLines(`${bootForContext.stdout ?? ''}\n${bootForContext.stderr ?? ''}`, 30),
        consoleErrors: [...webConsoleTexts, ...(shellResult?.consoleErrors ?? [])].slice(0, 10),
        pageErrors: (shellResult?.pageErrors ?? []).slice(0, 10),
      };
    }
    report.artifacts = {
      runDir,
      reportMd: path.join(runDir, 'report.md'),
      reportJson: path.join(runDir, 'report.json'),
      shellResult: path.join(runDir, 'shell-result.json'),
      shellScreenshot: path.join(runDir, 'screenshots', 'shell.png'),
      webDom: path.join(runDir, 'dom/web-dom.json'),
      shellDom: path.join(runDir, 'dom/shell-dom.json'),
      shellVsWeb: path.join(runDir, 'dom/shell-vs-web.json'),
      screenshots: {
        'web-baseline': path.join(runDir, 'screenshots', 'web-baseline.png'),
        shell: path.join(runDir, 'screenshots', 'shell.png'),
      },
    };
    if (options.html !== false) {
      report.artifacts.reportHtml = path.join(runDir, 'report.html');
    }
    writeJson(runDir, 'runtime.json', report.runtime);
    progress('write-report', 'writing report.json / report.md');
    writeJson(runDir, 'report.json', report);
    writeText(runDir, 'report.md', renderReportMarkdown(report));
    if (options.html !== false) {
      try {
        writeHtmlReport(runDir, report);
      } catch (error) {
        errors.push(`html report failed: ${String(error)}`);
      }
    }
  }
  return report;
}
