import crypto from 'node:crypto';

function rpcId() {
  return `lab-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

/** Minimal DSH Web RPC over HTTP with the browser-auth cookie. */
export async function rpc(origin, cookie, endpoint, args, options = {}) {
  const { timeoutMs = 20_000 } = options;
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: rpcId(),
    method: endpoint,
    payload: { args },
  });
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`RPC ${endpoint} returned non-JSON (status ${response.status}): ${text.slice(0, 300)}`);
  }
  if (parsed.result?.ok) return parsed.result.value;
  throw new Error(parsed.result?.error?.message ?? `RPC ${endpoint} failed (status ${response.status})`);
}

export async function listSessions(origin, cookie) {
  const value = await rpc(origin, cookie, 'session/list', { _request: {} });
  return value?.items ?? value ?? [];
}

export async function modelCatalog(origin, cookie) {
  return rpc(origin, cookie, 'session/modelCatalog', {});
}

export async function createSession(origin, cookie, request = {}) {
  return rpc(origin, cookie, 'session/create', { request });
}

export async function selectModel(origin, cookie, request) {
  return rpc(origin, cookie, 'session/selectModel', { request });
}

export async function promptSession(origin, cookie, request) {
  return rpc(origin, cookie, 'session/prompt', { request });
}

async function discoverCursor(origin, cookie, sessionId) {
  try {
    await rpc(origin, cookie, 'session/page', {
      request: { address: { kind: 'session', sessionId }, throughSeq: Number.MAX_SAFE_INTEGER, maxMessages: 1 },
    });
    return -1;
  } catch (error) {
    const match = /past cursor (\d+)/.exec(String(error.message));
    if (match) return Number(match[1]);
    throw error;
  }
}

export async function sessionPage(origin, cookie, sessionId, options = {}) {
  const { maxMessages = 500 } = options;
  const cursor = await discoverCursor(origin, cookie, sessionId);
  if (cursor < 0) return { records: [], events: [], hasMore: false };
  const value = await rpc(origin, cookie, 'session/page', {
    request: { address: { kind: 'session', sessionId }, throughSeq: cursor, maxMessages },
  });
  const records = value?.records ?? [];
  return {
    records,
    events: records.map((record) => record.event ?? record),
    hasMore: Boolean(value?.hasMore),
  };
}
