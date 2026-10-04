# Loopback Mock Model

`--mock-model` starts a local OpenAI-compatible server on `127.0.0.1` with an
ephemeral port and writes a lab-only `llm-pi-ai` provider route into the
isolated profile:

```yaml
- id: llm-pi-ai
  config:
    providers:
      lab-mock:
        displayName: Lab Mock
        api: openai-completions
        baseURL: http://127.0.0.1:<port>/v1
        apiKeyEnv: DSH_LAB_MOCK_KEY
        models:
          - id: lab-mock-model
            name: Lab Mock Model
```

The synthetic key is `lab-mock-key`; no real credential is read. The server
implements `/v1/models`, `/health`, and streaming/non-streaming
`/v1/chat/completions`.

The turn is scripted:

1. first request: stream a `todo_write` tool call (falls back to `present`, then
   `pwsh`/`bash` only if those tools are absent);
2. the host executes the tool and records `tool/call`, `todo/write`,
   `tool/result`;
3. the follow-up request after the tool result streams a final assistant
   message;
4. the run waits for `turn/end`.

`mock-llm.json` preserves every request summary and scripted response, so the
tool path is machine-decidable without viewing the UI.
