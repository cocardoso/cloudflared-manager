import type { LogLevel, Protocol, WatchdogState } from '@tm/shared';
import type { Db } from '../db/database';

export interface TunnelRow {
  id: string;
  /** Null only for rows the migration could not attribute; resolved on first use. */
  accountId: string | null;
  metricsPort: number;
  keepAlive: boolean;
  toleranceMinutes: number;
  logLevel: LogLevel;
  protocol: Protocol;
  watchdogState: WatchdogState;
  degradedSince: number | null;
  restartAttempts: number;
  nextRestartAt: number | null;
  /** The watchdog does not count the tunnel as unhealthy before this time (ms). */
  graceUntil: number | null;
}

interface Raw {
  id: string; account_id: string | null; metrics_port: number; keep_alive: number; tolerance_minutes: number; log_level: string; protocol: string;
  watchdog_state: string; degraded_since: number | null; restart_attempts: number; next_restart_at: number | null;
  grace_until: number | null;
}

const toRow = (r: Raw): TunnelRow => ({
  id: r.id,
  accountId: r.account_id,
  metricsPort: r.metrics_port,
  keepAlive: !!r.keep_alive,
  toleranceMinutes: r.tolerance_minutes,
  logLevel: r.log_level as LogLevel,
  protocol: r.protocol as Protocol,
  watchdogState: r.watchdog_state as WatchdogState,
  degradedSince: r.degraded_since,
  restartAttempts: r.restart_attempts,
  nextRestartAt: r.next_restart_at,
  graceUntil: r.grace_until,
});

const COLS: Record<keyof Omit<TunnelRow, 'id'>, string> = {
  accountId: 'account_id', metricsPort: 'metrics_port', keepAlive: 'keep_alive', toleranceMinutes: 'tolerance_minutes', logLevel: 'log_level',
  protocol: 'protocol', watchdogState: 'watchdog_state', degradedSince: 'degraded_since', restartAttempts: 'restart_attempts',
  nextRestartAt: 'next_restart_at', graceUntil: 'grace_until',
};

/** Local runtime parameters of tunnels that run on this host. */
export class TunnelRepo {
  constructor(private db: Db) {}

  list() {
    return (this.db.prepare('select * from tunnels order by id').all() as unknown as Raw[]).map(toRow);
  }

  get(id: string) {
    const r = this.db.prepare('select * from tunnels where id = ?').get(id) as unknown as Raw | undefined;
    return r ? toRow(r) : null;
  }

  nextMetricsPort() {
    const r = this.db.prepare('select max(metrics_port) m from tunnels').get() as { m: number | null };
    return Math.max(20241, (r.m ?? 20240) + 1);
  }

  insert(id: string, metricsPort: number, accountId: string) {
    this.db.prepare('insert into tunnels (id, metrics_port, account_id) values (?, ?, ?)').run(id, metricsPort, accountId);
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<TunnelRow, 'id'>>) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof typeof COLS, unknown][];
    if (!entries.length) return;
    const sql = `update tunnels set ${entries.map(([k]) => `${COLS[k]} = ?`).join(', ')} where id = ?`;
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v) as string | number | null);
    this.db.prepare(sql).run(...values, id);
  }

  delete(id: string) {
    this.db.prepare('delete from tunnels where id = ?').run(id);
  }
}
