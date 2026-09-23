import type { EventType, TunnelEvent } from '@tm/shared';
import type { Db } from '../db/database';

export class EventRepo {
  constructor(private db: Db, private now: () => number = Date.now) {}

  add(tunnelId: string | null, type: EventType, message: string) {
    this.db
      .prepare('insert into events (tunnel_id, type, message, created_at) values (?, ?, ?, ?)')
      .run(tunnelId, type, message, this.now());
  }

  /** Newest first. */
  list({ tunnelId, limit = 100 }: { tunnelId?: string; limit?: number } = {}): TunnelEvent[] {
    const rows = (
      tunnelId
        ? this.db.prepare('select * from events where tunnel_id = ? order by id desc limit ?').all(tunnelId, limit)
        : this.db.prepare('select * from events order by id desc limit ?').all(limit)
    ) as { id: number; tunnel_id: string | null; type: EventType; message: string; created_at: number }[];
    return rows.map((r) => ({
      id: r.id, tunnelId: r.tunnel_id, type: r.type, message: r.message, createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  prune(maxAgeMs = 30 * 24 * 3600e3) {
    this.db.prepare('delete from events where created_at < ?').run(this.now() - maxAgeMs);
  }
}
