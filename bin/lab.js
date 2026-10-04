#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`dsh-plugin-effect-lab: ${error?.stack ?? String(error)}\n`);
    process.exitCode = 1;
  },
);
