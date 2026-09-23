import type { EventType, TunnelEvent } from '@tm/shared';
import type { Db } from '../db/database';

export class EventRepo {
  constructor(private db: Db, private now: () => number = Date.now) {}

  /** Without a name, the event inherits the last name recorded for the same tunnel. */
  add(tunnelId: string | null, type: EventType, message: string, tunnelName?: string) {
    const name =
      tunnelName ??
      (tunnelId
        ? ((this.db.prepare('select tunnel_name n from events where tunnel_id = ? and tunnel_name is not null order by id desc limit 1').get(tunnelId) as
            | { n: string }
            | undefined)?.n ?? null)
        : null);
    this.db
      .prepare('insert into events (tunnel_id, type, message, created_at, tunnel_name) values (?, ?, ?, ?, ?)')
      .run(tunnelId, type, message, this.now(), name);
  }

  /** Newest first. */
  list({ tunnelId, limit = 100 }: { tunnelId?: string; limit?: number } = {}): TunnelEvent[] {
    const rows = (
      tunnelId
        ? this.db.prepare('select * from events where tunnel_id = ? order by id desc limit ?').all(tunnelId, limit)
        : this.db.prepare('select * from events order by id desc limit ?').all(limit)
    ) as { id: number; tunnel_id: string | null; tunnel_name: string | null; type: EventType; message: string; created_at: number }[];
    return rows.map((r) => ({
      id: r.id, tunnelId: r.tunnel_id, tunnelName: r.tunnel_name, type: r.type, message: r.message, createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  prune(maxAgeMs = 30 * 24 * 3600e3) {
    this.db.prepare('delete from events where created_at < ?').run(this.now() - maxAgeMs);
  }
}
