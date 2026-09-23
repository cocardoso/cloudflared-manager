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

  tokenSuffix() {
    return this.get('cf_token_suffix');
  }
}
