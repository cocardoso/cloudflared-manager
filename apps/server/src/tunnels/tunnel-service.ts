import type { AccountRef, RoutesUpdate, TunnelDetail, TunnelList, TunnelSummary, UnavailableAccount, UpdateTunnel } from '@tm/shared';
import type { AccountDirectory, AccountInfo } from '../cloudflare/account-directory';
import type { CfApi } from '../cloudflare/api';
import type { CfTunnel, CfZone } from '../cloudflare/types';
import { AppError } from '../errors';
import type { EventRepo } from '../events/event-repo';
import type { ServiceBackend, TunnelEnv } from '../services/backend';
import type { DnsRepo, ManagedDns } from './dns-repo';
import { configToRoutes, diffHostnames, routesToConfig, tunnelTarget } from './ingress';
import type { TunnelRepo, TunnelRow } from './tunnel-repo';
import { findZoneForHostname } from './zones';

interface Deps {
  api: (accountId: string) => CfApi;
  accounts: AccountDirectory;
  backend: ServiceBackend;
  tunnels: TunnelRepo;
  dns: DnsRepo;
  events: EventRepo;
  /** Called with the account of each tunnel created here. */
  onAccountUsed?: (accountId: string) => void;
}

const ignore = (...codes: string[]) => (e: unknown) => {
  if (e instanceof AppError && codes.includes(e.code)) return;
  throw e;
};

const isCode = (e: unknown, code: string) => e instanceof AppError && e.code === code;
const ref = (a: AccountInfo): AccountRef => ({ id: a.id, name: a.name });

const ADDRESS_TYPES = new Set(['A', 'AAAA', 'CNAME']);

const WATCHDOG_RESET = { watchdogState: 'healthy', restartAttempts: 0, degradedSince: null, nextRestartAt: null } as const;

/**
 * Orchestrates Cloudflare (source of truth for tunnels, routes and DNS) with the local service backend,
 * across every account the token reaches.
 */
export class TunnelService {
  /** Account of tunnels seen in a listing or lookup, so unmanaged ones need no scan. */
  private known = new Map<string, string>();

  constructor(private d: Deps) {}

  /** The local row's account, a remembered one, or a scan of every account. */
  private async accountOf(id: string): Promise<AccountInfo> {
    const row = this.d.tunnels.get(id);
    const hint = row?.accountId ?? this.known.get(id);
    if (hint) return this.d.accounts.get(hint);
    for (const a of await this.d.accounts.list()) {
      try {
        await this.d.api(a.id).getTunnel(id);
      } catch (e) {
        // Another account's tunnel id answers as not found (or forbidden): keep looking.
        if (e instanceof AppError) continue;
        throw e;
      }
      this.known.set(id, a.id);
      if (row) this.d.tunnels.update(id, { accountId: a.id });
      return a;
    }
    throw new AppError('TUNNEL_NOT_FOUND', 'Tunnel not found in any account', 404);
  }

  private async summarize(t: CfTunnel, row: TunnelRow | null, routeCount: number, account: AccountRef): Promise<TunnelSummary> {
    const local = await this.d.backend.status(t.id);
    return {
      id: t.id,
      name: t.name,
      account,
      createdAt: t.created_at,
      remote: t.config_src === 'cloudflare',
      managedHere: !!row && this.d.backend.isInstalled(t.id),
      edgeStatus: t.status,
      connections: (t.connections ?? []).map((c) => ({
        coloName: c.colo_name, openedAt: c.opened_at, originIp: c.origin_ip, clientVersion: c.client_version,
      })),
      local: local.state,
      activeSince: local.activeSince,
      watchdog: !row || !row.keepAlive ? 'disabled' : row.watchdogState,
      routeCount,
      settings: row
        ? { keepAlive: row.keepAlive, toleranceMinutes: row.toleranceMinutes, logLevel: row.logLevel, protocol: row.protocol, metricsPort: row.metricsPort }
        : null,
    };
  }

  /** Placeholder for a tunnel still installed here but deleted in the Cloudflare dashboard. */
  private ghost(row: TunnelRow): CfTunnel {
    return { id: row.id, name: '(deleted in Cloudflare)', created_at: '', deleted_at: null, status: 'down', config_src: 'cloudflare', connections: [] };
  }

