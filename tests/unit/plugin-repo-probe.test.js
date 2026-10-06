import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRepoSuggestions,
  discoverRepoPackages,
  hasPluginEntry,
  isMonorepoManifest,
  looksLikeGithubSpec,
  parseGithubRepo,
  probeGithubRepo,
} from '../../src/plugin-repo-probe.js';

const ROOT_MANIFEST = {
  name: 'dsh-orb-cordis',
  private: true,
  type: 'module',
  packageManager: 'pnpm@11.7.0',
  scripts: { build: 'pnpm -r --if-present build', typecheck: 'tsc -p packages/host/tsconfig.json' },
  devDependencies: { typescript: '^5.9.3' },
};

const BUNDLE_MANIFEST = {
  name: 'dsh-orb',
  version: '0.1.3',
  main: 'lib/index.js',
  exports: { './client': './client.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
};

const HOST_MANIFEST = { name: '@dsh-orb/host', version: '0.0.0', private: true };

const REPO_TREE = {
  files: [
    {
      type: 'directory',
      name: 'packages',
      files: [
        { type: 'directory', name: 'bundle', files: [{ type: 'file', name: 'package.json' }] },
        { type: 'directory', name: 'host', files: [{ type: 'file', name: 'package.json' }] },
      ],
    },
    { type: 'file', name: 'package.json' },
  ],
};

/** Fake fetch that answers the jsDelivr/raw URLs used by the probe. */
function fakeFetch() {
  return async (url) => {
    const json = (value) => ({ ok: true, status: 200, json: async () => value });
    if (url.includes('data.jsdelivr.com') && url.includes('@main')) return json(REPO_TREE);
    if (url.includes('data.jsdelivr.com')) return { ok: false, status: 404, json: async () => null };
    if (url.endsWith('/packages/bundle/package.json')) return json(BUNDLE_MANIFEST);
    if (url.endsWith('/packages/host/package.json')) return json(HOST_MANIFEST);
    if (url.endsWith('/package.json')) return json(ROOT_MANIFEST);
    return { ok: false, status: 404, json: async () => null };
  };
}

test('parseGithubRepo accepts the specs a user would paste', () => {
  assert.deepEqual(parseGithubRepo('mini-yifan/dsh-orb-cordis')?.slug, 'mini-yifan/dsh-orb-cordis');
  assert.deepEqual(parseGithubRepo('https://github.com/mini-yifan/dsh-orb-cordis')?.slug, 'mini-yifan/dsh-orb-cordis');
  assert.deepEqual(parseGithubRepo('https://github.com/mini-yifan/dsh-orb-cordis/tree/main/packages/bundle')?.slug, 'mini-yifan/dsh-orb-cordis');
  assert.deepEqual(parseGithubRepo('https://github.com/mini-yifan/dsh-orb-cordis#v0.1.3')?.ref, 'v0.1.3');
  assert.deepEqual(parseGithubRepo('github:mini-yifan/dsh-orb-cordis#plugin-v0.1.3')?.ref, 'plugin-v0.1.3');
  assert.deepEqual(parseGithubRepo('git@github.com:mini-yifan/dsh-orb-cordis.git')?.slug, 'mini-yifan/dsh-orb-cordis');
});

test('parseGithubRepo rejects npm names, scoped packages, and local paths', () => {
  assert.equal(parseGithubRepo('dsh-orb-cordis'), null);
  assert.equal(parseGithubRepo('@scope/pkg'), null);
  assert.equal(parseGithubRepo('C:\\tmp\\my-plugin'), null);
  assert.equal(parseGithubRepo('./fixtures/plugins/effect-probe'), null);
  assert.equal(parseGithubRepo('file:../plugin'), null);
  assert.equal(looksLikeGithubSpec('dsh-orb-cordis'), false);
  assert.equal(looksLikeGithubSpec('mini-yifan/dsh-orb-cordis'), true);
});

test('isMonorepoManifest and hasPluginEntry separate source from bundle', () => {
  assert.equal(isMonorepoManifest(ROOT_MANIFEST), true);
  assert.equal(isMonorepoManifest({ name: 'x', main: 'index.js' }), false);
  assert.equal(isMonorepoManifest({ name: 'x', workspaces: ['packages/*'] }), true);
  assert.equal(hasPluginEntry(ROOT_MANIFEST), false);
  assert.equal(hasPluginEntry(BUNDLE_MANIFEST), true);
});

test('discoverRepoPackages finds the published bundle inside a monorepo', async () => {
  const repo = parseGithubRepo('mini-yifan/dsh-orb-cordis');
  const probe = await discoverRepoPackages(repo, { fetchImpl: fakeFetch(), timeoutMs: 1_000 });
  assert.equal(probe.monorepo, true);
  assert.equal(probe.manifestName, 'dsh-orb-cordis');
  assert.deepEqual(probe.packages.map((entry) => entry.name).sort(), ['@dsh-orb/host', 'dsh-orb']);
  const suggestions = buildRepoSuggestions(probe);
  assert.match(suggestions[0], /monorepo/);
  assert.match(suggestions.join(' '), /npm:dsh-orb/);
  assert.equal(suggestions.join(' ').includes('自动替换'), true, 'the suggestion must say it is not automatic');
});

test('probeGithubRepo returns null for an npm name and empty suggestions when unreachable', async () => {
  assert.equal(await probeGithubRepo('dsh-orb-cordis', { fetchImpl: fakeFetch() }), null);
  const unreachable = await probeGithubRepo('owner/repo', {
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => null }),
  });
  assert.equal(unreachable.manifest, null);
  assert.deepEqual(unreachable.suggestions, []);
});

test('a non-monorepo repo whose manifest name differs is still named', () => {
  const suggestions = buildRepoSuggestions({
    repo: { slug: 'owner/claimed-name', repo: 'claimed-name' },
    manifest: { name: 'real-npm-name', main: 'index.js' },
    manifestName: 'real-npm-name',
    monorepo: false,
    packages: [],
  });
  assert.match(suggestions.join(' '), /npm:real-npm-name/);
});
