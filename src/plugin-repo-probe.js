/**
 * Best-effort GitHub repo pre-check.
 *
 * A user often pastes a repository URL/name where an npm name was expected. The
 * repo name is not always the published package name, and a monorepo source
 * tree cannot be installed into DSH directly. When a GitHub-looking spec fails,
 * fetch the repo's root package.json and (for a monorepo) its workspace
 * manifests, then suggest the real npm package.
 *
 * This never blocks or replaces the user's input: every network failure is
 * swallowed and returns null. `fetchImpl` is injectable for tests.
 */

export const JSDELIVR_GH = 'https://cdn.jsdelivr.net/gh';
export const JSDELIVR_DATA = 'https://data.jsdelivr.com/v1/packages/gh';
export const GITHUB_RAW = 'https://raw.githubusercontent.com';

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_MANIFESTS = 8;

function stripGitSuffix(value) {
  return String(value ?? '').replace(/\.git$/i, '');
}

/**
 * Parse a GitHub repo out of a spec: `owner/repo`, `github:owner/repo#ref`,
 * `https://github.com/owner/repo[/tree/ref/...]`, or a `git@` clone URL.
 * Returns null for npm names, local paths, and scoped packages.
 */
export function parseGithubRepo(spec) {
  const text = String(spec ?? '').trim();
  if (!text || text.startsWith('@') || text.startsWith('.') || text.startsWith('/') || text.includes('\\')) return null;
  if (/^[A-Za-z]:[\\/]/.test(text) || /^(file|link):/i.test(text)) return null;

  let owner = null;
  let repo = null;
  let ref = null;
  const prefixed = /^github:([^/\s#]+)\/([^/\s#]+?)(?:\.git)?(?:#(.*))?$/i.exec(text);
  const ssh = /^git@github\.com:([^/\s#]+)\/([^/\s#]+?)(?:\.git)?(?:#(.*))?$/i.exec(text);
  const url = /^(?:git\+)?https?:\/\/(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+)/i.exec(text);
  const bare = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#(.*))?$/.exec(text);
  const match = prefixed ?? ssh ?? url ?? bare;
  if (!match) return null;
  owner = match[1];
  repo = stripGitSuffix(match[2]);
  if (prefixed || ssh || bare) ref = match[3] ? match[3].split(/[/?#]/)[0] || null : null;
  else {
    // A URL's `#ref` fragment is the only reliable ref; `/tree/<ref>/...`
    // paths vary and are left to HEAD.
    const fragment = /#([^/?#]+)/.exec(text);
    ref = fragment ? fragment[1] : null;
  }
  if (!owner || !repo || owner === '.' || owner === '..') return null;
  return {
    owner,
    repo,
    slug: `${owner}/${repo}`,
    ref,
    url: `https://github.com/${owner}/${repo}`,
  };
}

export function looksLikeGithubSpec(spec) {
  return Boolean(parseGithubRepo(spec));
}

/** Root manifests that are sources, not installable bundles. */
export function isMonorepoManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  if (manifest.private === true) return true;
  if (manifest.workspaces) return true;
  const scripts = JSON.stringify(manifest.scripts ?? {});
  return /pnpm\s+-r|packages\//i.test(scripts);
}

/** Whether a manifest could be loaded by DSH as a plugin/bundle. */
export function hasPluginEntry(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  return Boolean(manifest.main || manifest.exports || manifest.dsh?.bundle?.patch);
}

async function requestJson(url, options = {}) {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetchFn(url, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-effect-lab' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Root package.json, preferring jsDelivr because raw GitHub is often reset. */
export async function fetchRepoManifest(repo, options = {}) {
  const ref = repo.ref ?? 'HEAD';
  for (const url of [
    `${JSDELIVR_GH}/${repo.slug}@${ref}/package.json`,
    `${GITHUB_RAW}/${repo.slug}/${ref}/package.json`,
  ]) {
    const manifest = await requestJson(url, options);
    if (manifest && typeof manifest === 'object') return { manifest, source: url };
  }
  return null;
}

/** jsDelivr's file tree for a ref, used to find workspace package.json files. */
export async function fetchRepoTree(repo, options = {}) {
  const refs = [...new Set([repo.ref, 'main', 'master', 'HEAD'].filter(Boolean))];
  for (const ref of refs) {
    const tree = await requestJson(`${JSDELIVR_DATA}/${repo.slug}@${ref}`, options);
    if (tree?.files) return { tree, ref };
  }
  return null;
}

function collectManifestPaths(files, prefix = '', out = []) {
  for (const entry of files ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'directory') collectManifestPaths(entry.files, path, out);
    else if (entry.name === 'package.json') out.push(path);
  }
  return out;
}

/**
 * Prefer workspace manifests (`packages/...`) over the repo root and sort
 * shallow paths first, so the installable bundle is fetched early.
 */
function rankManifestPaths(paths) {
  return [...new Set(paths)]
    .filter((path) => path !== 'package.json')
    .sort((a, b) => {
      const rank = (path) => (path.startsWith('packages/') || path.includes('/packages/') ? 0 : 1)
        + path.split('/').length / 100;
      return rank(a) - rank(b) || a.length - b.length;
    });
}

/** Fetch workspace manifests and keep the ones that name a real package. */
export async function discoverRepoPackages(repo, options = {}) {
  const root = await fetchRepoManifest(repo, options);
  if (!root) return { repo, manifest: null, manifestName: null, monorepo: false, packages: [] };
  const monorepo = isMonorepoManifest(root.manifest);
  const packages = [];
  if (monorepo) {
    const tree = await fetchRepoTree(repo, options);
    if (tree) {
      const paths = rankManifestPaths(collectManifestPaths(tree.tree.files))
        .slice(0, options.maxManifests ?? DEFAULT_MAX_MANIFESTS);
      for (const path of paths) {
        const manifest = await requestJson(`${JSDELIVR_GH}/${repo.slug}@${tree.ref}/${path}`, options)
          ?? await requestJson(`${GITHUB_RAW}/${repo.slug}/${tree.ref}/${path}`, options);
        if (!manifest?.name) continue;
        packages.push({
          name: manifest.name,
          version: manifest.version ?? null,
          path,
          private: manifest.private === true,
          plugin: hasPluginEntry(manifest),
        });
      }
    }
  }
  return {
    repo,
    manifest: root.manifest,
    manifestName: root.manifest.name ?? null,
    manifestSource: root.source,
    monorepo,
    packages,
  };
}

/** The actionable sentences for a probed repo, in priority order. */
export function buildRepoSuggestions(probe) {
  if (!probe?.repo) return [];
  const suggestions = [];
  const { repo, manifest, manifestName, monorepo, packages = [] } = probe;
  if (monorepo) {
    const privateNote = manifest?.private === true ? 'private: true，' : '';
    suggestions.push(
      `${repo.slug} 是源码仓库（monorepo），不能直接安装：根 package.json ${privateNote}没有可加载的 main/exports/dsh.bundle.patch。`,
    );
    // Prefer the published bundle (unscoped, with a real version) over a
    // private workspace helper or a 0.0.0 placeholder.
    const rank = (entry) => (entry.name?.startsWith('@') ? 1 : 0)
      + (entry.version && entry.version !== '0.0.0' ? 0 : 1);
    const publishable = packages
      .filter((entry) => entry.plugin && entry.private !== true)
      .sort((a, b) => rank(a) - rank(b))[0]
      ?? packages.find((entry) => entry.plugin);
    if (publishable) {
      suggestions.push(
        `该仓库发布到 npm 的包是 ${publishable.name}，请安装 npm:${publishable.name}（不会自动替换你的输入）。`,
      );
    } else if (manifestName && manifestName !== repo.repo) {
      suggestions.push(`真实包名可能是 ${manifestName}，请安装 npm:${manifestName}（不会自动替换你的输入）。`);
    } else {
      suggestions.push('请安装它发布到 npm 的包，而不是仓库源码。');
    }
  } else if (manifestName && manifestName !== repo.repo && hasPluginEntry(manifest)) {
    suggestions.push(`这个仓库的包名是 ${manifestName}，也可以用 npm:${manifestName} 安装（不会自动替换你的输入）。`);
  }
  return suggestions;
}

/** Parse + probe one spec; null when it is not a GitHub repo or is unreachable. */
export async function probeGithubRepo(spec, options = {}) {
  const repo = parseGithubRepo(spec);
  if (!repo) return null;
  const probe = await discoverRepoPackages(repo, options);
  if (!probe.manifest) return { ...probe, suggestions: [] };
  return { ...probe, suggestions: buildRepoSuggestions(probe) };
}