  async list(): Promise<TunnelList> {
    const accounts = await this.d.accounts.list();
    const rows = new Map(this.d.tunnels.list().map((r) => [r.id, r]));
    const unavailable = new Map<string, UnavailableAccount>();
    const listed = await Promise.all(
      accounts.map(async (a) => {
        try {
          return { a, remote: await this.d.api(a.id).listTunnels() };
        } catch (e) {
          // One account the token cannot read must not hide the others.
          if (!(e instanceof AppError)) throw e;
          unavailable.set(a.id, { id: a.id, name: a.name, code: e.code });
          return { a, remote: [] };
        }
      }),
    );
    const out = (
      await Promise.all(
        listed.flatMap(({ a, remote }) =>
          remote.map(async (t) => {
            this.known.set(t.id, a.id);
            const row = rows.get(t.id) ?? null;
            rows.delete(t.id);
            if (row && row.accountId !== a.id) this.d.tunnels.update(t.id, { accountId: a.id });
            const count = row && t.config_src === 'cloudflare' ? configToRoutes((await this.d.api(a.id).getConfig(t.id)).config).length : 0;
            return this.summarize(t, row, count, ref(a));
          }),
        ),
      )
    );
    for (const row of rows.values()) {
      const a = accounts.find((x) => x.id === row.accountId);
      if (a && unavailable.has(a.id)) continue; // unknown right now, not deleted
      if (!a && row.accountId) {
        // The token no longer reaches this tunnel's account.
        unavailable.set(row.accountId, { id: row.accountId, name: row.accountId, code: 'ACCOUNT_NOT_FOUND' });
        continue;
      }
      out.push(await this.summarize(this.ghost(row), row, 0, a ? ref(a) : { id: '', name: '' }));
    }
    return {
      tunnels: out.sort((a, b) => Number(b.managedHere) - Number(a.managedHere) || a.name.localeCompare(b.name)),
      unavailableAccounts: [...unavailable.values()],
    };
  }

  async get(id: string): Promise<TunnelDetail> {
    const row = this.d.tunnels.get(id);
    const ghost = async (account: AccountRef) => ({ ...(await this.summarize(this.ghost(row!), row, 0, account)), routes: [], configVersion: 0 });
    let account: AccountInfo;
    try {
      account = await this.accountOf(id);
    } catch (e) {
      if (row && isCode(e, 'TUNNEL_NOT_FOUND')) return ghost({ id: '', name: '' });
      throw e;
    }
    const api = this.d.api(account.id);
    let t: CfTunnel;
    try {
      t = await api.getTunnel(id);
    } catch (e) {
      if (row && isCode(e, 'TUNNEL_NOT_FOUND')) return ghost(ref(account));
      throw e;
    }
    const { version, config } = t.config_src === 'cloudflare' ? await api.getConfig(id) : { version: 0, config: { ingress: [] } };
    const routes = configToRoutes(config);
    return { ...(await this.summarize(t, row, routes.length, ref(account))), routes, configVersion: version };
  }

  private envFor(row: TunnelRow, token: string): TunnelEnv {
    return { token, metricsPort: row.metricsPort, logLevel: row.logLevel, protocol: row.protocol };
  }

  private async installAndStart(id: string, accountId: string) {
    const token = await this.d.api(accountId).getTunnelToken(id);
    const row = this.d.tunnels.get(id) ?? this.d.tunnels.insert(id, this.d.tunnels.nextMetricsPort(), accountId);
    await this.d.backend.install(id, this.envFor(row, token));
    await this.d.backend.start(id);
  }

  /** Without an account id, only a token that reaches a single account decides by itself. */
  private async accountForCreate(accountId?: string) {
    if (accountId) return this.d.accounts.get(accountId);
    const all = await this.d.accounts.list();
    if (all.length === 1) return all[0]!;
    throw new AppError('ACCOUNT_SELECTION_REQUIRED', 'Choose the account for this tunnel', 400);
  }

  async create(name: string, accountId?: string): Promise<TunnelSummary> {
    const account = await this.accountForCreate(accountId);
    const api = this.d.api(account.id);
    const t = await api.createTunnel(name);
    this.known.set(t.id, account.id);
    await this.installAndStart(t.id, account.id);
    this.d.onAccountUsed?.(account.id);
    this.d.events.add(t.id, 'created', `Tunnel "${name}" created`);
    return this.summarize(await api.getTunnel(t.id), this.d.tunnels.get(t.id), 0, ref(account));
  }

