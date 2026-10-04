import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMockTool, startMockLlmServer } from '../../src/mock-llm-server.js';

function sseContent(raw) {
  return String(raw)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map((line) => JSON.parse(line.slice(6)))
    .map((value) => value.choices?.[0]?.delta?.content ?? '')
    .join('');
}

test('chooseMockTool prefers the pure session-write tool', () => {
  assert.deepEqual(chooseMockTool(['present', 'todo_write', 'pwsh']).name, 'todo_write');
  assert.deepEqual(chooseMockTool(['present', 'pwsh']).name, 'present');
  assert.deepEqual(chooseMockTool(['pwsh']).name, 'pwsh');
  assert.equal(chooseMockTool(['unknown_tool']), null);
});

test('mock server streams a tool call, then a final message after the tool result', async () => {
  const mock = await startMockLlmServer({ model: 'lab-mock-model' });
  try {
    const tools = [{ type: 'function', function: { name: 'todo_write', parameters: {} } }];
    const first = await fetch(`${mock.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'lab-mock-model', stream: true, tools, messages: [{ role: 'user', content: 'go' }] }),
    });
    const firstText = await first.text();
    assert.match(firstText, /todo_write/);
    assert.match(firstText, /\[DONE\]/);

    const second = await fetch(`${mock.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'lab-mock-model',
        stream: true,
        tools,
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: null },
          { role: 'tool', tool_call_id: 'call-lab-mock-1', content: 'ok' },
        ],
      }),
    });
    const secondText = await second.text();
    assert.match(sseContent(secondText), /without a real provider/);
    assert.equal(mock.evidence.length, 2);
    assert.equal(mock.evidence[0].scriptedTool, 'todo_write');
    assert.equal(mock.evidence[1].hasToolResult, true);
  } finally {
    await mock.close();
  }
});
