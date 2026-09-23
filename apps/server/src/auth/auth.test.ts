import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { hashPassword, verifyPassword } from './password';
import { AdminRepo, SessionStore } from './sessions';

describe('password', () => {
  it('verifies correct password and rejects wrong', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('rejects malformed stored hash', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('SessionStore', () => {
  it('creates, validates, expires and revokes', () => {
    let now = 1_000;
    const s = new SessionStore(openDatabase(':memory:'), 100, () => now);
    const t = s.create();
    expect(s.validate(t)).toBe(true);
    now = 1_101;
    expect(s.validate(t)).toBe(false);
    now = 1_000;
    const t2 = s.create();
    s.revoke(t2);
    expect(s.validate(t2)).toBe(false);
  });
  it('stores only token hash', () => {
    const db = openDatabase(':memory:');
    const t = new SessionStore(db).create();
    const row = db.prepare('select token_hash from sessions').get() as { token_hash: string };
    expect(row.token_hash).not.toBe(t);
  });
});

describe('AdminRepo', () => {
  it('creates single admin', () => {
    const r = new AdminRepo(openDatabase(':memory:'));
    expect(r.exists()).toBe(false);
    r.create('admin', 'h');
    expect(r.exists()).toBe(true);
    expect(() => r.create('other', 'h')).toThrow();
  });
});
