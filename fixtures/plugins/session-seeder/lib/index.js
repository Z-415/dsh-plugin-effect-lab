/**
 * Lab-only fixture seeder.
 *
 * It writes one fixed conversation through the official session-persistence
 * handle API (`create` -> `append` -> `flush` -> `close`), so the Web UI can
 * render a real conversation without any model call or real credential.
 *
 * The event sequence is derived from a JSON spec so the fixture data is a
 * committed artifact (`fixtures/web-session/*.json`) instead of hardcoded
 * here. `DSH_LAB_FIXTURE_FILE` points at the chosen variant; without it the
 * inline default keeps the plugin self-contained.
 */

import fs from 'node:fs';

export const name = 'dsh-lab-session-fixture';
export const inject = ['sessionPersistence'];

const DEFAULT_SPEC = {
  name: 'fixed',
  sessionId: 'session-00000000-0000-4000-8000-000000000001',
  title: 'Lab fixed session',
  formatVersion: 4,
  turns: [
    {
      user: 'Lab fixed session',
      assistant: 'Fixed fixture reply: the lab rendered this without a model.',
      tool: { name: 'lab_fixture_echo', arguments: '{"text":"ok"}', result: 'lab fixture tool result: ok' },
    },
  ],
};

function textBlock(text) {
  return { type: 'text', text };
}

/**
 * 0.2.0-rc.2 represents visible model thinking as a `reasoning` content block
 * inside `assistant/message` (ReasoningBlock: `{ type: 'reasoning', text }`),
 * not as a separate `assistant/thinking` event and not with a `thinking` type.
 * The matching stream record is `reasoning-chunks` with the same shape as
 * `text-chunks` (time0/index/dt/texts).
 */
function reasoningBlock(text) {
  return { type: 'reasoning', text };
}

function assistantTextWithCode(turn) {
  const base = turn.assistant ?? 'Reply';
  if (!turn.code) return base;
  const code = typeof turn.code === 'string' ? { text: turn.code } : turn.code;
  const language = code.language ?? 'js';
  const body = code.text ?? '';
  return `${base}\n\n\`\`\`${language}\n${body}\n\`\`\``;
}

/** Expand a fixture spec into the official session event sequence. */
export function buildEventsFromSpec(spec, startedAt = Date.now()) {
  const events = [];
  let seq = 0;
  const turns = spec?.turns ?? [];
  const push = (type, data, extra = {}) => {
    events.push({ type, seq, time: startedAt + seq, data, ...extra });
    seq += 1;
  };
  turns.forEach((turn, index) => {
    const turnNumber = index + 1;
    const step = 1;
    const callId = `call-lab-fixture-${turnNumber}`;
    const assistantText = assistantTextWithCode({ assistant: turn.assistant ?? `Reply ${turnNumber}`, code: turn.code });
    const stream = [
      ...(turn.reasoning ? [{ type: 'reasoning-chunks', time0: 0, index: 0, dt: [1], texts: [turn.reasoning] }] : []),
      { type: 'text-chunks', time0: 0, index: turn.reasoning ? 1 : 0, dt: [1], texts: [assistantText] },
    ];
    push('turn/start', { turn: turnNumber });
    push('step/start', { turn: turnNumber, step });
    push(
      'user/message',
      {
        id: `msg-lab-user-${turnNumber}`,
        role: 'user',
        content: [textBlock(turn.user ?? `Turn ${turnNumber}`)],
        source: { kind: 'user' },
      },
      { surfaceOp: 'append' },
    );
    push(
      'assistant/message',
      {
        turn: turnNumber,
        step,
        message: {
          id: `msg-lab-assistant-${turnNumber}`,
          role: 'assistant',
          content: [
            ...(turn.reasoning ? [reasoningBlock(turn.reasoning)] : []),
            textBlock(assistantText),
            ...(turn.tool ? [{ type: 'tool-call', id: callId, name: turn.tool.name, arguments: turn.tool.arguments }] : []),
          ],
          source: { kind: 'model', provider: 'lab-fixture', model: 'fixed' },
        },
        stream,
      },
      { surfaceOp: 'append' },
    );
    if (turn.tool) {
      push('tool/call', { turn: turnNumber, step, callId, name: turn.tool.name, arguments: turn.tool.arguments });
      push(
        'tool/result',
        {
          turn: turnNumber,
          step,
          message: {
            id: `msg-lab-tool-${turnNumber}`,
            role: 'tool',
            content: [textBlock(turn.tool.result ?? 'tool result')],
            source: { kind: 'tool', callId },
            toolCallId: callId,
          },
        },
        { surfaceOp: 'append' },
      );
    }
    if (turnNumber === 1) {
      push('session/title', { title: spec?.title ?? 'Lab fixed session', messageSeqs: [], source: { kind: 'user' } });
    }
    push('step/end', { turn: turnNumber, step });
    push('turn/end', { turn: turnNumber, reason: { kind: 'completed' } });
  });
  return events;
}

/** Backwards-compatible default used by the unit tests. */
export function buildFixtureEvents(startedAt) {
  return buildEventsFromSpec(DEFAULT_SPEC, startedAt);
}

function loadSpec() {
  const file = process.env.DSH_LAB_FIXTURE_FILE;
  if (!file) return DEFAULT_SPEC;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export async function apply(ctx) {
  if (process.env.DSH_LAB_FIXTURE_ENABLED !== '1') return;
  const sessionId = process.env.DSH_LAB_FIXTURE_SESSION_ID;
  const cwd = process.env.DSH_LAB_FIXTURE_CWD;
  if (!sessionId) return;
  const persistence = ctx.sessionPersistence;
  if (await persistence.stat(sessionId)) return;
  const spec = loadSpec();
  const startedAt = Date.now();
  const handle = await persistence.create({
    version: spec.formatVersion ?? 4,
    id: sessionId,
    createdAt: startedAt,
    ...(cwd ? { cwd } : {}),
    isSeeded: false,
    delegationDepth: 0,
  });
  try {
    await handle.append(buildEventsFromSpec(spec, startedAt));
    await handle.flush();
  } finally {
    await handle.close();
  }
  ctx.logger?.info?.(`[dsh-lab] fixture session ${sessionId} written (${spec.name ?? 'custom'})`);
}
