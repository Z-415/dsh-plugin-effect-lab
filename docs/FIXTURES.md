# Fixtures

## Web session variants

The conversation data lives in committed specs under `fixtures/web-session/`:

| variant | file | shape |
|---|---|---|
| `default` | `fixed-session.json` | one turn with user, assistant, tool call, and tool result |
| `empty` | `empty-session.json` | a session with zero events |
| `long` | `long-session.json` | twelve turns, four of them with tool results |
| `rich` | `rich-session.json` | two turns: reasoning + fenced code block, then a tool call/result |

```powershell
node bin/lab.js verify --fixture-variant empty
node bin/lab.js verify --fixture-variant long
node bin/lab.js verify --fixture-variant rich
node bin/lab.js shell  --fixture-variant long
```

### Thinking and code (the `rich` variant)

0.2.0-rc.2 represents visible model thinking as a **`reasoning` content block**
inside `assistant/message`:

```text
content: [ { type: 'reasoning', text: '...' },
           { type: 'text', text: '...```js ...```' },
           { type: 'tool-call', ... } ]
stream:  [ { type: 'reasoning-chunks', time0, index, dt, texts },
           { type: 'text-chunks', ... } ]
```

There is **no** `assistant/thinking` event and **no** `thinking` block type in
this runtime: `ContentBlockMap` is `text | reasoning | image | file | tool-call |
tool-addition | tool-removal`, and `dsh-client-ui-chat` only renders a block
whose `type === 'reasoning'`. Writing `thinking` would render nothing, so the
unit test asserts the exact type and the integration test reads the block back
from the live session (`fixture.reasoningBlocks`, `fixture.codeFences`,
`fixture.contentBlockTypes`, `fixture.streamTypes`).

The `rich` variant also seeds a second turn with a tool call, so opening it in
the UI covers the thinking area, a fenced code block, and tool rendering at
once. The GUI's **思考 / 代码夹具** button runs the same variant.

> Known flake (deferred): under full-suite load the rich variant's renderer text
> probe can report `codeFound=false` even though the events are correct; running
> the file alone passes. See `docs/KNOWN-ISSUES.md` §1.

### Shell windows show the fixture by default

`lab shell` defaults to `--fixture-variant rich` (verify still defaults to
`default`). The shell runner also registers the fixture workspace through
`workspace/create` and the Electron window auto-opens the seeded session before
probing, so **every opened shell window shows the conversation, the thinking
block, and the fenced code block** without any clicking. The run records:

- `fixture-workspace`: the workspace id registered over RPC;
- `shell-fixture-session`: `workspace=true, session=true, mount=true`;
- `shell-fixture-thinking` / `shell-fixture-code`: the rendered text contains
  the seeded reasoning prefix and the code's first line;
- `report.shell.fixture`: the same probe object.

`--fixture-variant empty` still works: there is no session row, so the shell
skips the open step instead of waiting for one.

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
