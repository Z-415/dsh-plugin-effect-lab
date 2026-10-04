import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = crypto.randomBytes(3).toString('hex');
  return `${stamp}-${rand}`;
}

export function makeProfileName() {
  return `lab-${crypto.randomBytes(4).toString('hex')}`;
}

export function tail(text, max = 4000) {
  const value = String(text ?? '');
  return value.length <= max ? value : value.slice(value.length - max);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

export function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

export function nowIso() {
  return new Date().toISOString();
}
