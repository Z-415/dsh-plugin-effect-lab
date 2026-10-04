# Fixtures

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

Pass `--no-fixture` to run without the seeder and without the fixture
screenshot.

## Effect probes

`fixtures/plugins/effect-probe` and `effect-probe-two` each ship a real client
half (`dsh.client.platform = "web"`, `exports["./client"]`). They set the same
CSS variable to different values and add different body attributes.

`fixtures/matrix/effect-conflict.json` demonstrates conflict detection:
two isolated runs touch `--lab-effect-probe-color`, so the matrix reports a
token conflict. `effect-ok.json` runs one probe alone and passes.
