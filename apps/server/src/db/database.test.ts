import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, openDatabase } from './database';

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
    expect((db.prepare('select max(version) v from schema_version').get() as { v: number }).v).toBe(MIGRATIONS.length);
  });
  it('binds tunnels of a single-account install to that account', () => {
    // A v0.2.0 database: schema version 1, the chosen account in settings.
    const path = join(mkdtempSync(join(tmpdir(), 'tm-')), 'data.db');
    const old = new DatabaseSync(path);
    old.exec('create table schema_version (version integer primary key)');
    old.exec(MIGRATIONS[0]!);
    old.exec("insert into schema_version values (1); insert into settings values ('cf_account_id', '" + 'a'.repeat(32) + "');");
    old.exec("insert into tunnels (id, metrics_port) values ('t1', 20241)");
    old.close();
    const db = openDatabase(path);
    expect(db.prepare("select account_id from tunnels where id = 't1'").get()).toEqual({ account_id: 'a'.repeat(32) });
  });
  it('names the tunnel of events recorded before names were stored', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tm-')), 'data.db');
    const old = new DatabaseSync(path);
    old.exec('create table schema_version (version integer primary key)');
    old.exec(MIGRATIONS[0]!);
    old.exec(MIGRATIONS[1]!);
    old.exec('insert into schema_version values (1), (2)');
    old.exec(`insert into events (tunnel_id, type, message, created_at) values
      ('t1', 'created', 'Tunnel "home" created', 1), ('t1', 'deleted', 'Tunnel deleted', 2), ('t2', 'deleted', 'Tunnel deleted', 3)`);
    old.close();
    const db = openDatabase(path);
    expect(db.prepare('select tunnel_id, tunnel_name from events order by id').all()).toEqual([
      { tunnel_id: 't1', tunnel_name: 'home' }, { tunnel_id: 't1', tunnel_name: 'home' }, { tunnel_id: 't2', tunnel_name: null },
    ]);
  });
});
