/**
 * Boot readiness verdict.
 *
 * A published `dsh web: <url>` line only proves the host printed a URL; it does
 * not prove the port ever accepted a connection. The runner must fail fast on
 * `listening === false` instead of cascading into `fetch failed`, 0-status
 * routes and an empty DOM.
 */

export function bootReadiness(boot) {
  const rawPort = boot?.port;
  const port = Number(rawPort);
  const urlPass = Number.isFinite(port) && port > 0;
  const listeningPass = boot?.listening === true;
  return {
    port,
    urlPass,
    urlDetail: `port ${rawPort}`,
    listeningPass,
    listeningDetail: listeningPass
      ? `port ${port} is accepting connections`
      : `port ${port} was published in the ready URL but never accepted a connection`,
  };
}

/** Throw when the published port never became connectable. */
export function assertBootListening(boot) {
  const readiness = bootReadiness(boot);
  if (!readiness.listeningPass) {
    throw new Error(`boot-listening: ${readiness.listeningDetail}`);
  }
  return readiness;
}
