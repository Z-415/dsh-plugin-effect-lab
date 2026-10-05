import { discoverRuntimes } from '../runtime-locator.js';

/**
 * `lab runtimes`: every official DSH launcher this machine can see, with its
 * version and whether the lab has been verified against it.
 */
export async function runRuntimesCommand(options = {}) {
  const runtimes = await discoverRuntimes({
    runtimePath: options.runtimePath,
    timeoutMs: options.runtimeTimeoutMs,
  });
  const report = { count: runtimes.length, runtimes };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`discovered runtimes: ${runtimes.length}\n`);
    for (const runtime of runtimes) {
      const flags = [runtime.status, runtime.isDefault ? 'default' : null].filter(Boolean).join(', ');
      process.stdout.write(`- ${runtime.version ?? 'unknown'} [${flags}]\n`);
      process.stdout.write(`    ${runtime.cmd}\n`);
      const detail = runtime.detail ?? runtime.error ?? '';
      if (detail) process.stdout.write(`    ${detail}\n`);
    }
    if (!runtimes.length) {
      process.stdout.write('(none found; set DSH_LAB_RUNTIMES to extra installs, semicolon-separated)\n');
    } else if (!runtimes.some((runtime) => runtime.supported)) {
      process.stdout.write('none of the discovered runtimes is inside the supported range\n');
    }
  }
  return runtimes.some((runtime) => runtime.supported) ? 0 : 1;
}
