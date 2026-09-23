import { decrypt, encrypt } from '../crypto/secret-box';
import type { Db } from '../db/database';

export interface CloudflareCredentials { token: string; accountId: string; accountName: string }

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
    this.set('cf_account_id', c.accountId);
    this.set('cf_account_name', c.accountName);
  }

  getCloudflare(): CloudflareCredentials | null {
    const t = this.get('cf_token');
    const a = this.get('cf_account_id');
    if (!t || !a) return null;
    return { token: decrypt(this.key, t), accountId: a, accountName: this.get('cf_account_name') ?? '' };
  }

  tokenSuffix() {
    return this.get('cf_token_suffix');
  }
}
