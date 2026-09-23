import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export const MIGRATIONS: string[] = [
  `
  create table admin (id integer primary key check (id = 1), username text not null, password_hash text not null);
  create table sessions (token_hash text primary key, expires_at integer not null);
  create table settings (key text primary key, value text not null);
  create table tunnels (
    id text primary key,
    metrics_port integer not null unique,
    keep_alive integer not null default 1,
    tolerance_minutes integer not null default 2,
    log_level text not null default 'info',
    protocol text not null default 'auto',
    watchdog_state text not null default 'healthy',
    degraded_since integer,
    restart_attempts integer not null default 0,
    next_restart_at integer
  );
  create table managed_dns (
    record_id text primary key, zone_id text not null, hostname text not null unique, tunnel_id text not null
  );
  create table events (
    id integer primary key autoincrement, tunnel_id text, type text not null, message text not null, created_at integer not null
  );
  create index events_tunnel on events(tunnel_id, created_at);
  `,
  // Multiple accounts: each local tunnel records its account; single-account installs keep the one they chose.
  `
  alter table tunnels add column account_id text;
  update tunnels set account_id = (select value from settings where key = 'cf_account_id');
  `,
  // Events keep the tunnel's name so they stay readable after the tunnel is deleted. Older events
  // take it from their tunnel's 'Tunnel "<name>" created/adopted' message (8 characters before, 9 after).
  `
  alter table events add column tunnel_name text;
  update events set tunnel_name = substr(message, 9, length(message) - 17)
    where type in ('created', 'adopted') and message like 'Tunnel "%';
  update events set tunnel_name = (
    select e.tunnel_name from events e where e.tunnel_id = events.tunnel_id and e.tunnel_name is not null order by e.id desc limit 1
  ) where tunnel_name is null and tunnel_id is not null;
  `,
];

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec('create table if not exists schema_version (version integer primary key)');
  const current = (db.prepare('select coalesce(max(version), 0) v from schema_version').get() as { v: number }).v;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('begin');
    try {
      db.exec(MIGRATIONS[i]!);
      db.prepare('insert into schema_version (version) values (?)').run(i + 1);
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
  }
  return db;
}
