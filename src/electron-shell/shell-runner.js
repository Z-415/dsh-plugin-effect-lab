import fs from 'node:fs';
import path from 'node:path';
import { bootWeb } from '../boot-supervisor.js';
import { openUi } from '../browser-driver.js';
import { snapshotLabResidue, verifyNoResidue } from '../cleanup.js';
import { evaluateDomAssertions } from '../dom-assertions.js';
import { defaultArtifactsRoot } from '../config.js';
import { createIsolatedHome } from '../home-manager.js';
import { mintAuthCookie } from '../port-and-token.js';
import { FIXTURE_SESSION_ID, fixtureEnv, readFixtureSpec } from '../fixture-manager.js';
import { installProfilePlugins } from '../plugin-install.js';
import { spawnTracked, stopTracked } from '../process-tree.js';
import { writeMinimalProfile } from '../profile-builder.js';
import { diffRealHome, snapshotRealHome } from '../real-home-guard.js';
import { copyIfExists, prepareArtifacts, renderReportMarkdown, writeJson, writeText } from '../report-writer.js';
import { locateRuntime, readRuntimeVersion } from '../runtime-locator.js';
import { ensureDir, makeProfileName, makeRunId, nowIso, sleep, tail } from '../util.js';
import { buildShellRuntime } from './runtime-builder.js';
import { compareScreenshots } from '../screenshot-diff.js';
import {
  diffMagnitude,
  diffProbeSnapshots,
  isConnectionLost,
  normalizeProbe,
  summarizeProbe,
} from './shell-probe.js';

function addCheck(checks, name, pass, detail, extra = {}) {
  checks.push({ name, pass: Boolean(pass), detail, ...extra });
}

