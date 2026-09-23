import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTunnelEnv } from '../../test/helpers';

let env: Awaited<ReturnType<typeof makeTunnelEnv>>;
beforeEach(async () => {
  env = await makeTunnelEnv();
});
afterEach(() => env.cf.close());

const zone1 = () => env.cf.state.zones[0]!.id;
const zone2 = () => env.cf.state.zones[1]!.id;
const route = (hostname: string, path?: string) => ({ hostname, service: 'http://10.0.0.5:8080', ...(path ? { path } : {}) });
const upd = (version: number, routes: ReturnType<typeof route>[], extra: { overwriteDns?: string[]; keepDns?: string[] } = {}) =>
  ({ version, routes, overwriteDns: extra.overwriteDns ?? [], keepDns: extra.keepDns ?? [] });

describe('create / list', () => {
  it('creates remote tunnel, installs and starts unit', async () => {
    const t = await env.service.create('home');
    expect(t.managedHere).toBe(true);
    expect(t.settings?.metricsPort).toBe(20241);
    expect(env.backend.calls).toEqual([`install ${t.id}`, `start ${t.id}`]);
    expect(env.cf.state.tunnels.get(t.id)!.tunnel.config_src).toBe('cloudflare');
    const second = await env.service.create('lab');
    expect(second.settings?.metricsPort).toBe(20242);
    expect((await env.service.list()).map((x) => x.name)).toEqual(['home', 'lab']);
  });
  it('lists unmanaged remote tunnels with managedHere=false', async () => {
    const t = await env.api.createTunnel('elsewhere');
    const [s] = await env.service.list();
    expect(s).toMatchObject({ id: t.id, managedHere: false, local: 'not-installed', settings: null, watchdog: 'disabled' });
  });
  it('lists tunnels deleted in the dashboard as ghosts', async () => {
    const t = await env.service.create('home');
    env.cf.state.tunnels.get(t.id)!.tunnel.deleted_at = 'x';
    const [s] = await env.service.list();
    expect(s).toMatchObject({ id: t.id, edgeStatus: 'down', name: '(deleted in Cloudflare)' });
  });
});

describe('adopt', () => {
  it('installs existing remote tunnel', async () => {
    const t = await env.api.createTunnel('elsewhere');
    const s = await env.service.adopt(t.id);
    expect(s.managedHere).toBe(true);
    expect(env.backend.calls).toContain(`start ${t.id}`);
  });
  it('refuses local-config tunnels', async () => {
    const id = (await env.api.createTunnel('x')).id;
    env.cf.state.tunnels.get(id)!.tunnel.config_src = 'local';
    await expect(env.service.adopt(id)).rejects.toMatchObject({ code: 'TUNNEL_NOT_REMOTE' });
  });
});

