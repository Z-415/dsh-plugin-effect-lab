import fs from 'node:fs';
import path from 'node:path';
import { openUi } from './browser-driver.js';
import { bootWeb } from './boot-supervisor.js';
import { snapshotLabResidue, verifyNoResidue } from './cleanup.js';
import { evaluateDomAssertions } from './dom-assertions.js';
import {
  DEFAULT_BROWSER_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  defaultArtifactsRoot,
} from './config.js';
import { createIsolatedHome } from './home-manager.js';
import {
  createFixtureWorkspace,
  FIXTURE_SESSION_ID,
  FIXTURE_SESSION_TITLE,
  fixtureEnv,
} from './fixture-manager.js';
import { hasFatal, scanLogs, scanNoise, summarize } from './log-scanner.js';
import { describeAgentCoverage, scanForCredentials } from './model-coverage.js';
import { startMockLlmServer } from './mock-llm-server.js';
import { installProfilePlugins } from './plugin-install.js';
import { mintAuthCookie } from './port-and-token.js';
import { MOCK_API_KEY_ENV, MOCK_MODEL, MOCK_PROVIDER, writeMockProviderPatch } from './provider-patcher.js';
import { writeMinimalProfile } from './profile-builder.js';
import { diffRealHome, snapshotRealHome } from './real-home-guard.js';
import {
  createSession,
  listSessions,
  modelCatalog,
  promptSession,
  rpc,
  selectModel,
  sessionPage,
} from './rpc-client.js';
import {
  copyIfExists,
  prepareArtifacts,
  renderReportMarkdown,
  writeJson,
  writeText,
} from './report-writer.js';
import { locateRuntime, readRuntimeVersion } from './runtime-locator.js';
import { probeRoutes } from './route-probe.js';
import { makeProfileName, makeRunId, nowIso, sleep, tail } from './util.js';

function addCheck(checks, name, pass, detail, extra = {}) {
  const check = { name, pass: Boolean(pass), detail, ...extra };
  checks.push(check);
  return check;
}

function isolatedEnv(iso) {
  return {
    DSH_HOME: iso.home,
    ...(iso.agents ? { DSH_AGENTS_HOME: iso.agents } : {}),
    DSH_TELEMETRY_DISABLED: '1',
    TEMP: iso.tmp,
    TMP: iso.tmp,
  };
}

/**
 * One full lifecycle:
 *   locate -> snapshot real home -> isolated home -> minimal profile ->
 *   optional install -> boot --port 0 -> token/route probe -> Edge CDP UI ->
 *   stop -> delete -> hash compare -> report.
 */