/** Minimal standalone Electron shell prototype: official frontend + isolated host. */
export async function runShell(options = {}) {
  const runId = options.runId ?? makeRunId();
  const artifactsRoot = options.artifactsRoot ?? defaultArtifactsRoot();
  const runDir = prepareArtifacts(artifactsRoot, runId);
  const checks = [];
  const errors = [];
  const report = {
    ok: false,
    mode: 'shell',
    runId,
    startedAt: nowIso(),
    finishedAt: null,
    runtime: null,
    shell: null,
    pluginValidation: null,
    plugins: [],
    checks,
    errors,
    cleanup: { homeRemoved: null, portsLeft: [], processesLeft: 0 },
    realHome: null,
    artifacts: {},
  };
  let iso = null;
  let boot = null;
  let shellProc = null;
  let webBrowser = null;
  let realBefore = null;
  let webProbe = null;
  let shellVsWeb = null;
  let residueBefore = null;
  let shellScreenshotDiff = null;
  try {
    const runtime = locateRuntime(options.runtimePath);
    const version = await readRuntimeVersion(runtime);
    report.runtime = { cmd: runtime.cmd, installDir: runtime.installDir, version: version.version };
    addCheck(checks, 'runtime-located', fs.existsSync(runtime.cmd), runtime.cmd);
    addCheck(checks, 'runtime-version', version.version === '0.2.0-rc.2', version.version ?? 'unknown');
    realBefore = snapshotRealHome();
    residueBefore = snapshotLabResidue();
    addCheck(checks, 'real-home-baseline', true, `${Object.keys(realBefore.files).length} structural files hashed`);

    iso = createIsolatedHome({ withAgents: true });
    const profileName = makeProfileName();
    const profileDir = iso.profileDir(profileName);
    writeMinimalProfile(profileDir, { name: profileName });
    addCheck(checks, 'isolated-home', true, iso.home);

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
    const fixtureWorkspace = pipeline.fixtureWorkspace;

    boot = await bootWeb({
      runtime,
      home: iso.home,
      agentsHome: iso.agents,
      profileDir,
      profileName,
      tmpDir: iso.tmp,
      timeoutMs: options.bootTimeoutMs ?? 90_000,
      env: fixtureEnabled
        ? fixtureEnv({ enabled: true, sessionId: fixtureSessionId, cwd: fixtureWorkspace, variant: fixtureVariant })
        : fixtureEnv({ enabled: false }),
    });
    addCheck(checks, 'host-boot', Number(boot.port) > 0, `port ${boot.port}`);
    const auth = await mintAuthCookie(boot.url);
    addCheck(checks, 'host-token', Boolean(auth.cookie), `status ${auth.status}`);

    if (options.compareWeb !== false) {
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

    const userDataDir = ensureDir(path.join(iso.root, 'electron-userdata'));
    const screenshotFile = path.join(runDir, 'screenshots', 'shell.png');
    const resultFile = path.join(runDir, 'shell-result.json');
    const configFile = path.join(iso.root, 'shell-config.json');
    fs.writeFileSync(configFile, `${JSON.stringify({
      officialInstall: runtime.installDir,
      hostUrl: boot.origin,
      hostCookie: auth.cookie,
      userDataDir,
      resultFile,
      screenshotFile,
      fixtureDir: fixtureWorkspace ?? null,
      assertTokens: options.assertTokens ?? ['--dsw-alias-bg-base'],
    }, null, 2)}\n`, 'utf8');

    shellProc = spawnTracked(shell.exe, [], {
      cwd: shell.dir,
      env: { DSH_LAB_SHELL_CONFIG: configFile },
    });
    addCheck(checks, 'shell-launched', Boolean(shellProc.pid), `pid ${shellProc.pid}`);
    const deadline = Date.now() + (options.shellTimeoutMs ?? 150_000);
    while (Date.now() < deadline) {
      if (fs.existsSync(resultFile)) break;
      if (shellProc.child.exitCode !== null) break;
      await sleep(500);
    }
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
    addCheck(checks, 'shell-result', result?.ok === true, result?.error ?? (result ? 'written' : 'missing'));
    if (result?.dom) {
      const shellProbe = normalizeProbe(result.dom);
      result.dom = shellProbe;
      addCheck(checks, 'shell-ui-ready', shellProbe.slotCount > 0, `${shellProbe.slotCount} slot(s), ${shellProbe.tokenCount} token(s)`);
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
        `directoryPicker=${capabilities?.bridged?.directoryPicker ?? 'n/a'}`
          + ` hostPaths=${capabilities?.bridged?.hostPaths ?? 'n/a'}`
          + ` notifications=${capabilities?.bridge?.notification?.requested ?? 0} suppressed`,
        { informational: true },
      );

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
            true,
            `identical=${shellScreenshotDiff.identical}`
              + ` changedRatio=${(shellScreenshotDiff.pixels?.changedRatio ?? 0).toFixed(4)}`
              + ` dimensionsMatch=${shellScreenshotDiff.dimensionsMatch}`,
            { informational: true },
          );
        } catch (error) {
          addCheck(checks, 'shell-screenshot-diff', false, String(error?.message ?? error), { informational: true });
        }
      }
    }
    const shellProbeForReport = result?.dom ? normalizeProbe(result.dom) : null;
    report.shell = {
      runtimeDir: shell.dir,
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
    addCheck(checks, 'shell-run', false, String(error?.message ?? error));
  } finally {
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
    addCheck(checks, 'cleanup-home', report.cleanup.homeRemoved === true, String(report.cleanup.homeRemoved));
    addCheck(checks, 'cleanup-ports', report.cleanup.portsLeft.length === 0, report.cleanup.portsLeft.join(', ') || 'none');
    try {
      const residue = await verifyNoResidue({
        isolatedRoot: iso?.root ?? null,
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
    } catch (error) {
      addCheck(checks, 'cleanup-no-residue', false, String(error?.message ?? error));
    }
    report.finishedAt = nowIso();
    report.ok = checks.every((check) => check.pass || check.informational === true);
    report.artifacts = {
      runDir,
      reportMd: path.join(runDir, 'report.md'),
      reportJson: path.join(runDir, 'report.json'),
      shellResult: path.join(runDir, 'shell-result.json'),
      shellScreenshot: path.join(runDir, 'screenshots', 'shell.png'),
      webDom: path.join(runDir, 'dom/web-dom.json'),
      shellDom: path.join(runDir, 'dom/shell-dom.json'),
      shellVsWeb: path.join(runDir, 'dom/shell-vs-web.json'),
    };
    writeJson(runDir, 'runtime.json', report.runtime);
    writeJson(runDir, 'report.json', report);
    writeText(runDir, 'report.md', renderReportMarkdown(report));
  }
  return report;
}
