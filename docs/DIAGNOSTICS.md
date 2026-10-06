# Diagnostics and error codes

Every failure signature carries a stable code (`LAB-BOOT-002`, `LAB-PLUGIN-004`,
...). The lab produces the evidence; the user's DSH agent explains it.

```powershell
# write a redacted bundle next to the run
node bin/lab.js verify --diagnostics-bundle out/diagnostics.json

# turn a saved report / bundle / log into structured diagnostics
node bin/lab.js diagnose --report artifacts/<run>/report.json
node bin/lab.js diagnose --bundle out/diagnostics.json
node bin/lab.js diagnose --log artifacts/<run>/boot.err.log
node bin/lab.js diagnose --latest
```

`--diagnostics-bundle` is supported by `lab verify` / `lab capture`. `lab shell`
keeps its own runner and rejects the flag.

## Where the codes live

- `src/log-scanner.js` assigns one `code` per signature; the id stays for
  backwards compatibility.
- `report.json` `signatureHits[]` / `consoleSignatureHits[]` carry `code`.
- `report.errorCode` / `report.diagnostics` summarize the run.
- `lab scan --list` and `lab scan --explain` print the code.
- `lab diagnose --json` and the bridge's `lab_diagnose` tool return the same
  codes.

`LAB-UNKNOWN` means a failed run matched no known signature; the bundle still
carries the failed checks and a bounded boot tail. A clean run reports
`LAB-OK` and an empty `errorCodes` list.

## Install-stage codes

An install failure happens before the host boots, so it never shows up in
`signatureHits`. The `plugin-install` stage classifies the captured pnpm output
instead:

| code | trigger |
|---|---|
| `LAB-INSTALL-NOTFOUND` | `ERR_PNPM_FETCH_404` / "is not in the npm registry" |
| `LAB-INSTALL-NETWORK` | `ECONNRESET` / `ETIMEDOUT` / a codeload retry loop / install timeout |
| `LAB-INSTALL-UNKNOWN` | a non-zero install with no recognizable pnpm line |

`report.installFailure` and `diagnostics.install` carry the code, the extracted
key lines, the timeout flag, and any suggestion. The `plugin-install` check
detail starts with `exit <code>` and the elapsed time, then repeats the real
pnpm line (`[ERR_PNPM_FETCH_404] GET ...`), so the GUI banner and the report no
longer stop at `exit 1`.

When an online install of a GitHub-looking spec fails, the lab best-effort
pre-checks the repo root `package.json` (jsDelivr first, raw GitHub as a
fallback). For a monorepo it reads the workspace manifests and suggests the
package the repo publishes to npm (for `mini-yifan/dsh-orb-cordis`:
`npm:dsh-orb`). It never replaces the user's input, and a probe failure is
swallowed so the original install error is still reported.

The full table is in [FAILURE-SIGNATURES.md](FAILURE-SIGNATURES.md).

## What the bundle contains

`--diagnostics-bundle <file>` writes:

```text
{
  schema: "dsh-plugin-effect-lab/diagnostics@1/bundle",
  generatedAt,
  diagnostics: {
    runId, ok, mode, runtime,
    primaryCode, errorCodes, unknown,
    signatures: [{ code, id, category, severity, matched, rootCause, fix }],
    failedChecks, checks,
    plugins: [{ advertisedSpec, resolvedSpec, source }],
    clone: { kind, plugins, excluded, droppedLocal, localPlugins, install },
    failureContext, bootTail,
    evidence: { reportJson, reportHtml, bootOut, bootErr, cloneInstallLog, diagnosticsBundle },
    exclusions: { credentials: false, sessions: false, settings: false, note }
  }
}
```

It is **redacted**: launch tokens, API keys, bearer tokens, cookies, and the
absolute home/temp paths are masked before writing. It is derived from
`report.json` only; the bundle never reads or contains credentials, sessions, or
settings. The large raw logs stay in the run directory and are referenced by
path, not embedded.

## The bridge `lab_diagnose` tool

The bridge plugin registers `lab_diagnose` next to `lab_verify_plugin`. It
spawns `node <lab>/bin/lab.js diagnose ... --json` (still a fixed lab entry; the
bridge never imports the lab) and returns the compact structured payload:
`primaryCode`, `errorCodes`, `signatures`, `failedChecks`, and a bounded
`bootTail`.

Parameters (choose one source; nothing means `--latest`):

| parameter | meaning |
|---|---|
| `report` | path to a `report.json` |
| `bundle` | path to a `--diagnostics-bundle` file |
| `log` | path to a `boot.out.log` / `boot.err.log` |
| `latest` | read the newest `artifacts/<run>/report.json` |

The tool deliberately does not dump the whole log into the model context: the
lab has already turned it into codes, failed checks, and a short tail.