export async function runLab(options = {}) {
  const runId = options.runId ?? makeRunId();
  const artifactsRoot = options.artifactsRoot ?? defaultArtifactsRoot();
  const runDir = prepareArtifacts(artifactsRoot, runId);
  const checks = [];
  const errors = [];
  const report = {
    ok: false,
    runId,
    mode: options.mode ?? 'web',
    startedAt: nowIso(),
    finishedAt: null,
    artifactsRoot,
    runDir,
    runtime: null,
    profile: null,
    isolation: null,
    plugins: [],
    pluginValidation: null,
    fixture: null,
    mockModel: null,
    agentCoverage: null,
    settings: null,
    checks,
    signatureHits: [],
    noise: [],
    routes: [],
    browser: null,
    cleanup: { homeRemoved: null, portsLeft: [], homeCleanup: null, processesLeft: 0 },
    realHome: null,
    errors,
    artifacts: {},
  };
  let iso = null;
  let boot = null;
  let browser = null;
  let mockServer = null;
  let realBefore = null;
  let bootOutput = { stdout: '', stderr: '', outLines: [], errLines: [] };
  let residueBefore = null;

  try {
    const runtime = locateRuntime(options.runtimePath);
    const version = await readRuntimeVersion(runtime);
    report.runtime = {
      cmd: runtime.cmd,
      installDir: runtime.installDir,
      runtimeDir: runtime.runtimeDir,
      versions: runtime.versions,
      version: version.version,
      versionExitCode: version.code,
      versionOutput: tail(`${version.stdout}${version.stderr}`, 2000),
    };
    addCheck(checks, 'runtime-located', fs.existsSync(runtime.cmd), runtime.cmd);
    addCheck(checks, 'runtime-version', version.version === '0.2.0-rc.2', `detected ${version.version ?? 'unknown'}`);

    realBefore = snapshotRealHome();
    residueBefore = snapshotLabResidue();
    addCheck(
      checks,
      'real-home-baseline',
      true,
      `${Object.keys(realBefore.files).length} structural files hashed; credentials/sessions/settings untouched`,
    );

    iso = createIsolatedHome({ withAgents: true });
    report.isolation = { root: iso.root, home: iso.home, agents: iso.agents, tmp: iso.tmp };
    addCheck(checks, 'isolated-home', true, iso.home);
    const credentials = scanForCredentials(iso.home);
    report.agentCoverage = describeAgentCoverage({ mockModel: options.mockModel === true, credentials });
    addCheck(
      checks,
      'no-model-credentials',
      credentials.ok,
      credentials.ok
        ? 'isolated home has no credential file or inline API key'
        : `found ${credentials.files.length} credential file(s), ${credentials.keys.length} inline key(s)`,
    );

    const profileName = options.profileName ?? makeProfileName();
    const profileDir = iso.profileDir(profileName);
    writeMinimalProfile(profileDir, { name: profileName });
    report.profile = { name: profileName, dir: profileDir };
    addCheck(checks, 'profile-minimal', true, path.join(profileDir, 'package.json'));

    const env = isolatedEnv(iso);
    const fixtureEnabled = options.fixture !== false;
    const pluginPipeline = await installProfilePlugins({
      runtime,
      env,
      profileDir,
      profileName,
      version: report.runtime.version,
      plugins: options.plugins ?? [],
      fixture: fixtureEnabled,
      fixtureRoot: iso.root,
      online: options.online === true,
      installTimeoutMs: options.installTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    });
    const fixtureWorkspace = pluginPipeline.fixtureWorkspace
      ?? (options.mockModel ? createFixtureWorkspace(iso.root) : null);
    addCheck(
      checks,
      'plugin-precheck',
      pluginPipeline.stage !== 'precheck',
      pluginPipeline.stage === 'precheck'
        ? `${pluginPipeline.summary.blockers.length} blocker(s)`
        : `${pluginPipeline.entries.length} package(s) checked`,
    );
    if (pluginPipeline.stage === 'precheck') {
      report.pluginValidation = pluginPipeline.validation;
      throw new Error(`plugin precheck failed: ${pluginPipeline.summary.blockers.map((item) => `${item.plugin}:${item.id}`).join(', ')}`);
    }
    if (pluginPipeline.install) {
      writeText(runDir, 'install.log', `$ dsh ${pluginPipeline.installArgs.join(' ')}\n\n${pluginPipeline.install.stdout}\n${pluginPipeline.install.stderr}`);
      addCheck(
        checks,
        'plugin-install',
        pluginPipeline.stage !== 'install',
        `exit ${pluginPipeline.install.code}${pluginPipeline.install.timedOut ? ' (timeout)' : ''}`,
      );
      if (pluginPipeline.stage === 'install') {
        throw new Error(`plugin install failed (exit ${pluginPipeline.install.code})\n${tail(`${pluginPipeline.install.stdout}\n${pluginPipeline.install.stderr}`, 4000)}`);
      }
      addCheck(
        checks,
        'plugin-postcheck',
        pluginPipeline.summary.ok,
        pluginPipeline.summary.ok ? 'installed manifests are compatible' : `${pluginPipeline.summary.blockers.length} blocker(s)`,
      );
    } else {
      writeText(runDir, 'install.log', '(no plugins requested)\n');
      addCheck(checks, 'plugin-install', true, 'no plugins requested');
    }
    report.pluginValidation = pluginPipeline.validation;
    report.plugins = pluginPipeline.pluginList;

    if (options.mockModel) {
      mockServer = await startMockLlmServer({ model: MOCK_MODEL });
      writeMockProviderPatch(profileDir, { port: mockServer.port });
      addCheck(checks, 'mock-provider-started', true, mockServer.origin);
    }

    boot = await bootWeb({
      runtime,
      home: iso.home,
      agentsHome: iso.agents,
      profileDir,
      profileName,
      tmpDir: iso.tmp,
      timeoutMs: options.bootTimeoutMs,
      env: {
        ...(fixtureEnabled
          ? fixtureEnv({ enabled: true, sessionId: FIXTURE_SESSION_ID, cwd: fixtureWorkspace })
          : fixtureEnv({ enabled: false })),
        ...(mockServer ? { [MOCK_API_KEY_ENV]: 'lab-mock-key' } : {}),
      },
    });
    addCheck(checks, 'boot-url', Number(boot.port) > 0, `port ${boot.port}`);

    bootOutput = boot.getOutput();
    report.signatureHits = scanLogs(`${bootOutput.stdout}\n${bootOutput.stderr}`);
    report.noise = scanNoise(`${bootOutput.stdout}\n${bootOutput.stderr}`);
    addCheck(checks, 'boot-signatures', !hasFatal(report.signatureHits), summarize(report.signatureHits));

    const auth = await mintAuthCookie(boot.url);
    addCheck(
      checks,
      'token-mint',
      auth.status === 303 && Boolean(auth.cookie),
      `status ${auth.status}, cookie ${auth.cookie ? 'present' : 'missing'}`,
    );

    const routes = await probeRoutes({ origin: boot.origin, cookie: auth.cookie, routes: options.routes ?? [] });
    report.routes = routes;
    for (const route of routes) {
      addCheck(checks, `route:${route.name}`, route.pass, `status ${route.status} (${route.classification})`);
    }

    if (fixtureEnabled) {
      try {
        const workspaceResult = await rpc(boot.origin, auth.cookie, 'workspace/create', {
          request: { path: fixtureWorkspace },
        });
        const workspaceId = workspaceResult?.workspace?.workspaceId ?? null;
        addCheck(checks, 'fixture-workspace', Boolean(workspaceId), workspaceId ?? 'not registered');
        const sessions = await listSessions(boot.origin, auth.cookie);
        const fixtureSession = sessions.find((item) => item.sessionId === FIXTURE_SESSION_ID);
        addCheck(
          checks,
          'fixture-session-listed',
          Boolean(fixtureSession),
          fixtureSession ? FIXTURE_SESSION_ID : `not in ${sessions.length} session(s)`,
        );
        if (fixtureSession) {
          const page = await sessionPage(boot.origin, auth.cookie, FIXTURE_SESSION_ID);
          const types = new Set(page.events.map((event) => event.type));
          const expected = ['user/message', 'assistant/message', 'tool/result'];
          const missing = expected.filter((type) => !types.has(type));
          addCheck(
            checks,
            'fixture-session-events',
            missing.length === 0,
            missing.length ? `missing ${missing.join(', ')}` : `${page.events.length} event(s)`,
          );
          report.fixture = {
            sessionId: FIXTURE_SESSION_ID,
            title: FIXTURE_SESSION_TITLE,
            workspace: fixtureWorkspace,
            workspaceId,
            events: page.events.length,
            types: [...types],
          };
        }
      } catch (error) {
        addCheck(checks, 'fixture-session-listed', false, String(error?.message ?? error));
      }
    }

    if (mockServer) {
      try {
        const workspaceResult = await rpc(boot.origin, auth.cookie, 'workspace/create', {
          request: { path: fixtureWorkspace },
        });
        const catalog = await modelCatalog(boot.origin, auth.cookie);
        const groups = catalog?.groups ?? catalog?.providers ?? [];
        const provider = groups.find((group) => (group.id ?? group.provider) === MOCK_PROVIDER);
        addCheck(
          checks,
          'mock-provider-catalog',
          Boolean(provider),
          provider ? MOCK_PROVIDER : `not in ${groups.map((group) => group.id).filter(Boolean).join(', ') || 'empty catalog'}`,
        );
        const created = await createSession(boot.origin, auth.cookie, { cwd: fixtureWorkspace });
        const sessionId = created?.sessionId ?? created?.id ?? null;
        addCheck(checks, 'mock-session-create', Boolean(sessionId), sessionId ?? 'missing session id');
        if (sessionId) {
          await selectModel(boot.origin, auth.cookie, {
            sessionId,
            provider: MOCK_PROVIDER,
            model: MOCK_MODEL,
          });
          addCheck(checks, 'mock-model-select', true, `${MOCK_PROVIDER}/${MOCK_MODEL}`);
          await promptSession(boot.origin, auth.cookie, {
            requestId: `lab-mock-${Date.now()}`,
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: 'Call the todo_write tool once, then summarize.' }],
          });
          addCheck(checks, 'mock-prompt-accepted', true, sessionId);
          const deadline = Date.now() + (options.mockTimeoutMs ?? 90_000);
          let page = null;
          let ended = false;
          while (Date.now() < deadline) {
            page = await sessionPage(boot.origin, auth.cookie, sessionId);
            if (page.events.some((event) => event.type === 'turn/end')) {
              ended = true;
              break;
            }
            await sleep(1000);
          }
          addCheck(checks, 'mock-turn-end', ended, ended ? 'turn/end observed' : 'timed out');
          const events = page?.events ?? [];
          const eventTypes = [...new Set(events.map((event) => event.type))];
          const toolResult = events.find((event) => event.type === 'tool/result');
          const assistant = events.find((event) => event.type === 'assistant/message');
          addCheck(checks, 'mock-assistant-message', Boolean(assistant), assistant ? 'assistant/message present' : 'missing');
          addCheck(
            checks,
            'mock-tool-result',
            Boolean(toolResult),
            toolResult ? `tool/result ${toolResult.data?.message?.toolCallId ?? ''}`.trim() : 'missing',
          );
          report.mockModel = {
            provider: MOCK_PROVIDER,
            model: MOCK_MODEL,
            sessionId,
            workspaceId: workspaceResult?.workspace?.workspaceId ?? null,
            turnEnded: ended,
            eventTypes,
            requests: mockServer.evidence.length,
            toolResult: toolResult?.data ?? null,
          };
        }
      } catch (error) {
        addCheck(checks, 'mock-model-run', false, String(error?.message ?? error));
      }
    }

    const assertTokens = options.assertTokens ?? ['--dsw-alias-bg-base'];
    const requestedScreenshots = options.screenshots ?? ['home'];
    const wantsSettings = requestedScreenshots.includes('settings');
    browser = await openUi({
      baseUrl: boot.url,
      screenshots: requestedScreenshots.filter((name) => name !== 'settings'),
      screenshotsAfter: fixtureEnabled ? ['fixture'] : [],
      screenshotsSettings: wantsSettings ? ['settings'] : [],
      clickText: fixtureEnabled ? path.basename(fixtureWorkspace) : null,
      clickSessionRow: fixtureEnabled,
      openSettings: wantsSettings,
      assertTokens,
      artifactsDir: runDir,
      timeoutMs: options.browserTimeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS,
      browserPath: options.browserPath,
    });
    addCheck(checks, 'ui-ready', browser.ui.ready, JSON.stringify(browser.ui).slice(0, 500));
    if (fixtureEnabled) {
      addCheck(
        checks,
        'fixture-ui-clicked',
        browser.clickedSession === true,
        `workspace=${browser.clicked === true}, session=${browser.clickedSession === true}`,
      );
    }
    addCheck(checks, 'dom-slots', browser.dom.slotCount > 0, `${browser.dom.slotCount} data-slot node(s)`);
    const domAssertions = evaluateDomAssertions(browser.dom, {
      tokens: assertTokens,
      slots: options.assertSlots ?? [],
      bodyAttributes: options.assertBodyAttributes ?? [],
      minSlots: options.minSlots,
    });
    for (const check of domAssertions.checks) {
      checks.push(check);
    }
    addCheck(checks, 'console-errors', browser.consoleErrors.length === 0, `${browser.consoleErrors.length} console error(s)`, {
      informational: options.strictConsole !== true,
    });
    if (wantsSettings) {
      const addedSections = browser.settingsProbe?.added ?? [];
      report.settings = browser.settingsProbe ?? null;
      addCheck(
        checks,
        'settings-ui',
        browser.openedSettings === true,
        `opened=${browser.openedSettings === true}; sections added=${addedSections.length} [${addedSections.join(', ')}]; screenshot=${browser.screenshots.settings ?? 'none'}`,
      );
    }
    addCheck(
      checks,
      'agent-coverage',
      true,
      `${report.agentCoverage?.mode ?? 'unknown'}: realModelRequests=${report.agentCoverage?.realModelRequests === true}; uncovered=[${(report.agentCoverage?.uncovered ?? []).join(', ')}]`,
      { informational: true },
    );
    report.browser = {
      ui: browser.ui,
      dom: browser.dom,
      clicked: browser.clicked,
      consoleErrors: browser.consoleErrors,
      pageErrors: browser.pageErrors,
      networkFailures: browser.networkFailures,
      screenshots: browser.screenshots,
    };
    writeJson(runDir, 'dom/dom.json', browser.dom);
  } catch (error) {
    const message = String(error?.stack ?? error);
    errors.push(message);
    addCheck(checks, 'run', false, message.split('\n')[0].slice(0, 500));
  } finally {
    let processesLeft = 0;
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        processesLeft += 1;
        errors.push(`browser cleanup failed: ${String(error)}`);
      }
    }
    if (boot) {
      try {
        const stopped = await boot.stop();
        if (!stopped.portFreed) report.cleanup.portsLeft.push(boot.port);
      } catch (error) {
        processesLeft += 1;
        errors.push(`dsh cleanup failed: ${String(error)}`);
        if (boot?.port) report.cleanup.portsLeft.push(boot.port);
      }
      bootOutput = boot.getOutput();
    }
    if (mockServer) {
      try {
        await mockServer.close();
      } catch (error) {
        errors.push(`mock LLM server cleanup failed: ${String(error)}`);
      }
    }
    report.cleanup.processesLeft = processesLeft;
    writeText(runDir, 'boot.out.log', bootOutput.stdout ?? '');
    writeText(runDir, 'boot.err.log', bootOutput.stderr ?? '');
    report.signatureHits = report.signatureHits?.length
      ? report.signatureHits
      : scanLogs(`${bootOutput.stdout}\n${bootOutput.stderr}`);

    if (iso) {
      try {
        const homeCleanup = await iso.dispose();
        report.cleanup.homeCleanup = homeCleanup;
        report.cleanup.homeRemoved = homeCleanup.removed;
      } catch (error) {
        errors.push(`isolated home cleanup failed: ${String(error)}`);
        report.cleanup.homeRemoved = false;
      }
    }
    addCheck(checks, 'cleanup-home', report.cleanup.homeRemoved === true, String(report.cleanup.homeRemoved));
    addCheck(
      checks,
      'cleanup-ports',
      report.cleanup.portsLeft.length === 0,
      report.cleanup.portsLeft.length ? `still listening: ${report.cleanup.portsLeft.join(', ')}` : 'none',
    );
    addCheck(checks, 'cleanup-processes', processesLeft === 0, processesLeft ? `${processesLeft} cleanup failure(s)` : 'none');

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
          ? `isolated root removed, ports released; new lab homes: ${residue.newHomes.length}`
          : `failed: ${residue.failures.join(', ')}`,
      );
    } catch (error) {
      addCheck(checks, 'cleanup-no-residue', false, String(error?.message ?? error));
    }

    if (realBefore) {
      try {
        const realAfter = snapshotRealHome();
        const diff = diffRealHome(realBefore, realAfter);
        report.realHome = { before: realBefore, after: realAfter, diff };
        addCheck(checks, 'real-home-unchanged', diff.ok, diff.ok ? 'all structural hashes unchanged' : `${diff.changed.length} changed`);
      } catch (error) {
        addCheck(checks, 'real-home-unchanged', false, String(error));
      }
    }

    if (report.profile?.dir) {
      const profileDir = report.profile.dir;
      copyIfExists(path.join(profileDir, 'package.json'), path.join(runDir, 'profile.package.json'));
      copyIfExists(path.join(profileDir, 'cordis.patch.yml'), path.join(runDir, 'profile.cordis.patch.yml'));
      copyIfExists(path.join(profileDir, 'cordis.yml'), path.join(runDir, 'profile.cordis.yml'));
    }
    writeJson(runDir, 'runtime.json', report.runtime);
    writeJson(runDir, 'plugin-validation.json', report.pluginValidation);
    writeJson(runDir, 'fixture.json', report.fixture);
    writeJson(runDir, 'mock-llm.json', report.mockModel ? { ...report.mockModel, evidence: mockServer?.evidence ?? [] } : null);
    writeJson(runDir, 'routes.json', report.routes);
    writeJson(runDir, 'cleanup.json', report.cleanup);
    report.finishedAt = nowIso();
    report.ok = checks.every((check) => check.pass || check.informational === true);
    report.artifacts = {
      runDir,
      reportMd: path.join(runDir, 'report.md'),
      reportJson: path.join(runDir, 'report.json'),
      bootOut: path.join(runDir, 'boot.out.log'),
      bootErr: path.join(runDir, 'boot.err.log'),
      installLog: path.join(runDir, 'install.log'),
      mockLlm: path.join(runDir, 'mock-llm.json'),
      screenshots: report.browser?.screenshots ?? {},
    };
    writeJson(runDir, 'report.json', report);
    writeText(runDir, 'report.md', renderReportMarkdown(report));
  }
  return report;
}
