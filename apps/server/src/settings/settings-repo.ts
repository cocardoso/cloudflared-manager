import { decrypt, encrypt } from '../crypto/secret-box';
import type { Db } from '../db/database';

export interface CloudflareCredentials { token: string }

export class SettingsRepo {
  constructor(private db: Db, private key: Buffer) {}

  get(key: string): string | null {
    const r = this.db.prepare('select value from settings where key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  set(key: string, value: string) {
    this.db
      .prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
      .run(key, value);
  }

  setCloudflare(c: CloudflareCredentials) {
    this.set('cf_token', encrypt(this.key, c.token));
    this.set('cf_token_suffix', c.token.slice(-4));
  }

  /** Connected means a token is stored; the accounts are whatever that token reaches. */
  getCloudflare(): CloudflareCredentials | null {
    const t = this.get('cf_token');
    return t ? { token: decrypt(this.key, t) } : null;
  }

  lastAccountId() {
    return this.get('last_account_id');
  }

  setLastAccountId(id: string) {
    this.set('last_account_id', id);
  }

  /** Ids of the active accounts, or null when every reachable account is active. */
  enabledAccounts(): string[] | null {
    const v = this.get('enabled_accounts');
    return v ? (JSON.parse(v) as string[]) : null;
  }

  setEnabledAccounts(ids: string[] | null) {
    if (ids) this.set('enabled_accounts', JSON.stringify(ids));
    else this.db.prepare("delete from settings where key = 'enabled_accounts'").run();
  }

  /** Last known name of every account seen, to name accounts the token no longer reaches. */
  accountNames(): Record<string, string> {
    return JSON.parse(this.get('account_names') ?? '{}') as Record<string, string>;
  }

  rememberAccountNames(list: { id: string; name: string }[]) {
    const names = this.accountNames();
    for (const a of list) names[a.id] = a.name;
    this.set('account_names', JSON.stringify(names));
  }

  tokenSuffix() {
    return this.get('cf_token_suffix');
  }
}
