import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CfApi } from '../src/cloudflare/api';
import { CfClient } from '../src/cloudflare/client';
import { openDatabase } from '../src/db/database';
import { EventRepo } from '../src/events/event-repo';
import { FakeBackend } from '../src/services/fake-backend';
import { DnsRepo } from '../src/tunnels/dns-repo';
import { TunnelRepo } from '../src/tunnels/tunnel-repo';
import { TunnelService } from '../src/tunnels/tunnel-service';
import { FAKE_ACCOUNT, startFakeCloudflare } from './fake-cloudflare';

export async function makeTunnelEnv() {
  const cf = await startFakeCloudflare();
  const db = openDatabase(':memory:');
  const backend = new FakeBackend(mkdtempSync(join(tmpdir(), 'tm-')));
  const api = new CfApi(new CfClient({ token: cf.token, baseUrl: cf.baseUrl }), FAKE_ACCOUNT.id);
  const repos = { tunnels: new TunnelRepo(db), dns: new DnsRepo(db), events: new EventRepo(db) };
  const service = new TunnelService({ api: () => api, backend, ...repos });
  return { cf, db, backend, api, service, ...repos };
}
