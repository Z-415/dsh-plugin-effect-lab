'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * App files the built GUI serves. `lab gui` copies these from `src/gui` into
 * the runtime, and the launcher re-checks them at startup so an existing
 * Desktop shortcut reflects the current source without a manual rebuild.
 */
const APP_FILES = ['index.html', 'main.js', 'preload.js', 'app-sync.cjs', 'menu.cjs'];

/**
 * Copy changed app files from `sourceDir` into the built `appDir`.
 *
 * Returns the names that were refreshed. Missing sources are skipped and a
 * failed copy is reported through `log` instead of throwing: a stale file is
 * worse than a missing one, but neither may stop the launcher from starting.
 */
function syncAppFiles(options = {}) {
  const { sourceDir, appDir, files = APP_FILES, log = () => {} } = options;
  const updated = [];
  if (!sourceDir || !appDir) return updated;
  if (!fs.existsSync(sourceDir) || !fs.existsSync(appDir)) return updated;
  for (const name of files) {
    const source = path.join(sourceDir, name);
    const target = path.join(appDir, name);
    if (!fs.existsSync(source)) continue;
    try {
      if (fs.existsSync(target) && fs.readFileSync(source).equals(fs.readFileSync(target))) continue;
      fs.copyFileSync(source, target);
      updated.push(name);
      log(`[gui] refreshed ${name} from ${source}\n`);
    } catch (error) {
      log(`[gui] could not refresh ${name}: ${error.message}\n`);
    }
  }
  return updated;
}

module.exports = { APP_FILES, syncAppFiles };
