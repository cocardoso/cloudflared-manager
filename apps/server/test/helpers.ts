import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountDirectory } from '../src/cloudflare/account-directory';
import { CfApi } from '../src/cloudflare/api';
import { CfClient } from '../src/cloudflare/client';
import { openDatabase } from '../src/db/database';
import { EventRepo } from '../src/events/event-repo';
import { FakeBackend } from '../src/services/fake-backend';
import { DnsRepo } from '../src/tunnels/dns-repo';
import { TunnelRepo } from '../src/tunnels/tunnel-repo';
import { TunnelService } from '../src/tunnels/tunnel-service';
import { FAKE_ACCOUNT, SECOND_ACCOUNT, startFakeCloudflare } from './fake-cloudflare';

/** A TunnelService wired to a fake Cloudflare; `second` adds the "Second Org" account to the token. */
export async function makeTunnelEnv(opts: { second?: boolean } = {}) {
  const cf = await startFakeCloudflare();
  if (opts.second) cf.state.addSecondAccount();
  const db = openDatabase(':memory:');
  const backend = new FakeBackend(mkdtempSync(join(tmpdir(), 'tm-')));
  const client = new CfClient({ token: cf.token, baseUrl: cf.baseUrl });
  const accounts = new AccountDirectory(() => client);
  const apiFor = (accountId: string) => new CfApi(client, accountId);
  const repos = { tunnels: new TunnelRepo(db), dns: new DnsRepo(db), events: new EventRepo(db) };
  const used: string[] = [];
  const makeService = () => new TunnelService({ api: apiFor, accounts, backend, ...repos, onAccountUsed: (id) => used.push(id) });
  const service = makeService();
  return {
    cf, db, backend, accounts, service, makeService, used, ...repos,
    /** Direct API access to "Home Lab" and "Second Org". */
    api: apiFor(FAKE_ACCOUNT.id),
    api2: apiFor(SECOND_ACCOUNT.id),
  };
}
