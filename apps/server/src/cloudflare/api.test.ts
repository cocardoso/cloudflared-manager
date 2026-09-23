import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_ACCOUNT, startFakeCloudflare, type FakeCf } from '../../test/fake-cloudflare';
import { AppError } from '../errors';
import { CfApi } from './api';
import { CfClient } from './client';

let cf: FakeCf;
let api: CfApi;
let client: CfClient;
beforeEach(async () => {
  cf = await startFakeCloudflare();
  client = new CfClient({ token: cf.token, baseUrl: cf.baseUrl });
  api = new CfApi(client, FAKE_ACCOUNT.id);
});
afterEach(() => cf.close());

describe('CfApi', () => {
  it('verifies token and lists accounts and zones', async () => {
    expect((await CfApi.verifyToken(client)).status).toBe('active');
    expect(await CfApi.listAccounts(client)).toEqual([FAKE_ACCOUNT]);
    expect((await api.listZones()).map((z) => z.name)).toEqual(['example.com', 'other.dev']);
  });
  it('creates a remotely-managed tunnel and fetches its token and config', async () => {
    const t = await api.createTunnel('home');
    expect(t.config_src).toBe('cloudflare');
    expect(await api.getTunnelToken(t.id)).toBe(`tok-${t.id}`);
    expect(await api.getConfig(t.id)).toEqual({ version: 0, config: { ingress: [{ service: 'http_status:404' }] } });
    expect((await api.putConfig(t.id, { ingress: [{ service: 'http_status:404' }] })).version).toBe(1);
  });
  it('maps bad token to CF_TOKEN_INVALID', async () => {
    const bad = new CfClient({ token: 'nope-nope-nope-nope-nope', baseUrl: cf.baseUrl });
    await expect(CfApi.verifyToken(bad)).rejects.toMatchObject({ code: 'CF_TOKEN_INVALID', status: 401 });
  });
  it('maps 403 to CF_PERMISSION_MISSING', async () => {
    cf.state.failNext(/dns_records/, 403, [{ code: 10000, message: 'Authentication error' }]);
    await expect(api.findDnsRecords(cf.state.zones[0]!.id, 'a.example.com')).rejects.toMatchObject({ code: 'CF_PERMISSION_MISSING' });
  });
  it('maps 429 to CF_RATE_LIMITED', async () => {
    cf.state.failNext(/zones/, 429);
    await expect(api.listZones()).rejects.toMatchObject({ code: 'CF_RATE_LIMITED' });
  });
  it('maps missing tunnel to TUNNEL_NOT_FOUND', async () => {
    await expect(api.getTunnel('6ff42ae2-765d-4adf-8112-31c55c1551ef')).rejects.toMatchObject({ code: 'TUNNEL_NOT_FOUND', status: 404 });
  });
  it('maps network failure to CF_UNREACHABLE', async () => {
    const dead = new CfClient({ token: cf.token, baseUrl: 'http://127.0.0.1:1' });
    const err = await CfApi.verifyToken(dead).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('CF_UNREACHABLE');
  });
  it('follows pagination', async () => {
    const pages = [[{ id: '1', name: 'a.com', status: 'active' }], [{ id: '2', name: 'b.com', status: 'active' }]];
    const f = (async (url: string) => {
      const p = Number(new URL(url).searchParams.get('page'));
      return new Response(JSON.stringify({ success: true, errors: [], result: pages[p - 1], result_info: { page: p, per_page: 1, total_pages: 2, count: 1 } }));
    }) as unknown as typeof fetch;
    const paged = new CfApi(new CfClient({ token: 't', baseUrl: 'http://x', fetch: f }), 'acc');
    expect((await paged.listZones()).map((z) => z.name)).toEqual(['a.com', 'b.com']);
  });
  it('maps a missing DNS record to DNS_RECORD_NOT_FOUND', async () => {
    await expect(api.deleteDnsRecord(cf.state.zones[0]!.id, 'nope')).rejects.toMatchObject({ code: 'DNS_RECORD_NOT_FOUND', status: 404 });
  });
  it('stops paginating when result_info has no total_pages (cfd_tunnel list)', async () => {
    const all = Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: `t${i}` }));
    let calls = 0;
    const f = (async (url: string) => {
      if (++calls > 10) throw new Error('runaway pagination');
      const u = new URL(url);
      const page = Number(u.searchParams.get('page'));
      const per = Number(u.searchParams.get('per_page'));
      const result = all.slice((page - 1) * per, page * per);
      return new Response(JSON.stringify({ success: true, errors: [], result, result_info: { page, per_page: per, count: result.length, total_count: all.length } }));
    }) as unknown as typeof fetch;
    const c = new CfClient({ token: 't', baseUrl: 'http://x', fetch: f });
    expect((await c.paginate<{ id: string }>('/things?per_page=2')).map((x) => x.id)).toEqual(['0', '1', '2']);
    expect(calls).toBe(2);
  });
  it('stops on an empty page even without any totals', async () => {
    let calls = 0;
    const f = (async (url: string) => {
      if (++calls > 10) throw new Error('runaway pagination');
      const page = Number(new URL(url).searchParams.get('page'));
      const result = page === 1 ? [{ id: 'a' }] : [];
      return new Response(JSON.stringify({ success: true, errors: [], result, result_info: { page, per_page: 50 } }));
    }) as unknown as typeof fetch;
    const c = new CfClient({ token: 't', baseUrl: 'http://x', fetch: f });
    expect(await c.paginate('/things')).toEqual([{ id: 'a' }]);
    expect(calls).toBeLessThanOrEqual(2);
  });
  it('creates, finds and deletes CNAME', async () => {
    const z = cf.state.zones[0]!.id;
    const rec = await api.createCname(z, 'app.example.com', 'x.cfargotunnel.com');
    expect(rec.proxied).toBe(true);
    expect((await api.findDnsRecords(z, 'app.example.com'))[0]!.content).toBe('x.cfargotunnel.com');
    await api.deleteDnsRecord(z, rec.id);
    expect(await api.findDnsRecords(z, 'app.example.com')).toEqual([]);
  });
});
