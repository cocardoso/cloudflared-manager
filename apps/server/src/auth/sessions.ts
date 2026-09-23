import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/database';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export class AdminRepo {
  constructor(private db: Db) {}

  exists() {
    return !!this.db.prepare('select 1 from admin where id = 1').get();
  }

  create(username: string, passwordHash: string) {
    this.db.prepare('insert into admin (id, username, password_hash) values (1, ?, ?)').run(username, passwordHash);
  }

  get() {
    const r = this.db.prepare('select username, password_hash from admin where id = 1').get() as
      | { username: string; password_hash: string }
      | undefined;
    return r ? { username: r.username, passwordHash: r.password_hash } : null;
  }

  setPasswordHash(hash: string) {
    this.db.prepare('update admin set password_hash = ? where id = 1').run(hash);
  }
}

export class SessionStore {
  constructor(private db: Db, private ttlMs = 7 * 24 * 3600e3, private now: () => number = Date.now) {}

  create(): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('delete from sessions where expires_at <= ?').run(this.now());
    this.db.prepare('insert into sessions (token_hash, expires_at) values (?, ?)').run(sha(token), this.now() + this.ttlMs);
    return token;
  }

  validate(token: string): boolean {
    const r = this.db.prepare('select expires_at from sessions where token_hash = ?').get(sha(token)) as
      | { expires_at: number }
      | undefined;
    return !!r && r.expires_at > this.now();
  }

  revoke(token: string) {
    this.db.prepare('delete from sessions where token_hash = ?').run(sha(token));
  }

  revokeAll() {
    this.db.exec('delete from sessions');
  }
}
