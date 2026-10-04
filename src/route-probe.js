import { classifyStatus, httpProbe } from './port-and-token.js';

export function defaultRoutes(origin) {
  return [
    { name: 'host-index-no-token', url: `${origin}/`, expect: ['auth-fence'] },
    { name: 'host-index-with-token', url: `${origin}/`, cookie: true, expect: ['ok', 'redirect'] },
  ];
}

export async function probeRoutes(options) {
  const {
    origin,
    cookie,
    routes = [],
    timeoutMs = 15_000,
  } = options;
  const list = [...defaultRoutes(origin), ...routes];
  const results = [];
  for (const route of list) {
    const url = route.url.startsWith('http') ? route.url : `${origin}${route.url}`;
    const useCookie = route.cookie === true || route.withCookie === true;
    const probe = await httpProbe(url, {
      cookie: useCookie ? cookie : undefined,
      timeoutMs,
    });
    const classification = classifyStatus(probe.status);
    const expected = route.expect ?? ['ok'];
    results.push({
      name: route.name ?? url,
      url,
      status: probe.status,
      classification,
      expected,
      pass: probe.ok && expected.includes(classification),
      durationMs: probe.durationMs,
      error: probe.error ?? null,
    });
  }
  return results;
}
