import fs from 'node:fs';
import { hasFatal, scanLogs, summarize } from '../log-scanner.js';

export async function runScanCommand(options = {}) {
  const files = options.logs?.length ? options.logs : [];
  if (!files.length) {
    process.stderr.write('scan needs --log <file>\n');
    return 2;
  }
  const text = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const hits = scanLogs(text);
  const report = { files, fatal: hasFatal(hits), hits, summary: summarize(hits) };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`${summaryLine(report)}\n`);
    for (const hit of hits) process.stdout.write(`- [${hit.severity}] ${hit.id}: ${hit.matched}\n`);
  }
  return hasFatal(hits) ? 1 : 0;
}

function summaryLine(report) {
  return report.fatal ? 'scan: FATAL signatures found' : report.hits.length ? 'scan: warnings only' : 'scan: clean';
}