  async adopt(id: string): Promise<TunnelSummary> {
    const account = await this.accountOf(id);
    const t = await this.d.api(account.id).getTunnel(id);
    if (t.config_src !== 'cloudflare') throw new AppError('TUNNEL_NOT_REMOTE', 'Only remotely-managed tunnels can be adopted', 400);
    await this.installAndStart(id, account.id);
    this.d.events.add(id, 'adopted', `Tunnel "${t.name}" adopted`);
    return this.get(id);
  }

  private requireRow(id: string) {
    const row = this.d.tunnels.get(id);
    if (!row) throw new AppError('TUNNEL_NOT_MANAGED', 'Tunnel is not managed by this host', 400);
    return row;
  }

  async update(id: string, patch: UpdateTunnel): Promise<TunnelSummary> {
    const row = this.requireRow(id);
    const api = patch.name || patch.logLevel || patch.protocol ? this.d.api((await this.accountOf(id)).id) : null;
    if (patch.name) await api!.renameTunnel(id, patch.name);
    const envChanged = (patch.logLevel && patch.logLevel !== row.logLevel) || (patch.protocol && patch.protocol !== row.protocol);
    this.d.tunnels.update(id, {
      keepAlive: patch.keepAlive,
      toleranceMinutes: patch.toleranceMinutes,
      logLevel: patch.logLevel,
      protocol: patch.protocol,
      ...(patch.keepAlive === true && !row.keepAlive ? WATCHDOG_RESET : {}),
    });
    if (envChanged) {
      const token = await api!.getTunnelToken(id);
      await this.d.backend.updateEnv(id, this.envFor(this.d.tunnels.get(id)!, token));
      if ((await this.d.backend.status(id)).state === 'active') await this.d.backend.restart(id);
    }
    this.d.events.add(id, 'config-changed', 'Tunnel settings updated');
    return this.get(id);
  }

  async start(id: string) {
    this.requireRow(id);
    await this.d.backend.start(id);
    this.d.tunnels.update(id, WATCHDOG_RESET);
    this.d.events.add(id, 'started', 'Tunnel started');
  }

  async stop(id: string) {
    this.requireRow(id);
    await this.d.backend.stop(id);
    this.d.events.add(id, 'stopped', 'Tunnel stopped');
  }

  async restart(id: string) {
    this.requireRow(id);
    await this.d.backend.restart(id);
    this.d.tunnels.update(id, WATCHDOG_RESET);
    this.d.events.add(id, 'restarted', 'Tunnel restarted manually');
  }

  /** Idempotent: tolerates parts that were already removed elsewhere. */
  async delete(id: string) {
    // A tunnel already gone from every account still gets its local parts cleaned up.
    const account = await this.accountOf(id).catch((e) => {
      if (isCode(e, 'TUNNEL_NOT_FOUND')) return null;
      throw e;
    });
    const accounts = await this.d.accounts.list();
    // DNS endpoints are zone-scoped, so any account's client can remove a record.
    const api = this.d.api(account?.id ?? accounts[0]?.id ?? '');
    if (this.d.backend.isInstalled(id)) await this.d.backend.uninstall(id);
    if (account) await api.cleanupConnections(id).catch(ignore('TUNNEL_NOT_FOUND', 'CF_API_ERROR'));
    const zones = new Set(accounts.flatMap((a) => a.zones.map((z) => z.id)));
    for (const m of this.d.dns.byTunnel(id)) {
      // Any failure other than "already gone" aborts, leaving the tunnel in place so the delete can be retried.
      if (zones.has(m.zoneId)) await api.deleteDnsRecord(m.zoneId, m.recordId).catch(ignore('DNS_RECORD_NOT_FOUND'));
      this.d.dns.delete(m.recordId);
    }
    if (account) await api.deleteTunnel(id).catch(ignore('TUNNEL_NOT_FOUND'));
    this.known.delete(id);
    this.d.tunnels.delete(id);
    this.d.events.add(id, 'deleted', 'Tunnel deleted');
  }

