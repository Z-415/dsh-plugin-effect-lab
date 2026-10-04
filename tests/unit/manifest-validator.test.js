import assert from 'node:assert/strict';
import test from 'node:test';
import { validateManifest } from '../../src/manifest-validator.js';
import { seederPluginDir } from '../../src/fixture-manager.js';

test('the session seeder fixture passes 0.2.0-rc.2 validation', () => {
  const manifest = {
    name: 'dsh-lab-session-fixture',
    version: '1.0.0',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    peerDependencies: { '@deepseek-ai/dsh-session': '0.2.0-rc.2' },
  };
  const result = validateManifest({ manifest, runtimeVersion: '0.2.0-rc.2', packageDir: seederPluginDir() });
  assert.equal(result.findings.some((item) => item.severity === 'blocker'), false, JSON.stringify(result.findings, null, 2));
});

test('an incompatible engines range is a blocker', () => {
  const result = validateManifest({
    manifest: { name: 'old-plugin', version: '1.0.0', main: 'lib/index.js', dsh: { compatibility: { dsh: '<0.2.0' } } },
    runtimeVersion: '0.2.0-rc.2',
  });
  assert.equal(result.findings.some((item) => item.id === 'engines-incompatible' && item.severity === 'blocker'), true);
});

test('duplicate bundle patch ids are a blocker', () => {
  const result = validateManifest({
    manifest: {
      name: 'dup-plugin',
      version: '1.0.0',
      main: 'lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    },
    runtimeVersion: '0.2.0-rc.2',
    packageDir: seederPluginDir(),
    allPatchIds: new Set(['dsh-lab-session-fixture']),
  });
  assert.equal(result.findings.some((item) => item.severity === 'blocker'), true);
});

test('a prerelease-aware peer range is a warning, not a blocker', () => {
  const result = validateManifest({
    manifest: {
      name: 'dsh-dream-skin-like',
      version: '1.0.0',
      main: 'lib/index.js',
      exports: { '.': './lib/index.js', './client': './lib/client.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [] } },
      peerDependencies: { '@deepseek-ai/dsh-client-store': '>=0.1.0-rc.6 <0.3.0-0' },
      peerDependenciesMeta: { '@deepseek-ai/dsh-client-store': { optional: true } },
    },
    runtimeVersion: '0.2.0-rc.2',
  });
  assert.equal(result.findings.some((item) => item.id === 'peer-incompatible'), false);
  assert.equal(result.findings.some((item) => item.id === 'peer-prerelease-range' && item.severity === 'warn'), true);
  assert.equal(result.findings.some((item) => item.severity === 'blocker'), false, JSON.stringify(result.findings));
});