describe('updateRoutes', () => {
  it('adds routes across two zones and creates CNAMEs', async () => {
    const t = await env.service.create('home');
    const d = await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com'), route('git.other.dev')]));
    expect(d.routes).toHaveLength(2);
    expect(d.configVersion).toBe(1);
    expect(env.cf.state.tunnels.get(t.id)!.config.ingress.at(-1)).toEqual({ service: 'http_status:404' });
    expect(env.cf.state.dns.get(zone1())![0]).toMatchObject({ name: 'ha.example.com', content: `${t.id}.cfargotunnel.com`, proxied: true });
    expect(env.cf.state.dns.get(zone2())![0]!.name).toBe('git.other.dev');
    expect(env.dns.byTunnel(t.id)).toHaveLength(2);
  });
  it('rejects stale version', async () => {
    const t = await env.service.create('home');
    await env.api.putConfig(t.id, { ingress: [{ service: 'http_status:404' }] });
    await expect(env.service.updateRoutes(t.id, upd(0, []))).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', status: 409 });
  });
  it('rejects hostname outside account zones before writing', async () => {
    const t = await env.service.create('home');
    await expect(env.service.updateRoutes(t.id, upd(0, [route('a.notmine.io')])))
      .rejects.toMatchObject({ code: 'ZONE_NOT_FOUND', details: { hostnames: ['a.notmine.io'] } });
    expect(env.cf.state.tunnels.get(t.id)!.version).toBe(0);
  });
  it('reports DNS conflict without writing, then overwrites when asked', async () => {
    const t = await env.service.create('home');
    env.cf.state.dns.get(zone1())!.push({ id: 'r1', name: 'ha.example.com', type: 'A', content: '1.2.3.4', proxied: false });
    await expect(env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')])))
      .rejects.toMatchObject({ code: 'DNS_CONFLICT', details: { hostnames: ['ha.example.com'] } });
    expect(env.cf.state.tunnels.get(t.id)!.version).toBe(0);
    await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')], { overwriteDns: ['ha.example.com'] }));
    const rec = env.cf.state.dns.get(zone1())!.find((r) => r.name === 'ha.example.com')!;
    expect(rec).toMatchObject({ type: 'CNAME', content: `${t.id}.cfargotunnel.com` });
  });
  it('reuses CNAME already pointing to this tunnel', async () => {
    const t = await env.service.create('home');
    env.cf.state.dns.get(zone1())!.push({ id: 'r9', name: 'ha.example.com', type: 'CNAME', content: `${t.id}.cfargotunnel.com`, proxied: true });
    await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')]));
    expect(env.cf.state.dns.get(zone1())).toHaveLength(1);
    expect(env.dns.byHostname('ha.example.com')?.recordId).toBe('r9');
  });
  it('rolls back ingress when DNS creation fails', async () => {
    const t = await env.service.create('home');
    env.cf.state.failNext(new RegExp(`${zone2()}/dns_records$`), 500, [{ code: 1000, message: 'boom' }], 'POST');
    await expect(env.service.updateRoutes(t.id, upd(0, [route('ha.example.com'), route('git.other.dev')]))).rejects.toBeTruthy();
    expect(env.cf.state.tunnels.get(t.id)!.config.ingress).toEqual([{ service: 'http_status:404' }]);
    expect(env.cf.state.dns.get(zone1())).toHaveLength(0);
    expect(env.cf.state.dns.get(zone2())).toHaveLength(0);
    expect(env.dns.byTunnel(t.id)).toHaveLength(0);
  });
  it('removes CNAME only when no rule uses the host anymore', async () => {
    const t = await env.service.create('home');
    let d = await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com', '^/api'), route('ha.example.com')]));
    d = await env.service.updateRoutes(t.id, upd(d.configVersion, [route('ha.example.com')]));
    expect(env.cf.state.dns.get(zone1())).toHaveLength(1);
    await env.service.updateRoutes(t.id, upd(d.configVersion, []));
    expect(env.cf.state.dns.get(zone1())).toHaveLength(0);
    expect(env.dns.byTunnel(t.id)).toHaveLength(0);
  });
  it('keeps DNS when listed in keepDns', async () => {
    const t = await env.service.create('home');
    const d = await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')]));
    await env.service.updateRoutes(t.id, upd(d.configVersion, [], { keepDns: ['ha.example.com'] }));
    expect(env.cf.state.dns.get(zone1())).toHaveLength(1);
  });
  it('never deletes DNS records it did not create', async () => {
    const t = await env.service.create('home');
    env.cf.state.dns.get(zone1())!.push({ id: 'r9', name: 'ha.example.com', type: 'CNAME', content: `${t.id}.cfargotunnel.com`, proxied: true });
    await env.api.putConfig(t.id, { ingress: [{ hostname: 'ha.example.com', service: 'http://x:1' }, { service: 'http_status:404' }] });
    await env.service.updateRoutes(t.id, upd(1, []));
    expect(env.cf.state.dns.get(zone1())).toHaveLength(1);
  });
});

describe('DNS safety', () => {
  it('keeps tracking a CNAME whose deletion failed with a server error', async () => {
    const t = await env.service.create('home');
    const d = await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')]));
    env.cf.state.failNext(/dns_records\/[^/]+$/, 500, [{ code: 1000, message: 'boom' }], 'DELETE');
    await env.service.updateRoutes(t.id, upd(d.configVersion, []));
    expect(env.dns.byTunnel(t.id)).toHaveLength(1);
    expect(env.events.list({ tunnelId: t.id })[0]!.message).toContain('failed to remove DNS for ha.example.com');
  });
  it('aborts tunnel deletion when a CNAME cannot be removed, so it can be retried', async () => {
    const t = await env.service.create('home');
    await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')]));
    env.cf.state.failNext(/dns_records\/[^/]+$/, 500, [{ code: 1000, message: 'boom' }], 'DELETE');
    await expect(env.service.delete(t.id)).rejects.toMatchObject({ code: 'CF_API_ERROR' });
    expect(env.cf.state.tunnels.get(t.id)!.tunnel.deleted_at).toBeNull();
    expect(env.dns.byTunnel(t.id)).toHaveLength(1);
    await env.service.delete(t.id);
    expect(env.cf.state.dns.get(zone1())).toHaveLength(0);
  });
  it('never overwrites non-address records such as TXT', async () => {
    const t = await env.service.create('home');
    env.cf.state.dns.get(zone1())!.push({ id: 'txt1', name: 'ha.example.com', type: 'TXT', content: 'verify=123', proxied: false });
    await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')], { overwriteDns: ['ha.example.com'] })).catch(() => undefined);
    expect(env.cf.state.dns.get(zone1())!.find((r) => r.id === 'txt1')).toMatchObject({ type: 'TXT', content: 'verify=123' });
  });
});

describe('delete', () => {
  it('removes unit, managed DNS and remote tunnel even with active connections', async () => {
    const t = await env.service.create('home');
    await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')]));
    env.cf.state.tunnels.get(t.id)!.tunnel.connections = [
      { colo_name: 'gru01', opened_at: '', origin_ip: '', client_version: '', is_pending_reconnect: false },
    ];
    await env.service.delete(t.id);
    expect(env.backend.calls).toContain(`uninstall ${t.id}`);
    expect(env.cf.state.dns.get(zone1())).toHaveLength(0);
    expect(env.cf.state.tunnels.get(t.id)!.tunnel.deleted_at).not.toBeNull();
    expect(env.tunnels.get(t.id)).toBeNull();
  });
  it('is idempotent when parts are already gone', async () => {
    const t = await env.service.create('home');
    await env.service.updateRoutes(t.id, upd(0, [route('ha.example.com')]));
    env.cf.state.dns.get(zone1())!.length = 0;
    env.cf.state.tunnels.get(t.id)!.tunnel.deleted_at = 'x';
    await expect(env.service.delete(t.id)).resolves.toBeUndefined();
    expect(env.dns.byTunnel(t.id)).toHaveLength(0);
    expect(env.tunnels.get(t.id)).toBeNull();
  });
});

describe('update settings', () => {
  it('renames remotely and rewrites env + restarts when logLevel changes on active tunnel', async () => {
    const t = await env.service.create('home');
    const s = await env.service.update(t.id, { name: 'house', logLevel: 'debug', keepAlive: false });
    expect(s.name).toBe('house');
    expect(s.settings).toMatchObject({ logLevel: 'debug', keepAlive: false });
    expect(s.watchdog).toBe('disabled');
    expect(env.backend.calls.slice(-2)).toEqual([`updateEnv ${t.id}`, `restart ${t.id}`]);
  });
  it('rejects settings for tunnels not managed here', async () => {
    const t = await env.api.createTunnel('elsewhere');
    await expect(env.service.update(t.id, { keepAlive: false })).rejects.toMatchObject({ code: 'TUNNEL_NOT_MANAGED' });
    await expect(env.service.start(t.id)).rejects.toMatchObject({ code: 'TUNNEL_NOT_MANAGED' });
  });
  it('start resets a failing watchdog', async () => {
    const t = await env.service.create('home');
    env.tunnels.update(t.id, { watchdogState: 'failing', restartAttempts: 5 });
    await env.service.start(t.id);
    expect(env.tunnels.get(t.id)).toMatchObject({ watchdogState: 'healthy', restartAttempts: 0 });
  });
});
