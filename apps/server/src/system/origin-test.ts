import type { OriginTestResult } from '@tm/shared';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443, 'ssh:': 22, 'rdp:': 3389, 'smb:': 445 };

function probe(host: string, port: number, timeoutMs: number, tls: boolean): Promise<OriginTestResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    // Self-signed origins are common in homelabs; reachability is what matters here.
    const s = tls ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false }) : connect({ host, port });
    const done = (reachable: boolean, error: string | null) => {
      s.destroy();
      resolve({ reachable, latencyMs: reachable ? Date.now() - started : null, error });
    };
    s.setTimeout(timeoutMs, () => done(false, 'timeout'));
    s.once(tls ? 'secureConnect' : 'connect', () => done(true, null));
    s.once('error', (e) => done(false, e.message));
  });
}

/** Checks from this host whether the origin behind a route is listening (TCP, or TLS handshake for https). */
export async function testOrigin(service: string, timeoutMs = 3000): Promise<OriginTestResult> {
  if (/^(unix|unix\+tls):|^http_status:|^hello_world$/.test(service)) return { reachable: true, latencyMs: 0, error: null };
  let url: URL;
  try {
    url = new URL(service);
  } catch {
    return { reachable: false, latencyMs: null, error: 'invalid service URL' };
  }
  const port = Number(url.port) || DEFAULT_PORTS[url.protocol];
  if (!port) return { reachable: false, latencyMs: null, error: 'missing port' };
  return probe(url.hostname, port, timeoutMs, url.protocol === 'https:');
}
