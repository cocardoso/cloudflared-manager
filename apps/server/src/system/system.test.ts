import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { compareVersions, latestCloudflaredVersion } from './cloudflared-info';
import { testOrigin } from './origin-test';

describe('compareVersions', () => {
  it('orders calendar versions', () => {
    expect(compareVersions('2026.9.1', '2026.10.0')).toBeLessThan(0);
    expect(compareVersions('2026.9.1', '2026.9.1')).toBe(0);
  });
});

describe('latestCloudflaredVersion', () => {
  it('reads tag_name', async () => {
    const f = (async () => new Response(JSON.stringify({ tag_name: '2026.9.1' }))) as unknown as typeof fetch;
    expect(await latestCloudflaredVersion(f)).toBe('2026.9.1');
  });
  it('returns null on failure', async () => {
    const f = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await latestCloudflaredVersion(f)).toBeNull();
  });
});

describe('testOrigin', () => {
  it('reaches a TCP listener and reports closed port', async () => {
    const srv = createServer(() => undefined).listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as { port: number }).port;
    expect((await testOrigin(`tcp://127.0.0.1:${port}`)).reachable).toBe(true);
    expect((await testOrigin(`http://127.0.0.1:${port}`)).reachable).toBe(true);
    srv.close();
    const closed = await testOrigin('tcp://127.0.0.1:1', 500);
    expect(closed.reachable).toBe(false);
    expect(closed.error).toBeTruthy();
  });
  it('short-circuits non-network services', async () => {
    expect(await testOrigin('http_status:404')).toEqual({ reachable: true, latencyMs: 0, error: null });
  });
});
