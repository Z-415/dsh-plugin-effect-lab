import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseNpmSpec } from './semver.js';

function readCString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8').trim();
}

/** Extract package.json from a .tgz plugin without third-party tar deps. */
export function readTarballManifest(file) {
  const compressed = fs.readFileSync(file);
  const raw = compressed[0] === 0x1f && compressed[1] === 0x8b
    ? zlib.gunzipSync(compressed)
    : compressed;
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if ([...header].every((byte) => byte === 0)) break;
    const name = readCString(header, 0, 100);
    const sizeField = readCString(header, 124, 12);
    const size = Number.parseInt(sizeField, 8) || 0;
    const typeflag = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    if ((typeflag === '0' || typeflag === '\0') && (name === 'package/package.json' || name.endsWith('/package.json'))) {
      return JSON.parse(raw.subarray(dataStart, dataStart + size).toString('utf8'));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`package.json not found inside ${file}`);
}

export function classifySpec(spec) {
  const text = String(spec ?? '').trim();
  if (text.startsWith('github:') || /^https?:\/\/github\.com\//.test(text)) return 'github';
  if (text.startsWith('.') || path.isAbsolute(text) || fs.existsSync(text)) {
    const resolved = path.resolve(text);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return 'directory';
    if (/\.(tgz|tar\.gz)$/i.test(resolved)) return 'tarball';
    return 'path';
  }
  if (/\.(tgz|tar\.gz)$/i.test(text)) return 'tarball';
  return 'npm';
}

export function resolvePlugin(spec) {
  const kind = classifySpec(spec);
  if (kind === 'directory') {
    const dir = path.resolve(spec);
    const manifestPath = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`local plugin has no package.json: ${dir}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { kind, spec, installSpec: dir, dir, manifest, name: manifest.name, version: manifest.version };
  }
  if (kind === 'tarball') {
    const file = path.resolve(spec);
    if (!fs.existsSync(file)) throw new Error(`tarball not found: ${file}`);
    const manifest = readTarballManifest(file);
    return { kind, spec, installSpec: file, file, manifest, name: manifest.name, version: manifest.version };
  }
  if (kind === 'npm') {
    const parsed = parseNpmSpec(spec);
    if (!parsed) throw new Error(`cannot parse npm spec: ${spec}`);
    return { kind, spec, installSpec: spec, name: parsed.name, version: parsed.version, manifest: null };
  }
  if (kind === 'github') {
    return { kind, spec, installSpec: spec, manifest: null };
  }
  throw new Error(`unsupported plugin source: ${spec}`);
}

export function installedPackageDir(profileDir, name) {
  return path.join(profileDir, 'node_modules', ...String(name).split('/'));
}

export function readInstalledManifest(profileDir, name) {
  const dir = installedPackageDir(profileDir, name);
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return null;
  return { dir, manifest: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
