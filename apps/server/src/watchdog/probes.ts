import { connect } from 'node:net';

/** cloudflared's metrics server answers /ready with 200 once at least one edge connection is up. */
export async function probeReady(port: number, timeoutMs = 3000) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(timeoutMs) })).status === 200;
  } catch {
    return false;
  }
}

export function probeInternet(host = 'api.cloudflare.com', port = 443, timeoutMs = 3000) {
  return new Promise<boolean>((resolve) => {
    const s = connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}
