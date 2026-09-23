import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

afterEach(() => vi.restoreAllMocks());

describe('api client', () => {
  it('parses JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect(await api.get('/health')).toEqual({ ok: true });
  });
  it('returns undefined on 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api.post('/auth/logout')).toBeUndefined();
  });
  it('throws ApiError with code and fires unauthorized event', async () => {
    const spy = vi.fn();
    window.addEventListener('tm:unauthorized', spy);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'x' }), { status: 401 }));
    const e = (await api.get('/tunnels').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('UNAUTHORIZED');
    expect(spy).toHaveBeenCalled();
  });
  it('falls back to INTERNAL for non-JSON errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await api.get('/x').catch((e) => e.code)).toBe('INTERNAL');
  });
});
