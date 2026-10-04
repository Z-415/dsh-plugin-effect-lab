import http from 'node:http';

const DEFAULT_MODEL = 'lab-mock-model';

function json(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > 2_000_000) reject(new Error('mock request body too large'));
    });
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}

function toolNames(body) {
  return (body.tools ?? [])
    .map((tool) => tool?.function?.name ?? tool?.name)
    .filter((name) => typeof name === 'string');
}

/** Prefer a pure session-write tool, then a file-present tool, then a shell. */
export function chooseMockTool(names) {
  const available = new Set((names ?? []).map((name) => name.toLowerCase()));
  const preferences = [
    {
      names: ['todo_write'],
      name: 'todo_write',
      arguments: JSON.stringify({ todos: [{ content: 'Verify the loopback mock model', status: 'completed' }] }),
    },
    {
      names: ['present'],
      name: 'present',
      arguments: JSON.stringify({ files: [{ path: 'README.md', description: 'Lab fixture file' }] }),
    },
    {
      names: ['pwsh', 'persistent_pwsh'],
      name: 'pwsh',
      arguments: JSON.stringify({ command: 'Write-Output dsh-lab-mock-ok' }),
    },
    {
      names: ['bash', 'persistent_bash'],
      name: 'bash',
      arguments: JSON.stringify({ command: 'echo dsh-lab-mock-ok' }),
    },
  ];
  for (const preference of preferences) {
    const match = preference.names.find((name) => available.has(name));
    if (match) return { name: preference.name, arguments: preference.arguments };
  }
  return null;
}

function chunkBase(id, body) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? DEFAULT_MODEL,
  };
}

function writeChunk(res, value) {
  res.write(`data: ${JSON.stringify(value)}\n\n`);
}

function splitPieces(text, count = 3) {
  const value = String(text);
  const size = Math.max(1, Math.ceil(value.length / count));
  const pieces = [];
  for (let index = 0; index < value.length; index += size) pieces.push(value.slice(index, index + size));
  return pieces.length ? pieces : [''];
}

function scriptFor(body) {
  const messages = body.messages ?? [];
  const hasToolResult = messages.some((message) => message?.role === 'tool');
  const tool = hasToolResult ? null : chooseMockTool(toolNames(body));
  return {
    hasToolResult,
    tool,
    text: 'Loopback mock model completed the turn without a real provider.',
  };
}

async function streamCompletion(res, body, script, id) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const base = chunkBase(id, body);
  writeChunk(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
  if (script.tool) {
    writeChunk(res, {
      ...base,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: `call-lab-mock-${id}`,
            type: 'function',
            function: { name: script.tool.name, arguments: '' },
          }],
        },
        finish_reason: null,
      }],
    });
    for (const piece of splitPieces(script.tool.arguments)) {
      writeChunk(res, {
        ...base,
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] },
          finish_reason: null,
        }],
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    writeChunk(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    for (const piece of splitPieces(script.text)) {
      writeChunk(res, {
        ...base,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    writeChunk(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function completionValue(body, script, id) {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? DEFAULT_MODEL,
    choices: [{
      index: 0,
      finish_reason: script.tool ? 'tool_calls' : 'stop',
      message: script.tool
        ? {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: `call-lab-mock-${id}`,
            type: 'function',
            function: { name: script.tool.name, arguments: script.tool.arguments },
          }],
        }
        : { role: 'assistant', content: script.text },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

/** Start an OpenAI-compatible loopback provider used only by the lab. */
export async function startMockLlmServer(options = {}) {
  const evidence = [];
  const sockets = new Set();
  let sequence = 0;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true, requests: sequence });
        return;
      }
      if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
        json(res, 200, {
          object: 'list',
          data: [{ id: options.model ?? DEFAULT_MODEL, object: 'model', owned_by: 'dsh-lab' }],
        });
        return;
      }
      if (req.method === 'GET') {
        json(res, 404, { error: { message: `no mock route ${url.pathname}` } });
        return;
      }
      if (req.method !== 'POST' || !/\/(v1\/)?chat\/completions$/.test(url.pathname)) {
        json(res, 404, { error: { message: `no mock route ${req.method} ${url.pathname}` } });
        return;
      }
      const text = await readBody(req);
      const body = JSON.parse(text || '{}');
      sequence += 1;
      const id = `chatcmpl-lab-${sequence}`;
      const script = scriptFor(body);
      evidence.push({
        at: new Date().toISOString(),
        sequence,
        path: url.pathname,
        model: body.model ?? null,
        stream: body.stream !== false,
        messageCount: body.messages?.length ?? 0,
        toolNames: toolNames(body),
        hasToolResult: script.hasToolResult,
        scriptedTool: script.tool?.name ?? null,
        body: text.length <= 200_000 ? body : { truncated: true, messageCount: body.messages?.length ?? 0 },
      });
      if (body.stream === false) json(res, 200, completionValue(body, script, id));
      else await streamCompletion(res, body, script, id);
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: { message: String(error) } });
      else res.end();
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    server,
    port,
    origin: `http://127.0.0.1:${port}`,
    evidence,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
