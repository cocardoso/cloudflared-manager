import Fastify, { type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { CfDnsRecord, CfTunnel, CfTunnelConfig } from '../src/cloudflare/types';

export const FAKE_TOKEN = 'fake-token-0123456789abcdefghij';
export const FAKE_ACCOUNT = { id: 'a'.repeat(32), name: 'Home Lab' };
export const SECOND_ACCOUNT = { id: 'b'.repeat(32), name: 'Second Org' };
export const SECOND_ZONE = { id: `${'y'.repeat(31)}3`, name: 'second.net', status: 'active', account: SECOND_ACCOUNT };

type CfErr = { code: number; message: string };
interface TunnelEntry { accountId: string; tunnel: CfTunnel; config: CfTunnelConfig; version: number; token: string }
export interface FakeState {
  accounts: { id: string; name: string }[];
  zones: { id: string; name: string; status: string; account: { id: string; name: string } }[];
  tunnels: Map<string, TunnelEntry>;
  dns: Map<string, CfDnsRecord[]>;
  failures: { re: RegExp; method?: string; status: number; errors: CfErr[] }[];
  /** "METHOD /path" of every authenticated request, in order. */
  requests: string[];
  failNext(re: RegExp, status: number, errors?: CfErr[], method?: string): void;
  /** Adds "Second Org" with the zone second.net, reachable by the same token. */
  addSecondAccount(): void;
}

/** In-memory stand-in for the subset of the Cloudflare API the app uses. */
export async function startFakeCloudflare(opts: { port?: number } = {}) {
  const state: FakeState = {
    accounts: [FAKE_ACCOUNT],
    zones: [
      { id: `${'z'.repeat(31)}1`, name: 'example.com', status: 'active', account: FAKE_ACCOUNT },
      { id: `${'z'.repeat(31)}2`, name: 'other.dev', status: 'active', account: FAKE_ACCOUNT },
    ],
    tunnels: new Map(),
    dns: new Map(),
    failures: [],
    requests: [],
    failNext(re, status, errors = [{ code: 1000, message: 'injected' }], method) {
      this.failures.push({ re, status, errors, method });
    },
    addSecondAccount() {
      this.accounts.push(SECOND_ACCOUNT);
      this.zones.push(SECOND_ZONE);
      this.dns.set(SECOND_ZONE.id, []);
    },
  };
  for (const z of state.zones) state.dns.set(z.id, []);

  const app = Fastify();
  const ok = (result: unknown, extra: object = {}) => ({ success: true, errors: [], messages: [], result, ...extra });
  const page = (list: unknown[]) => ok(list, { result_info: { page: 1, per_page: 100, total_pages: 1, count: list.length } });
  const fail = (reply: FastifyReply, status: number, errors: CfErr[]) =>
    reply.code(status).send({ success: false, errors, messages: [], result: null });

  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) return fail(reply, 401, [{ code: 10000, message: 'Authentication error' }]);
    const path = req.url.split('?')[0]!;
    state.requests.push(`${req.method} ${path}`);
    const i = state.failures.findIndex((f) => f.re.test(path) && (!f.method || f.method === req.method));
    if (i >= 0) {
      const f = state.failures.splice(i, 1)[0]!;
      return fail(reply, f.status, f.errors);
    }
  });

  // Tunnels are scoped to their account: another account's id answers like a missing tunnel.
  const find = (p: unknown) => {
    const { a, id } = p as { a: string; id: string };
    const e = state.tunnels.get(id);
    return e && e.accountId === a ? e : undefined;
  };
  const entry = (p: unknown, reply: FastifyReply) => {
    const e = find(p);
    if (!e || e.tunnel.deleted_at) {
      fail(reply, 404, [{ code: 1003, message: 'Tunnel not found' }]);
      return null;
    }
    return e;
  };
  
  app.get('/user/tokens/verify', async () => ok({ id: 't1', status: 'active' }));
  app.get('/accounts', async () => page(state.accounts));
  app.get('/zones', async (req) => {
    const accountId = (req.query as Record<string, string>)['account.id'];
    return page(state.zones.filter((z) => !accountId || z.account.id === accountId));
  });

  app.get('/accounts/:a/cfd_tunnel', async (req) => {
    const { a } = req.params as { a: string };
    return page([...state.tunnels.values()].filter((e) => e.accountId === a && !e.tunnel.deleted_at).map((e) => e.tunnel));
  });
  app.post('/accounts/:a/cfd_tunnel', async (req) => {
    const { name, config_src } = req.body as { name: string; config_src: 'cloudflare' | 'local' };
    const id = randomUUID();
    const tunnel: CfTunnel = { id, name, created_at: new Date().toISOString(), deleted_at: null, status: 'inactive', config_src, connections: [] };
    state.tunnels.set(id, { accountId: (req.params as { a: string }).a, tunnel, config: { ingress: [{ service: 'http_status:404' }] }, version: 0, token: `tok-${id}` });
    return ok(tunnel);
  });
  // Like the real API, a deleted tunnel is still returned by id, with deleted_at set.
  app.get('/accounts/:a/cfd_tunnel/:id', async (req, reply) => {
    const e = find(req.params);
    if (!e) return fail(reply, 404, [{ code: 1003, message: 'Tunnel not found' }]);
    return ok(e.tunnel);
  });
  app.patch('/accounts/:a/cfd_tunnel/:id', async (req, reply) => {
    const e = entry(req.params, reply);
    if (!e) return;
    e.tunnel.name = (req.body as { name: string }).name;
    return ok(e.tunnel);
  });
  app.delete('/accounts/:a/cfd_tunnel/:id', async (req, reply) => {
    const e = entry(req.params, reply);
    if (!e) return;
    if (e.tunnel.connections.length) return fail(reply, 400, [{ code: 1022, message: 'Cannot delete tunnel with active connections' }]);
    e.tunnel.deleted_at = new Date().toISOString();
    return ok(e.tunnel);
  });
  app.delete('/accounts/:a/cfd_tunnel/:id/connections', async (req, reply) => {
    const e = entry(req.params, reply);
    if (!e) return;
    e.tunnel.connections = [];
    e.tunnel.status = 'inactive';
    return ok(null);
  });
  app.get('/accounts/:a/cfd_tunnel/:id/token', async (req, reply) => {
    const e = entry(req.params, reply);
    return e && ok(e.token);
  });
  app.get('/accounts/:a/cfd_tunnel/:id/configurations', async (req, reply) => {
    const e = find(req.params);
    if (!e) return fail(reply, 404, [{ code: 1003, message: 'Tunnel not found' }]);
    return ok({ tunnel_id: e.tunnel.id, version: e.version, config: e.config, source: 'cloudflare' });
  });
  app.put('/accounts/:a/cfd_tunnel/:id/configurations', async (req, reply) => {
    const e = entry(req.params, reply);
    if (!e) return;
    e.config = (req.body as { config: CfTunnelConfig }).config;
    e.version += 1;
    return ok({ tunnel_id: e.tunnel.id, version: e.version, config: e.config, source: 'cloudflare' });
  });

  app.get('/zones/:z/dns_records', async (req) => {
    const name = (req.query as Record<string, string>)['name.exact'];
    return page((state.dns.get((req.params as { z: string }).z) ?? []).filter((r) => !name || r.name === name));
  });
  app.post('/zones/:z/dns_records', async (req, reply) => {
    const list = state.dns.get((req.params as { z: string }).z)!;
    const b = req.body as Omit<CfDnsRecord, 'id'>;
    if (list.some((r) => r.name === b.name)) {
      return fail(reply, 400, [{ code: 81053, message: 'An A, AAAA, or CNAME record with that host already exists.' }]);
    }
    const rec = { ...b, id: randomUUID().replace(/-/g, '') };
    list.push(rec);
    return ok(rec);
  });
  app.put('/zones/:z/dns_records/:r', async (req, reply) => {
    const { z, r } = req.params as { z: string; r: string };
    const list = state.dns.get(z)!;
    const i = list.findIndex((x) => x.id === r);
    if (i < 0) return fail(reply, 404, [{ code: 81044, message: 'Record does not exist.' }]);
    list[i] = { ...(req.body as CfDnsRecord), id: r };
    return ok(list[i]);
  });
  app.delete('/zones/:z/dns_records/:r', async (req, reply) => {
    const { z, r } = req.params as { z: string; r: string };
    const list = state.dns.get(z)!;
    const i = list.findIndex((x) => x.id === r);
    if (i < 0) return fail(reply, 404, [{ code: 81044, message: 'Record does not exist.' }]);
    list.splice(i, 1);
    return ok({ id: r });
  });

  const baseUrl = await app.listen({ port: opts.port ?? 0, host: '127.0.0.1' });
  return { baseUrl, state, token: FAKE_TOKEN, close: () => app.close() };
}

export type FakeCf = Awaited<ReturnType<typeof startFakeCloudflare>>;
