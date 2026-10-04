#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RUNTIME_CMD } from '../src/config.js';

/**
 * CI entry point.
 *
 * Unit tests always run. Integration tests need the official DeepSeek Harness
 * install, headless Edge, and permission to force-kill child processes, so
 * they only run when the runtime is actually present. CI runners without the
 * desktop install still get a green unit run plus an explicit skip message.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env,
    shell: isWindows,
  });
  return result.status ?? 1;
}

const unit = run('npm', ['test']);
if (unit !== 0) process.exit(unit);

const runtime = process.env.DSH_LAB_DSH_CMD || DEFAULT_RUNTIME_CMD;
if (!fs.existsSync(runtime)) {
  console.log(`[ci] unit tests passed; skipping integration tests (runtime not found at ${runtime})`);
  process.exit(0);
}

const doctor = run('node', ['bin/lab.js', 'doctor']);
if (doctor !== 0) process.exit(doctor);

console.log('[ci] running integration tests (DSH_LAB_E2E=1)');
const e2e = run('npm', ['run', 'test:e2e'], { ...process.env, DSH_LAB_E2E: '1' });
process.exit(e2e);
