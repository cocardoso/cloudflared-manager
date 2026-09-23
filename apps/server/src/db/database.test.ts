import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database';

describe('openDatabase', () => {
  it('creates all tables', () => {
    const db = openDatabase(':memory:');
    const names = (db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['admin', 'sessions', 'settings', 'tunnels', 'managed_dns', 'events', 'schema_version']));
  });
  it('is idempotent on the same file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tm-')), 'data.db');
    openDatabase(path).close();
    const db = openDatabase(path);
    expect((db.prepare('select max(version) v from schema_version').get() as { v: number }).v).toBe(1);
  });
});
