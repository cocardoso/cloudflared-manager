import { AppError } from '../errors';
import type { CfClient } from './client';
import type { CfAccount, CfZone } from './types';

export interface AccountInfo { id: string; name: string; zones: CfZone[] }

/**
 * Every account the stored token reaches, with its zones. GET /accounts comes back empty for tokens
 * without "Account Settings: Read", so accounts are also collected from the zones the token can read.
 */
export interface DirectoryOptions {
  ttlMs?: number;
  /** How long a failed discovery is answered from cache, so an outage does not trigger one per request. */
  failureTtlMs?: number;
  now?: () => number;
  /** Active accounts; all reachable accounts are active when omitted. */
  isEnabled?: (accountId: string) => boolean;
  onDiscovered?: (accounts: AccountInfo[]) => void;
}

export class AccountDirectory {
  private cache: { token: string; at: number; failed: boolean; value: Promise<AccountInfo[]> } | null = null;
  private ttlMs: number;
  private failureTtlMs: number;
  private now: () => number;

  constructor(private client: () => CfClient, private opts: DirectoryOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.failureTtlMs = opts.failureTtlMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  /** Every account the token reaches, active or not. */
  listAll(): Promise<AccountInfo[]> {
    const c = this.client();
    const e = this.cache;
    const fresh = e && e.token === c.token && this.now() - e.at <= (e.failed ? this.failureTtlMs : this.ttlMs);
    if (!fresh) {
      const value = discover(c);
      const entry = { token: c.token, at: this.now(), failed: false, value };
      this.cache = entry;
      value.then(
        (l) => {
          try {
            this.opts.onDiscovered?.(l);
          } catch {
            // Remembering names is best effort; discovery itself succeeded.
          }
        },
        () => {
          entry.failed = true;
          entry.at = this.now();
        },
      );
    }
    return this.cache!.value;
  }

  /** The accounts the app works with. If none of the chosen ones is reachable anymore, every account is. */
  async list(): Promise<AccountInfo[]> {
    const all = await this.listAll();
    const active = this.opts.isEnabled ? all.filter((a) => this.opts.isEnabled!(a.id)) : all;
    return active.length ? active : all;
  }

  /** Any reachable account, active or not: tunnels running here stay manageable when their account is turned off. */
  async getAny(accountId: string): Promise<AccountInfo> {
    const a = (await this.listAll()).find((x) => x.id === accountId);
    if (!a) throw new AppError('ACCOUNT_NOT_FOUND', 'Account is not reachable with this token', 404, { accountId });
    return a;
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
  const [listed, zones] = await Promise.all([
    // Some tokens may not list accounts at all; their accounts still show up on their zones.
    c.paginate<CfAccount>('/accounts?per_page=50').catch((e) => {
      if (e instanceof AppError && e.code === 'CF_PERMISSION_MISSING') return [] as CfAccount[];
      throw e;
    }),
    c.paginate<CfZone>('/zones?per_page=50'),
  ]);
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
