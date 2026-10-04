# Safety

## Hard guarantees

- `DSH_HOME` must resolve to a `dsh-lab-*` directory under the OS temp root.
- The lab refuses the real `~/.dsh` and the `desktop` profile.
- Credentials, sessions, and settings are never copied or read by default.
- Plugin installs happen only inside the isolated profile.
- Every spawned process is tracked; stop uses `taskkill /PID <pid> /T /F` on
  Windows as the forced fallback, then verifies the port is free.
- The temp home is deleted in `finally`, and deletion is verified.
- Real structural profile files are hashed before and after the run:
  `profiles/{web,desktop}/{package.json,cordis.yml,cordis.patch.yml,pnpm-workspace.yaml,pnpm-lock.yaml}`.
- `--mock-model` binds only to `127.0.0.1`, uses a synthetic API key, and makes
  no outbound model request.
- `lab shell` runs the copied official Electron runtime with its own
  `userData`. Its `dsh-lab:boot` IPC bridge rejects any frame that is not
  `dsh-app://app/`, and the WebSocket header fence only rewrites
  `ws://127.0.0.1/<isolated-host>` handshakes whose `Origin` is `dsh-app://app`,
  injecting that temp host's launch cookie. Nothing is read from the real
  `~/.dsh` and the official `app.asar` is only read.

## Not guarantees

This is not a security sandbox. A malicious plugin can still execute code with
the current user's privileges. Review plugin lifecycle scripts before
installation and keep `--online` explicit.

## Opt-in sharing

There is no credential-copy flag in Phase 1. If real-model testing is added
later, it must be a separate explicit switch with a printed warning.
