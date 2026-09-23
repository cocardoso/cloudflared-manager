import { AppError } from '../errors';
import type { CfClient } from './client';
import type { CfAccount, CfZone } from './types';

export interface AccountInfo { id: string; name: string; zones: CfZone[] }

/**
 * Every account the stored token reaches, with its zones. GET /accounts comes back empty for tokens
 * without "Account Settings: Read", so accounts are also collected from the zones the token can read.
 */
export class AccountDirectory {
  private cache: { token: string; at: number; value: Promise<AccountInfo[]> } | null = null;
  private ttlMs: number;
  private now: () => number;

  constructor(private client: () => CfClient, opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  list(): Promise<AccountInfo[]> {
    const c = this.client();
    const fresh = this.cache && this.cache.token === c.token && this.now() - this.cache.at <= this.ttlMs;
    if (!fresh) {
      const value = discover(c);
      const entry = { token: c.token, at: this.now(), value };
      this.cache = entry;
      // A failed discovery is not cached.
      value.catch(() => {
        if (this.cache === entry) this.cache = null;
      });
    }
    return this.cache!.value;
  }

  async get(accountId: string): Promise<AccountInfo> {
    const a = (await this.list()).find((x) => x.id === accountId);
    if (!a) throw new AppError('ACCOUNT_NOT_FOUND', 'Account is not reachable with this token', 404, { accountId });
    return a;
  }

  invalidate() {
    this.cache = null;
  }
}

async function discover(c: CfClient): Promise<AccountInfo[]> {
  const [listed, zones] = await Promise.all([c.paginate<CfAccount>('/accounts?per_page=50'), c.paginate<CfZone>('/zones?per_page=50')]);
  const byId = new Map<string, AccountInfo>();
  for (const a of listed) byId.set(a.id, { id: a.id, name: a.name, zones: [] });
  for (const z of zones) {
    if (!z.account?.id) continue;
    const a = byId.get(z.account.id) ?? { id: z.account.id, name: z.account.name, zones: [] };
    a.zones.push({ id: z.id, name: z.name, status: z.status });
    byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
