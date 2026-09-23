import type { RoutesUpdate, TunnelDetail, TunnelSummary, UpdateTunnel } from '@tm/shared';
import type { CfApi } from '../cloudflare/api';
import type { CfTunnel, CfZone } from '../cloudflare/types';
import { AppError } from '../errors';
import type { EventRepo } from '../events/event-repo';
import type { ServiceBackend, TunnelEnv } from '../services/backend';
import type { DnsRepo, ManagedDns } from './dns-repo';
import { configToRoutes, diffHostnames, routesToConfig, tunnelTarget } from './ingress';
import type { TunnelRepo, TunnelRow } from './tunnel-repo';
import { findZoneForHostname } from './zones';

interface Deps { api: () => CfApi; backend: ServiceBackend; tunnels: TunnelRepo; dns: DnsRepo; events: EventRepo }

const ignore = (...codes: string[]) => (e: unknown) => {
  if (e instanceof AppError && codes.includes(e.code)) return;
  throw e;
};

const WATCHDOG_RESET = { watchdogState: 'healthy', restartAttempts: 0, degradedSince: null, nextRestartAt: null } as const;

/** Orchestrates Cloudflare (source of truth for tunnels, routes and DNS) with the local service backend. */
export class TunnelService {
  constructor(private d: Deps) {}

  private async summarize(t: CfTunnel, row: TunnelRow | null, routeCount: number): Promise<TunnelSummary> {
    const local = await this.d.backend.status(t.id);
    return {
      id: t.id,
      name: t.name,
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

  async list(): Promise<TunnelSummary[]> {
    const api = this.d.api();
    const remote = await api.listTunnels();
    const rows = new Map(this.d.tunnels.list().map((r) => [r.id, r]));
    const out = await Promise.all(
      remote.map(async (t) => {
        const row = rows.get(t.id) ?? null;
        rows.delete(t.id);
        const count = row && t.config_src === 'cloudflare' ? configToRoutes((await api.getConfig(t.id)).config).length : 0;
        return this.summarize(t, row, count);
      }),
    );
    for (const row of rows.values()) out.push(await this.summarize(this.ghost(row), row, 0));
    return out.sort((a, b) => Number(b.managedHere) - Number(a.managedHere) || a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<TunnelDetail> {
    const api = this.d.api();
    const row = this.d.tunnels.get(id);
    let t: CfTunnel;
    try {
      t = await api.getTunnel(id);
    } catch (e) {
      if (row && e instanceof AppError && e.code === 'TUNNEL_NOT_FOUND') {
        return { ...(await this.summarize(this.ghost(row), row, 0)), routes: [], configVersion: 0 };
      }
      throw e;
    }
    const { version, config } = t.config_src === 'cloudflare' ? await api.getConfig(id) : { version: 0, config: { ingress: [] } };
    const routes = configToRoutes(config);
    return { ...(await this.summarize(t, row, routes.length)), routes, configVersion: version };
  }

  private envFor(row: TunnelRow, token: string): TunnelEnv {
    return { token, metricsPort: row.metricsPort, logLevel: row.logLevel, protocol: row.protocol };
  }

  private async installAndStart(id: string) {
    const token = await this.d.api().getTunnelToken(id);
    const row = this.d.tunnels.get(id) ?? this.d.tunnels.insert(id, this.d.tunnels.nextMetricsPort());
    await this.d.backend.install(id, this.envFor(row, token));
    await this.d.backend.start(id);
  }

  async create(name: string): Promise<TunnelSummary> {
    const t = await this.d.api().createTunnel(name);
    await this.installAndStart(t.id);
    this.d.events.add(t.id, 'created', `Tunnel "${name}" created`);
    return this.summarize(await this.d.api().getTunnel(t.id), this.d.tunnels.get(t.id), 0);
  }

  async adopt(id: string): Promise<TunnelSummary> {
    const t = await this.d.api().getTunnel(id);
    if (t.config_src !== 'cloudflare') throw new AppError('TUNNEL_NOT_REMOTE', 'Only remotely-managed tunnels can be adopted', 400);
    await this.installAndStart(id);
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
    if (patch.name) await this.d.api().renameTunnel(id, patch.name);
    const envChanged = (patch.logLevel && patch.logLevel !== row.logLevel) || (patch.protocol && patch.protocol !== row.protocol);
    this.d.tunnels.update(id, {
      keepAlive: patch.keepAlive,
      toleranceMinutes: patch.toleranceMinutes,
      logLevel: patch.logLevel,
      protocol: patch.protocol,
      ...(patch.keepAlive === true && !row.keepAlive ? WATCHDOG_RESET : {}),
    });
    if (envChanged) {
      const token = await this.d.api().getTunnelToken(id);
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
    const api = this.d.api();
    if (this.d.backend.isInstalled(id)) await this.d.backend.uninstall(id);
    await api.cleanupConnections(id).catch(ignore('TUNNEL_NOT_FOUND', 'CF_API_ERROR'));
    const zones = new Set((await api.listZones()).map((z) => z.id));
    for (const m of this.d.dns.byTunnel(id)) {
      if (zones.has(m.zoneId)) await api.deleteDnsRecord(m.zoneId, m.recordId).catch(ignore('CF_API_ERROR'));
      this.d.dns.delete(m.recordId);
    }
    await api.deleteTunnel(id).catch(ignore('TUNNEL_NOT_FOUND'));
    this.d.tunnels.delete(id);
    this.d.events.add(id, 'deleted', 'Tunnel deleted');
  }

  /**
   * Replaces the tunnel's public hostnames. Validates everything that can fail before writing,
   * then writes ingress, then DNS; a DNS failure rolls the ingress back.
   */
  async updateRoutes(id: string, input: RoutesUpdate): Promise<TunnelDetail> {
    const api = this.d.api();
    const t = await api.getTunnel(id);
    if (t.config_src !== 'cloudflare') throw new AppError('TUNNEL_NOT_REMOTE', 'Tunnel uses local configuration', 400);
    const before = await api.getConfig(id);
    if (before.version !== input.version) {
      throw new AppError('CONFIG_VERSION_CONFLICT', 'Configuration changed elsewhere', 409, { currentVersion: before.version });
    }

    const zones = await api.listZones();
    const zoneOf = new Map<string, CfZone>();
    const missing: string[] = [];
    for (const r of input.routes) {
      const z = findZoneForHostname(r.hostname, zones);
      if (z) zoneOf.set(r.hostname, z);
      else if (!missing.includes(r.hostname)) missing.push(r.hostname);
    }
    if (missing.length) throw new AppError('ZONE_NOT_FOUND', 'Hostname does not belong to any zone in this account', 400, { hostnames: missing });

    const beforeRoutes = configToRoutes(before.config);
    const { added, removed } = diffHostnames(beforeRoutes, input.routes);
    const target = tunnelTarget(id);

    type Plan = { hostname: string; zoneId: string; action: 'create' | 'reuse' | 'overwrite'; recordId?: string };
    const plans: Plan[] = [];
    const conflicts: string[] = [];
    for (const hostname of added) {
      const zoneId = zoneOf.get(hostname)!.id;
      const existing = await api.findDnsRecords(zoneId, hostname);
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
        // A missing record (CF_API_ERROR 404) is already the desired state.
        if (!(e instanceof AppError && e.code === 'CF_API_ERROR')) {
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
