export { runLab } from './runner.js';
export { main, parseArgv, helpText } from './cli.js';
export { locateRuntime, readRuntimeVersion } from './runtime-locator.js';
export { createIsolatedHome, assertSafeHome } from './home-manager.js';
export { writeMinimalProfile, buildProfileManifest } from './profile-builder.js';
export { scanLogs, summarize } from './log-scanner.js';
export { diffStringMap, detectEffectConflicts } from './theme-token-probe.js';
export { diffSlots, detectSlotConflicts } from './slot-probe.js';
export { runMatrix, readMatrixConfig } from './matrix-runner.js';
export { startMockLlmServer, chooseMockTool } from './mock-llm-server.js';
export { writeMockProviderPatch } from './provider-patcher.js';
export { evaluateDomAssertions } from './dom-assertions.js';
export { diffResidue, listLabResidue, snapshotLabResidue, verifyNoResidue } from './cleanup.js';
export { describeAgentCoverage, scanForCredentials } from './model-coverage.js';
export { classifyMatrixRuns, changedStringKeys, layerIndex } from './effect-classifier.js';
export { collectSlotRegistrations, collectToolNames, findDeclarationConflicts, scanPluginDeclarations } from './declaration-scanner.js';
export { installProfilePlugins } from './plugin-install.js';
export { compareScreenshots, pngStats } from './screenshot-diff.js';
export { runShell } from './electron-shell/shell-runner.js';
export {
  DESKTOP_ATTRIBUTE_HINTS,
  diffProbeSnapshots,
  isConnectionLost,
  normalizeProbe,
  summarizeProbe,
} from './electron-shell/shell-probe.js';
