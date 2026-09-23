import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { SettingsRepo } from './settings-repo';

describe('SettingsRepo', () => {
  it('stores cloudflare token encrypted and exposes suffix', () => {
    const db = openDatabase(':memory:');
    const repo = new SettingsRepo(db, Buffer.alloc(32, 7));
    repo.setCloudflare({ token: 'abcdefghijklmnopqrstuvwxyz1234', accountId: 'a'.repeat(32), accountName: 'Home' });
    const raw = (db.prepare("select value from settings where key='cf_token'").get() as { value: string }).value;
    expect(raw).not.toContain('abcdef');
    expect(repo.getCloudflare()?.token).toBe('abcdefghijklmnopqrstuvwxyz1234');
    expect(repo.tokenSuffix()).toBe('1234');
  });
  it('returns null when not configured', () => {
    expect(new SettingsRepo(openDatabase(':memory:'), Buffer.alloc(32)).getCloudflare()).toBeNull();
  });
});
