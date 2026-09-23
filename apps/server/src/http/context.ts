import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AdminRepo, SessionStore } from '../auth/sessions';
import { CfApi } from '../cloudflare/api';
import { CfClient } from '../cloudflare/client';
import type { AppConfig } from '../config';
import { loadOrCreateKey } from '../crypto/secret-box';
import { openDatabase, type Db } from '../db/database';
import { AppError } from '../errors';
import { EventRepo } from '../events/event-repo';
import { MetricsSampler } from '../metrics/sampler';
import type { ServiceBackend } from '../services/backend';
import { FakeBackend } from '../services/fake-backend';
import { SystemdBackend } from '../services/systemd-backend';
import { SettingsRepo } from '../settings/settings-repo';
import { latestCloudflaredVersion } from '../system/cloudflared-info';
import { DnsRepo } from '../tunnels/dns-repo';
import { TunnelRepo } from '../tunnels/tunnel-repo';
import { TunnelService } from '../tunnels/tunnel-service';

export interface AppContext {
  config: AppConfig;
  db: Db;
  admin: AdminRepo;
  sessions: SessionStore;
  settings: SettingsRepo;
  tunnels: TunnelRepo;
  dns: DnsRepo;
  events: EventRepo;
  backend: ServiceBackend;
  sampler: MetricsSampler;
  cfClient(token: string): CfClient;
  /** Throws CF_NOT_CONNECTED until a token is stored. */
  api(): CfApi;
  service: TunnelService;
  latestVersion: () => Promise<string | null>;
}

export function createContext(
  config: AppConfig,
  overrides: Partial<Pick<AppContext, 'backend' | 'latestVersion'>> = {},
): AppContext {
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, 'data.db'));
  const settings = new SettingsRepo(db, loadOrCreateKey(join(config.etcDir, 'secret.key')));
  const backend = overrides.backend ?? (config.serviceBackend === 'fake' ? new FakeBackend(config.etcDir) : new SystemdBackend(config.etcDir));
  const cfClient = (token: string) => new CfClient({ token, baseUrl: config.cfApiBase });

  let cached: { token: string; accountId: string; api: CfApi } | null = null;
  const api = () => {
    const c = settings.getCloudflare();
    if (!c) throw new AppError('CF_NOT_CONNECTED', 'Cloudflare account not connected', 409);
    if (!cached || cached.token !== c.token || cached.accountId !== c.accountId) {
      cached = { token: c.token, accountId: c.accountId, api: new CfApi(cfClient(c.token), c.accountId) };
    }
    return cached.api;
  };

  const tunnels = new TunnelRepo(db);
  const dns = new DnsRepo(db);
  const events = new EventRepo(db);
  return {
    config, db, settings, backend, tunnels, dns, events, cfClient, api,
    admin: new AdminRepo(db),
    sessions: new SessionStore(db),
    sampler: new MetricsSampler(),
    service: new TunnelService({ api, backend, tunnels, dns, events }),
    latestVersion: overrides.latestVersion ?? (() => latestCloudflaredVersion()),
  };
}