  /**
   * Replaces the tunnel's public hostnames. Validates everything that can fail before writing,
   * then writes ingress, then DNS; a DNS failure rolls the ingress back.
   */
  async updateRoutes(id: string, input: RoutesUpdate): Promise<TunnelDetail> {
    const account = await this.accountOf(id);
    const api = this.d.api(account.id);
    const t = await api.getTunnel(id);
    if (t.config_src !== 'cloudflare') throw new AppError('TUNNEL_NOT_REMOTE', 'Tunnel uses local configuration', 400);
    const before = await api.getConfig(id);
    if (before.version !== input.version) {
      throw new AppError('CONFIG_VERSION_CONFLICT', 'Configuration changed elsewhere', 409, { currentVersion: before.version });
    }

    // A tunnel only serves hostnames of zones in its own account.
    const zones = account.zones;
    const zoneOf = new Map<string, CfZone>();
    const missing: string[] = [];
    for (const r of input.routes) {
      const z = findZoneForHostname(r.hostname, zones);
      if (z) zoneOf.set(r.hostname, z);
      else if (!missing.includes(r.hostname)) missing.push(r.hostname);
    }
    if (missing.length) throw new AppError('ZONE_NOT_FOUND', "Hostname does not belong to a zone in this tunnel's account", 400, { hostnames: missing });

    const beforeRoutes = configToRoutes(before.config);
    const { added, removed } = diffHostnames(beforeRoutes, input.routes);
    const target = tunnelTarget(id);

    type Plan = { hostname: string; zoneId: string; action: 'create' | 'reuse' | 'overwrite'; recordId?: string };
    const plans: Plan[] = [];
    const conflicts: string[] = [];
    for (const hostname of added) {
      const zoneId = zoneOf.get(hostname)!.id;
      // Only address records can clash with the CNAME; others (TXT, MX…) are never touched.
      const existing = (await api.findDnsRecords(zoneId, hostname)).filter((r) => ADDRESS_TYPES.has(r.type));
      const rec = existing[0];
      if (!rec) plans.push({ hostname, zoneId, action: 'create' });
      else if (rec.type === 'CNAME' && rec.content === target) plans.push({ hostname, zoneId, action: 'reuse', recordId: rec.id });
      else if (input.overwriteDns.includes(hostname) && existing.length === 1) plans.push({ hostname, zoneId, action: 'overwrite', recordId: rec.id });
      else conflicts.push(hostname);
    }
    if (conflicts.length) throw new AppError('DNS_CONFLICT', 'DNS record already exists for hostname', 409, { hostnames: conflicts });

    await api.putConfig(id, routesToConfig(input.routes, before.config));

    const created: { zoneId: string; recordId: string }[] = [];
    const owned: ManagedDns[] = [];
    try {
      // Creates first: they can be undone; overwrites cannot.
      for (const p of [...plans].sort((a, b) => Number(a.action === 'overwrite') - Number(b.action === 'overwrite'))) {
        let recordId = p.recordId!;
        if (p.action === 'create') {
          recordId = (await api.createCname(p.zoneId, p.hostname, target)).id;
          created.push({ zoneId: p.zoneId, recordId });
        } else if (p.action === 'overwrite') {
          await api.updateCname(p.zoneId, recordId, p.hostname, target);
        }
        owned.push({ recordId, zoneId: p.zoneId, hostname: p.hostname, tunnelId: id });
      }
    } catch (e) {
      await api.putConfig(id, before.config).catch(() => undefined);
      for (const c of created) await api.deleteDnsRecord(c.zoneId, c.recordId).catch(() => undefined);
      throw e;
    }
    for (const m of owned) this.d.dns.upsert(m);

    const failures: string[] = [];
    for (const hostname of removed) {
      if (input.keepDns.includes(hostname)) continue;
      const m = this.d.dns.byHostname(hostname);
      if (!m || m.tunnelId !== id) continue;
      try {
        await api.deleteDnsRecord(m.zoneId, m.recordId);
      } catch (e) {
        // A missing record is already the desired state; anything else keeps it tracked for a later retry.
        if (!(e instanceof AppError && e.code === 'DNS_RECORD_NOT_FOUND')) {
          failures.push(hostname);
          continue;
        }
      }
      this.d.dns.delete(m.recordId);
    }

    this.d.events.add(
      id,
      'config-changed',
      `Routes updated (+${added.length} / -${removed.length})${failures.length ? `; failed to remove DNS for ${failures.join(', ')}` : ''}`,
    );
    return this.get(id);
  }
}
