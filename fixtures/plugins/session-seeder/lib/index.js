/**
 * Lab-only fixture seeder.
 *
 * It writes one fixed conversation through the official session-persistence
 * handle API (`create` -> `append` -> `flush` -> `close`), so the Web UI can
 * render a real conversation without any model call or real credential.
 */

export const name = 'dsh-lab-session-fixture';
export const inject = ['sessionPersistence'];

const SESSION_FORMAT_VERSION = 4;

function textBlock(text) {
  return { type: 'text', text };
}

export function buildFixtureEvents(startedAt) {
  const turn = 1;
  const step = 1;
  const callId = 'call-lab-fixture-1';
  const toolName = 'lab_fixture_echo';
  const toolArguments = '{"text":"ok"}';
  const assistantText = 'Fixed fixture reply: the lab rendered this without a model.';
  const time = (offset) => startedAt + offset;
  return [
    { type: 'turn/start', seq: 0, time: time(0), data: { turn } },
    { type: 'step/start', seq: 1, time: time(1), data: { turn, step } },
    {
      type: 'user/message',
      seq: 2,
      time: time(2),
      surfaceOp: 'append',
      data: {
        id: 'msg-lab-user-1',
        role: 'user',
        content: [textBlock('Lab fixed session')],
        source: { kind: 'user' },
      },
    },
    {
      type: 'assistant/message',
      seq: 3,
      time: time(3),
      surfaceOp: 'append',
      data: {
        turn,
        step,
        message: {
          id: 'msg-lab-assistant-1',
          role: 'assistant',
          content: [
            textBlock(assistantText),
            { type: 'tool-call', id: callId, name: toolName, arguments: toolArguments },
          ],
          source: { kind: 'model', provider: 'lab-fixture', model: 'fixed' },
        },
        stream: [
          { type: 'text-chunks', time0: 0, index: 0, dt: [1], texts: [assistantText] },
        ],
      },
    },
    {
      type: 'tool/call',
      seq: 4,
      time: time(4),
      data: { turn, step, callId, name: toolName, arguments: toolArguments },
    },
    {
      type: 'tool/result',
      seq: 5,
      time: time(5),
      surfaceOp: 'append',
      data: {
        turn,
        step,
        message: {
          id: 'msg-lab-tool-1',
          role: 'tool',
          content: [textBlock('lab fixture tool result: ok')],
          source: { kind: 'tool', callId },
          toolCallId: callId,
        },
      },
    },
    {
      type: 'session/title',
      seq: 6,
      time: time(6),
      data: { title: 'Lab fixed session', messageSeqs: [], source: { kind: 'user' } },
    },
    { type: 'step/end', seq: 7, time: time(7), data: { turn, step } },
    { type: 'turn/end', seq: 8, time: time(8), data: { turn, reason: { kind: 'completed' } } },
  ];
}

export async function apply(ctx) {
  if (process.env.DSH_LAB_FIXTURE_ENABLED !== '1') return;
  const sessionId = process.env.DSH_LAB_FIXTURE_SESSION_ID;
  const cwd = process.env.DSH_LAB_FIXTURE_CWD;
  if (!sessionId) return;
  const persistence = ctx.sessionPersistence;
  if (await persistence.stat(sessionId)) return;
  const startedAt = Date.now();
  const handle = await persistence.create({
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: startedAt,
    ...(cwd ? { cwd } : {}),
    isSeeded: false,
    delegationDepth: 0,
  });
  try {
    await handle.append(buildFixtureEvents(startedAt));
    await handle.flush();
  } finally {
    await handle.close();
  }
  ctx.logger?.info?.(`[dsh-lab] fixture session ${sessionId} written`);
}
