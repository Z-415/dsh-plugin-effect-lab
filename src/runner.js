import fs from 'node:fs';
import path from 'node:path';
import { openUi } from './browser-driver.js';
import { bootWeb } from './boot-supervisor.js';
import { assertBootListening, bootReadiness } from './boot-readiness.js';
import { snapshotLabResidue, verifyNoResidue } from './cleanup.js';
import { evaluateDomAssertions } from './dom-assertions.js';
import {
  DEFAULT_BROWSER_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  REAL_HOME,
  defaultArtifactsRoot,
} from './config.js';
import { createIsolatedHome, describeHomeCleanup } from './home-manager.js';
import {
  createFixtureWorkspace,
  FIXTURE_SESSION_ID,
  FIXTURE_SESSION_TITLE,
  fixtureEnv,
  readFixtureSpec,
  resetLabWorkspaceState,
} from './fixture-manager.js';
import { summarizeDiagnostics, writeDiagnosticsBundle } from './diagnostics.js';
import { hasFatal, scanLogs, scanNoise, scanSources, summarize, tailLines } from './log-scanner.js';
import { writeHtmlReport } from './html-report.js';
import {
  isClonedLabProfile,
  openLabProfileHome,
  profileExists,
  recordProfileClone,
  recordProfilePlugins,
  removeLabProfile,
} from './lab-profile.js';
import { describeAgentCoverage, scanForCredentials } from './model-coverage.js';
import { startMockLlmServer } from './mock-llm-server.js';
import { installProfilePlugins, listInstalledProfilePlugins } from './plugin-install.js';
import { describePluginInstall, installFailureMessage } from './plugin-install-diagnostics.js';
import { mintAuthCookie } from './port-and-token.js';
import { MOCK_API_KEY_ENV, MOCK_MODEL, MOCK_PROVIDER, writeMockProviderPatch } from './provider-patcher.js';
import { writeMinimalProfile } from './profile-builder.js';
import { cloneProfileInto, grantClonedProfileExemptions, rebuildClonedProfile } from './profile-cloner.js';
import { progressEvent } from './progress.js';
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
import { classifyRuntimeVersion, isInformationalRuntime } from './runtime-versions.js';
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
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const progress = (phase, detail) => {
    try {
      onProgress(progressEvent(phase, detail));
    } catch {
      // Progress reporting must never break a run.
    }
  };
  const runId = options.runId ?? makeRunId();
  const realHomePath = options.realHome ?? REAL_HOME;
  const profileLab = options.profileLab ?? options.cloneTo ?? null;
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
    clone: null,
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
    cleanup: { homeRemoved: null, portsLeft: [], homeCleanup: null, processesLeft: 0, browserTempDirs: [] },
    realHome: null,
    errors,
    hints: [],
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
    const runtimeCompat = classifyRuntimeVersion(version.version);
    report.runtime.compat = runtimeCompat;
    addCheck(checks, 'runtime-version', runtimeCompat.supported, runtimeCompat.detail, {
      informational: isInformationalRuntime(runtimeCompat),
    });
    progress('locate-runtime', `runtime ${version.version ?? 'unknown'}`);

    realBefore = snapshotRealHome(realHomePath);
    residueBefore = snapshotLabResidue();
    addCheck(
      checks,
      'real-home-baseline',
      true,
      `${Object.keys(realBefore.files).length} structural files hashed; credentials/sessions/settings untouched`,
    );
    progress('snapshot', `${Object.keys(realBefore.files).length} structural file(s) hashed`);

    const cloneTarget = options.cloneProfile ? profileLab : null;
    if (cloneTarget && profileExists(cloneTarget)) {
      if (options.force !== true) {
        throw new Error(`lab profile "${cloneTarget}" already exists; pass --force to overwrite it, or choose another name`);
      }
      const removed = removeLabProfile(cloneTarget);
      if (removed.error) throw new Error(removed.error);
    }
    iso = profileLab
      ? openLabProfileHome(profileLab)
      : createIsolatedHome({ withAgents: true });
    report.isolation = {
      root: iso.root,
      home: iso.home,
      agents: iso.agents,
      tmp: iso.tmp,
      ...(iso.persistent ? { persistent: true, labProfile: iso.name } : {}),
    };
    addCheck(
      checks,
      'isolated-home',
      true,
      iso.persistent ? `reused lab profile "${iso.name}": ${iso.home}` : iso.home,
    );
    progress('isolated-home', `isolated home ${iso.home}`);
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

    const profileName = options.profileName ?? (iso.persistent ? `lab-${iso.name}` : makeProfileName());
    const profileDir = iso.profileDir(profileName);
    let clone = null;
    if (options.cloneProfile) {
      clone = cloneProfileInto({
        realHome: realHomePath,
        kind: options.cloneProfile,
        profileDir,
        plugins: options.clonePlugins === 'none' ? 'none' : 'all',
        exclude: options.cloneExclude ?? [],
        dropLocal: options.cloneDropLocal === true,
      });
      report.clone = clone;
      addCheck(
        checks,
        'clone-source',
        true,
        `cloned real ${clone.kind} profile structure: ${clone.copiedFiles.length} file(s), `
          + `${clone.copiedPatches.length} patch(es) from ${clone.sourceDir}`,
      );
      addCheck(
        checks,
        'clone-real-profile-unchanged',
        clone.sourceUnchangedAfterCopy === true,
        `${clone.sourceSnapshot.files.length} structural file(s) hashed; source hash `
          + `${clone.sourceSnapshot.hash.slice(0, 12)}... unchanged`,
      );
      const cloneCredentials = scanForCredentials(iso.home);
      clone.credentials = cloneCredentials;
      addCheck(
        checks,
        'clone-no-credentials',
        cloneCredentials.ok,
        cloneCredentials.ok
          ? 'cloned home has no credential file or inline API key'
          : `found ${cloneCredentials.files.length} credential file(s), ${cloneCredentials.keys.length} inline key(s)`,
      );
      progress(
        'install-plugins',
        `cloned real ${clone.kind} profile: ${clone.copiedFiles.length} file(s), `
          + `${clone.excluded.length + clone.droppedLocal.length} plugin(s) dropped`,
      );
    }
    if (!fs.existsSync(path.join(profileDir, 'package.json'))) {
      writeMinimalProfile(profileDir, { name: profileName });
    }
    if (clone && !iso.persistent) {
      report.hints.push('本次克隆是临时的，已随隔离 home 删除；想保留请加 --profile-lab <名字>（或 --clone-to <名字>）。');
    }
    report.profile = { name: profileName, dir: profileDir, ...(clone ? { clonedFrom: clone.kind } : {}) };
    addCheck(checks, 'profile-minimal', true, path.join(profileDir, 'package.json'));

    const env = isolatedEnv(iso);
    if (clone) {
      const installOptions = {
        runtime,
        env,
        profileDir,
        profileName,
        timeoutMs: options.installTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        online: options.online === true,
      };
      let rebuilt = await rebuildClonedProfile(installOptions);
      clone.install = rebuilt;
      clone.incompatibleBefore = rebuilt.incompatible;
      // A peer-gate denial is a policy rejection, not a failed install: if the
      // incompatible plugins can be granted an exact-version exemption, do it
      // inside the clone and re-run so they actually load.
      if (options.cloneAcceptRisk === true && rebuilt.incompatible.length) {
        const exemptions = await grantClonedProfileExemptions({
          ...installOptions,
          runtimeVersion: report.runtime.version,
          incompatible: rebuilt.incompatible,
        });
        clone.exemptions = exemptions;
        if (exemptions.granted.length) {
          rebuilt = await rebuildClonedProfile(installOptions);
          clone.installRecheck = rebuilt;
          clone.install = rebuilt;
        }
      }
      writeText(runDir, 'clone-install.log', `$ dsh ${rebuilt.args.join(' ')}\n\n${rebuilt.stdout}\n${rebuilt.stderr}`);
      const gateNote = rebuilt.incompatible.length
        ? `; DSH denied ${rebuilt.incompatible.length} incompatible plugin(s) (peer range)`
        : '';
      addCheck(
        checks,
        'clone-install',
        rebuilt.missing.length === 0,
        `pnpm/DSH exit ${rebuilt.code}${rebuilt.timedOut ? ' (timeout)' : ''}`
          + `; ${rebuilt.installed.length} present, ${rebuilt.missing.length} missing${gateNote}`,
      );
      addCheck(
        checks,
        'clone-plugins-present',
        rebuilt.missing.length === 0,
        rebuilt.missing.length
          ? `${rebuilt.missing.length} plugin(s) failed to install: ${rebuilt.missing.join(', ')}`
          : 'every cloned dependency is present in node_modules',
      );
      addCheck(
        checks,
        'clone-compat',
        rebuilt.incompatible.length === 0,
        rebuilt.incompatible.length
          ? `DSH denied (peer range): ${rebuilt.incompatible.map((plugin) => `${plugin.name}@${plugin.version}`).join(', ')}`
            + '; re-run with --clone-accept-risk to grant exact-version exemptions inside the clone'
          : 'no incompatible plugin was denied by DSH',
        { informational: rebuilt.incompatible.length > 0 },
      );
      if (clone.exemptions) {
        const failed = (clone.exemptions.failures ?? []).map((item) => `${item.name}@${item.version}`).join(', ');
        addCheck(
          checks,
          'clone-exemptions',
          (clone.exemptions.failures ?? []).length === 0,
          clone.exemptions.granted.length
            ? `granted ${clone.exemptions.granted.length} exact-version exemption(s) inside the clone`
              + `${failed ? `; failed: ${failed}` : ''}`
            : `no exemption was granted${failed ? `; failed: ${failed}` : ''}`,
        );
      }
    }
    if (clone && iso.persistent) {
      const clonedFrom = {
        kind: clone.kind,
        at: nowIso(),
        sourceHash: clone.sourceSnapshot.hash.slice(0, 12),
        copiedFiles: clone.copiedFiles.length,
        excluded: [
          ...clone.excluded.map((entry) => entry.spec ?? entry.name),
          ...clone.droppedLocal.map((entry) => entry.spec ?? entry.name),
        ],
        plugins: clone.plugins,
        installed: clone.install?.installed?.length ?? 0,
        missing: clone.install?.missing ?? [],
        denied: (clone.install?.incompatible ?? []).map((plugin) => `${plugin.name}@${plugin.version}`),
        acceptedRisk: clone.exemptions?.granted?.length ?? 0,
      };
      recordProfileClone(iso.name, clonedFrom);
      clone.persistent = true;
      clone.profile = iso.name;
      clone.clonedFrom = clonedFrom;
    }
    const fixtureEnabled = options.fixture !== false;
    if (fixtureEnabled) {
      const reset = resetLabWorkspaceState(iso.home);
      if (reset.removed.length) {
        progress('install-plugins', `reset ${reset.removed.length} stale lab workspace file(s)`);
      }
    }
    const fixtureVariant = options.fixtureVariant ?? 'default';
    const fixtureSpec = fixtureEnabled ? readFixtureSpec(fixtureVariant) : null;
    const fixtureSessionId = fixtureSpec?.sessionId ?? FIXTURE_SESSION_ID;
    const fixtureTitle = fixtureSpec?.title ?? FIXTURE_SESSION_TITLE;
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
        ? `${pluginPipeline.summary.blockers.length} blocker(s) (stage=precheck)`
        : pluginPipeline.stage === 'install'
          ? `${pluginPipeline.entries.length} package(s) validated; install failed (stage=install)`
          : `${pluginPipeline.entries.length} package(s) checked (stage=${pluginPipeline.stage})`,
    );
    // Keep the validation evidence even when a later stage throws, so
    // report.json / plugin-validation.json still describe what was checked.
    report.pluginValidation = pluginPipeline.validation;
    if (pluginPipeline.stage === 'precheck') {
      throw new Error(`plugin precheck failed: ${pluginPipeline.summary.blockers.map((item) => `${item.plugin}:${item.id}`).join(', ')}`);
    }
    if (pluginPipeline.install) {
      writeText(runDir, 'install.log', `$ dsh ${pluginPipeline.installArgs.join(' ')}\n\n${pluginPipeline.install.stdout}\n${pluginPipeline.install.stderr}`);
      const install = pluginPipeline.install;
      const installDiagnosis = pluginPipeline.installDiagnosis ?? null;
      const described = describePluginInstall(pluginPipeline.stage, install, installDiagnosis);
      addCheck(checks, 'plugin-install', described.pass, described.detail);
      if (pluginPipeline.stage === 'install') {
        report.installFailure = installDiagnosis;
        for (const hint of installDiagnosis?.suggestions ?? []) report.hints.push(hint);
        throw new Error(`${installFailureMessage(installDiagnosis, install)}\n${tail(`${install.stdout}\n${install.stderr}`, 4000)}`);
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
    report.plugins = pluginPipeline.pluginList;
    // Pre-existing third-party plugins in a persistent profile can change the
    // sidebar/conversation rendering. The fixture is still seeded and the probe
    // still reports, but a profile plugin breaking the view must not fail the
    // whole run as if the lab's own fixture were broken.
    const profileThirdPartyPlugins = listInstalledProfilePlugins(profileDir)
      .filter((name) => name !== 'dsh-lab-session-fixture');
    const installedPluginsThisRun = (options.plugins ?? []).length > 0;
    if (pluginPipeline.profileAudit) {
      const audit = pluginPipeline.profileAudit;
      report.profileAudit = { names: audit.names, conflicts: audit.conflicts };
      addCheck(
        checks,
        'plugin-profile-audit',
        audit.conflicts.length === 0,
        audit.conflicts.length
          ? audit.conflicts.map((conflict) => `${conflict.id}:${conflict.key}`).join(', ')
          : `${audit.names.length} installed package(s), no cross-plugin conflict`,
        // Conflicts inside a cloned profile are pre-existing in the real
        // profile the user started from; report them, don't fail the run.
        { informational: isClonedLabProfile(profileLab) || !installedPluginsThisRun },
      );
    }
    const recordedPlugins = (pluginPipeline.pluginList ?? []).filter((entry) => !entry.fixture);
    if (profileLab && recordedPlugins.length) {
      recordProfilePlugins(profileLab, recordedPlugins);
      progress('install-plugins', `lab profile "${profileLab}" now records ${recordedPlugins.length} plugin spec(s)`);
    }
    progress(
      'install-plugins',
      pluginPipeline.install ? `installed ${pluginPipeline.resolvedSpecs.length} plugin spec(s)` : 'no plugins requested',
    );

    if (options.mockModel) {
      mockServer = await startMockLlmServer({ model: MOCK_MODEL });
      writeMockProviderPatch(profileDir, { port: mockServer.port });
      addCheck(checks, 'mock-provider-started', true, mockServer.origin);
    }

    const bootWebImpl = options.bootWebImpl ?? bootWeb;
    boot = await bootWebImpl({
      runtime,
      home: iso.home,
      agentsHome: iso.agents,
      profileDir,
      profileName,
      tmpDir: iso.tmp,
      timeoutMs: options.bootTimeoutMs,
      transport: options.bootTransport,
      env: {
        ...(fixtureEnabled
          ? fixtureEnv({ enabled: true, sessionId: fixtureSessionId, cwd: fixtureWorkspace, variant: fixtureVariant })
          : fixtureEnv({ enabled: false })),
        ...(mockServer ? { [MOCK_API_KEY_ENV]: 'lab-mock-key' } : {}),
      },
    });
    bootOutput = boot.getOutput();
    const readiness = bootReadiness(boot);
    addCheck(checks, 'boot-url', readiness.urlPass, readiness.urlDetail);
    report.boot = {
      port: boot.port,
      listening: boot.listening === true,
      transport: boot.transport,
      fallbackReason: boot.fallbackReason ?? null,
      injections: { count: boot.injections?.length ?? 0, kinds: boot.injectionKinds ?? [] },
    };
    addCheck(checks, 'boot-listening', readiness.listeningPass, readiness.listeningDetail);
    if (!readiness.listeningPass) {
      // Fail fast: probing an unlistening port only produces cascading
      // `fetch failed` noise. bootOutput is already captured above, so the
      // failureContext still carries the boot-log tail.
      errors.push(`boot-listening failed before probing: ${readiness.listeningDetail}`);
      assertBootListening(boot);
    }
    addCheck(
      checks,
      'boot-transport',
      boot.transport === 'ipc',
      boot.transport === 'ipc'
        ? `ipc ready message (${boot.injections?.length ?? 0} injection row(s))`
        : `stdout fallback (${boot.fallbackReason ?? 'unknown'})`,
      { informational: true },
    );
    progress('boot-host', `isolated host booted on port ${boot.port}`);

    report.signatureHits = scanLogs(`${bootOutput.stdout}\n${bootOutput.stderr}`);
    report.noise = scanNoise(`${bootOutput.stdout}\n${bootOutput.stderr}`);
    addCheck(checks, 'boot-signatures', !hasFatal(report.signatureHits), summarize(report.signatureHits));

    let auth = { status: 0, cookie: '', error: null };
    try {
      auth = await mintAuthCookie(boot.url);
    } catch (error) {
      auth = { status: 0, cookie: '', error: String(error?.message ?? error) };
      errors.push(`token mint failed: ${auth.error}`);
    }
    addCheck(
      checks,
      'token-mint',
      auth.status === 303 && Boolean(auth.cookie),
      auth.error ? `mint failed: ${auth.error}` : `status ${auth.status}, cookie ${auth.cookie ? 'present' : 'missing'}`,
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
        const fixtureSession = sessions.find((item) => item.sessionId === fixtureSessionId);
        addCheck(
          checks,
          'fixture-session-listed',
          Boolean(fixtureSession),
          fixtureSession ? fixtureSessionId : `not in ${sessions.length} session(s)`,
        );
        if (fixtureSession) {
          const page = await sessionPage(boot.origin, auth.cookie, fixtureSessionId);
          const types = new Set(page.events.map((event) => event.type));
          const expected = fixtureVariant === 'empty' ? [] : ['user/message', 'assistant/message', 'tool/result'];
          const missing = expected.filter((type) => !types.has(type));
          addCheck(
            checks,
            'fixture-session-events',
            missing.length === 0,
            missing.length ? `missing ${missing.join(', ')}` : `${page.events.length} event(s)`,
          );
          const assistantContents = page.events
            .filter((event) => event.type === 'assistant/message')
            .flatMap((event) => event.data?.message?.content ?? []);
          const contentBlockTypes = [...new Set(assistantContents.map((block) => block?.type).filter(Boolean))];
          const reasoningBlocks = assistantContents.filter((block) => block?.type === 'reasoning').length;
          const codeFences = assistantContents
            .filter((block) => block?.type === 'text' && /```/.test(block.text ?? ''))
            .length;
          const streamTypes = [...new Set(
            page.events
              .filter((event) => event.type === 'assistant/message')
              .flatMap((event) => event.data?.stream ?? [])
              .map((record) => record?.type)
              .filter(Boolean),
          )];
          if (fixtureVariant === 'rich') {
            addCheck(
              checks,
              'fixture-reasoning-block',
              reasoningBlocks >= 1,
              reasoningBlocks
                ? `${reasoningBlocks} assistant/message reasoning block(s)`
                : `no content block of type "reasoning" (saw: ${contentBlockTypes.join(', ') || 'none'})`,
            );
            addCheck(
              checks,
              'fixture-code-block',
              codeFences >= 1,
              codeFences ? `${codeFences} fenced code block(s)` : 'no fenced code block in any text block',
            );
            addCheck(
              checks,
              'fixture-reasoning-stream',
              streamTypes.includes('reasoning-chunks'),
              `stream records: [${streamTypes.join(', ')}]`,
            );
          }
          report.fixture = {
            variant: fixtureVariant,
            sessionId: fixtureSessionId,
            title: fixtureTitle,
            workspace: fixtureWorkspace,
            workspaceId,
            events: page.events.length,
            types: [...types],
            contentBlockTypes,
            reasoningBlocks,
            codeFences,
            streamTypes,
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
    progress('probe-ui', 'opening the UI in headless Edge');
    const requestedScreenshots = options.screenshots ?? ['home'];
    const wantsSettings = requestedScreenshots.includes('settings');
    // A fixture with no events has no sidebar session row to click; only the
    // workspace selection applies there.
    const fixtureHasSessionRow = fixtureEnabled && (fixtureSpec?.turns?.length ?? 0) > 0;
    // The rich variant additionally proves the renderer actually shows the
    // thinking area and the code block, not just that the events were stored.
    const richTurn = fixtureVariant === 'rich' ? (fixtureSpec?.turns ?? []).find((turn) => turn.reasoning) : null;
    const richCode = fixtureVariant === 'rich'
      ? (fixtureSpec?.turns ?? []).map((turn) => turn.code).find(Boolean)
      : null;
    const fixturesAfter = fixtureVariant === 'rich' && richTurn
      ? {
        fixtureText: `(() => {
          const text = document.body ? document.body.textContent : '';
          return JSON.stringify({
            length: text.length,
            reasoningFound: text.includes(${JSON.stringify(String(richTurn.reasoning).slice(0, 60))}),
            codeFound: text.includes(${JSON.stringify(String(richCode?.text ?? '').split('\n')[0])}),
          });
        })()`,
      }
      : {};
    browser = await openUi({
      baseUrl: boot.url,
      screenshots: requestedScreenshots.filter((name) => name !== 'settings'),
      screenshotsAfter: fixtureEnabled ? ['fixture'] : [],
      screenshotsSettings: wantsSettings ? ['settings'] : [],
      clickText: fixtureEnabled ? path.basename(fixtureWorkspace) : null,
      clickSessionRow: fixtureHasSessionRow,
      sessionText: fixtureHasSessionRow ? fixtureTitle : null,
      openSettings: wantsSettings,
      probesAfter: fixturesAfter,
      assertTokens,
      artifactsDir: runDir,
      timeoutMs: options.browserTimeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS,
      browserPath: options.browserPath,
    });
    if (browser.userDataDir) report.cleanup.browserTempDirs.push(browser.userDataDir);
    addCheck(checks, 'ui-ready', browser.ui.ready, JSON.stringify(browser.ui).slice(0, 500));
    if (fixtureEnabled) {
      addCheck(
        checks,
        'fixture-ui-clicked',
        browser.clicked === true && (!fixtureHasSessionRow || browser.clickedSession === true),
        `workspace=${browser.clicked === true}, session=${browser.clickedSession === true}`
          + `${fixtureHasSessionRow ? '' : ' (no fixture events; session row not expected)'}`,
        { informational: profileThirdPartyPlugins.length > 0 },
      );
      if (fixtureVariant === 'rich') {
        let probe = null;
        try {
          probe = JSON.parse(browser.extraAfter?.fixtureText ?? 'null');
        } catch {
          probe = null;
        }
        if (report.fixture) report.fixture.textProbe = probe;
        addCheck(
          checks,
          'fixture-thinking-rendered',
          probe?.reasoningFound === true,
          probe ? `renderer text ${probe.length} chars; reasoningFound=${probe.reasoningFound}` : 'renderer text probe missing',
          { informational: profileThirdPartyPlugins.length > 0 },
        );
        addCheck(
          checks,
          'fixture-code-rendered',
          probe?.codeFound === true,
          probe ? `codeFound=${probe.codeFound}` : 'renderer text probe missing',
          { informational: profileThirdPartyPlugins.length > 0 },
        );
      }
    }
    addCheck(checks, 'dom-slots', browser.dom.slotCount > 0, `${browser.dom.slotCount} data-slot node(s)`);
    if (browser.settleAfter) {
      addCheck(
        checks,
        'browser-dom-settled',
        browser.settleAfter.stable === true,
        `${browser.settleAfter.slots} slot(s) after ${browser.settleAfter.waitedMs}ms`
          + `${browser.settleAfter.stable ? '' : `, did not reach minSlots=${browser.settleAfter.minSlots ?? 'n/a'}`}`,
      );
    }
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
      settle: browser.settle ?? null,
      settleAfter: browser.settleAfter ?? null,
      extra: browser.extra ?? {},
      extraAfter: browser.extraAfter ?? {},
      dom: browser.dom,
      clicked: browser.clicked,
      consoleErrors: browser.consoleErrors,
      pageErrors: browser.pageErrors,
      networkFailures: browser.networkFailures,
      screenshots: browser.screenshots,
    };
    writeJson(runDir, 'dom/dom.json', browser.dom);
    // The signature library also reads the renderer side: client module load
    // failures and slot-kind errors only ever show up in console/page errors.
    const consoleHits = scanSources([
      ...(browser.consoleErrors ?? []),
      ...(browser.pageErrors ?? []),
      ...(browser.networkFailures ?? []).map((failure) => failure.errorText ?? failure.url ?? ''),
    ]);
    report.consoleSignatureHits = consoleHits;
    addCheck(
      checks,
      'console-signatures',
      !hasFatal(consoleHits),
      consoleHits.length ? summarize(consoleHits) : 'no known failure signature in console/page errors',
      { informational: options.strictConsole !== true },
    );
  } catch (error) {
    const message = String(error?.stack ?? error);
    errors.push(message);
    addCheck(checks, 'run', false, message.split('\n')[0].slice(0, 500));
  } finally {
    progress('cleanup', 'cleaning up processes and the isolated home');
    let processesLeft = 0;
    if (browser) {
      try {
        const closed = await browser.close();
        report.cleanup.browserCleanup = closed.removed ?? null;
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
    const bootText = `${bootOutput.stdout ?? ''}\n${bootOutput.stderr ?? ''}`;
    const consoleTexts = browser
      ? [
        ...(browser.consoleErrors ?? []),
        ...(browser.pageErrors ?? []),
        ...(browser.networkFailures ?? []).map((failure) => failure.errorText ?? failure.url ?? ''),
      ]
      : [];
    report.signatureHits = scanSources([bootText, ...consoleTexts]);
    report.bootTail = tailLines(bootText, 40);

    if (iso) {
      try {
        const homeCleanup = await iso.dispose();
        report.cleanup.homeCleanup = homeCleanup;
        report.cleanup.homeRemoved = homeCleanup.removed;
        report.cleanup.homeKept = homeCleanup.kept === true;
      } catch (error) {
        errors.push(`isolated home cleanup failed: ${String(error)}`);
        report.cleanup.homeRemoved = false;
      }
    }
    addCheck(
      checks,
      'cleanup-home',
      report.cleanup.homeRemoved === true || report.cleanup.homeKept === true,
      report.cleanup.homeKept === true
        ? `kept lab profile "${profileLab}"`
        : describeHomeCleanup(report.cleanup.homeCleanup),
    );
    addCheck(
      checks,
      'cleanup-ports',
      report.cleanup.portsLeft.length === 0,
      report.cleanup.portsLeft.length ? `still listening: ${report.cleanup.portsLeft.join(', ')}` : 'none',
    );
    addCheck(checks, 'cleanup-processes', processesLeft === 0, processesLeft ? `${processesLeft} cleanup failure(s)` : 'none');

    try {
      const residue = await verifyNoResidue({
        isolatedRoot: iso?.persistent ? null : (iso?.root ?? null),
        ports: boot?.port ? [boot.port] : [],
        before: residueBefore,
        browserDirs: report.cleanup.browserTempDirs,
      });
      report.cleanup.residue = residue;
      const rootRemoved = residue.checks['isolated-root-removed'] !== false;
      const lockDetail = !rootRemoved && report.cleanup.homeCleanup
        ? `; ${describeHomeCleanup(report.cleanup.homeCleanup)}`
        : '';
      addCheck(
        checks,
        'cleanup-no-residue',
        residue.ok,
        residue.ok
          ? `isolated root removed, ports released; new lab homes: ${residue.newHomes.length}`
          : `failed: ${residue.failures.join(', ')}${lockDetail}`,
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

    if (realBefore) {
      try {
        const realAfter = snapshotRealHome(realHomePath);
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
    writeJson(runDir, 'clone.json', report.clone);
    writeJson(runDir, 'plugin-validation.json', report.pluginValidation);
    writeJson(runDir, 'fixture.json', report.fixture);
    writeJson(runDir, 'mock-llm.json', report.mockModel ? { ...report.mockModel, evidence: mockServer?.evidence ?? [] } : null);
    writeJson(runDir, 'routes.json', report.routes);
    writeJson(runDir, 'cleanup.json', report.cleanup);
    report.finishedAt = nowIso();
    report.ok = checks.every((check) => check.pass || check.informational === true);
    // A failed run that matches no signature must still carry evidence: the
    // boot-log tail and the renderer errors, so it can be diagnosed (and turned
    // into a new signature) instead of just saying "clean".
    if (!hasFatal(report.signatureHits) && (!report.ok || errors.length)) {
      report.failureContext = {
        reason: 'no known failure signature matched',
        errors: errors.slice(0, 10),
        bootTail: tailLines(`${bootOutput.stdout ?? ''}\n${bootOutput.stderr ?? ''}`, 30),
        consoleErrors: (report.browser?.consoleErrors ?? []).slice(0, 10),
        pageErrors: (report.browser?.pageErrors ?? []).slice(0, 10),
      };
    }
    report.artifacts = {
      runDir,
      reportMd: path.join(runDir, 'report.md'),
      reportJson: path.join(runDir, 'report.json'),
      bootOut: path.join(runDir, 'boot.out.log'),
      bootErr: path.join(runDir, 'boot.err.log'),
      installLog: path.join(runDir, 'install.log'),
      ...(report.clone ? { cloneInstallLog: path.join(runDir, 'clone-install.log') } : {}),
      mockLlm: path.join(runDir, 'mock-llm.json'),
      screenshots: report.browser?.screenshots ?? {},
    };
    if (options.html !== false) {
      report.artifacts.reportHtml = path.join(runDir, 'report.html');
    }
    if (options.diagnosticsBundle) {
      try {
        const bundle = writeDiagnosticsBundle(report, options.diagnosticsBundle);
        report.artifacts.diagnosticsBundle = bundle.path;
        addCheck(checks, 'diagnostics-bundle', true, bundle.path);
      } catch (error) {
        errors.push(`diagnostics bundle failed: ${String(error?.message ?? error)}`);
        addCheck(checks, 'diagnostics-bundle', false, String(error?.message ?? error));
      }
    }
    report.ok = checks.every((check) => check.pass || check.informational === true);
    report.diagnostics = summarizeDiagnostics(report);
    report.errorCode = report.diagnostics.primaryCode;
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
