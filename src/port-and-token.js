const WEB_URL_RE = /dsh web:\s*(http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+))/;

/** Parse the official readiness line from captured boot output. */
export function parseWebUrl(text) {
  const match = WEB_URL_RE.exec(String(text ?? ''));
  if (!match) return null;
  return {
    url: match[1],
    port: Number(match[2]),
    token: match[3],
    origin: `http://127.0.0.1:${match[2]}`,
  };
}

/** Mint the dsh-auth cookie by requesting the tokenized launch URL once. */
export async function mintAuthCookie(url, options = {}) {
  const { timeoutMs = 20_000 } = options;
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const raw = setCookies.find((value) => /^dsh-auth-/i.test(value)) ?? '';
  await response.text().catch(() => '');
  return {
    status: response.status,
    cookie: raw ? raw.split(';')[0] : '',
    setCookies,
  };
}

/** Minimal HTTP fetch that never follows redirects. */
export async function httpProbe(url, options = {}) {
  const { cookie, timeoutMs = 20_000, method = 'GET' } = options;
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text().catch(() => '');
    return {
      ok: true,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: body.slice(0, 20_000),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: String(error),
      durationMs: Date.now() - started,
    };
  }
}

export function classifyStatus(status) {
  if (status === 200 || status === 204) return 'ok';
  if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) return 'redirect';
  if (status === 401 || status === 403) return 'auth-fence';
  if (status === 404) return 'missing';
  if (status >= 500) return 'server-error';
  if (status === 0) return 'unreachable';
  return 'other';
}
