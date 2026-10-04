# Fixtures

## Web session variants

The conversation data lives in committed specs under `fixtures/web-session/`:

| variant | file | shape |
|---|---|---|
| `default` | `fixed-session.json` | one turn with user, assistant, tool call, and tool result |
| `empty` | `empty-session.json` | a session with zero events |
| `long` | `long-session.json` | twelve turns, four of them with tool results |

```powershell
node bin/lab.js verify --fixture-variant empty
node bin/lab.js verify --fixture-variant long
node bin/lab.js shell  --fixture-variant long
```

Each spec has its own `sessionId`, so variants never collide. A turn expands to
the official event sequence below; every message-producing event carries
`surfaceOp: "append"`, which the 0.2.0-rc.2 session format requires.

## Fixed session

`fixtures/plugins/session-seeder` is a lab-only plugin. When
`DSH_LAB_FIXTURE_ENABLED=1`, it writes one session through the official
session-persistence handle API:

```text
persistence.create(header)
  -> handle.append(events)
  -> handle.flush()
  -> handle.close()
```

The fixture contains a complete turn:

```text
turn/start
step/start
user/message            "Lab fixed session"
assistant/message       fixed text + advertised tool-call
tool/call
tool/result
session/title           "Lab fixed session"
step/end
turn/end                completed
```

The runner registers the generated workspace through `workspace/create`, opens
the sidebar workspace group, clicks the session row, and saves
`screenshots/fixture.png`. No model, API key, or real credential is used.

The seeder reads the chosen spec from `DSH_LAB_FIXTURE_FILE` (the runner sets
it from `--fixture-variant`); without that variable it falls back to an inline
copy of the default spec, so the plugin stays self-contained when installed on
its own. Pass `--no-fixture` to run without the seeder and without the fixture
screenshot.

## Effect probes

`fixtures/plugins/effect-probe` and `effect-probe-two` each ship a real client
half (`dsh.client.platform = "web"`, `exports["./client"]`). They set the same
CSS variable to different values and add different body attributes.

`fixtures/matrix/effect-conflict.json` demonstrates conflict detection:
two isolated runs touch `--lab-effect-probe-color`, so the matrix reports a
token conflict. `effect-ok.json` runs one probe alone and passes.
