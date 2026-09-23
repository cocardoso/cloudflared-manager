import type { Db } from '../db/database';

/** DNS records created (or adopted) by this app — the only ones it will ever delete. */
export interface ManagedDns { recordId: string; zoneId: string; hostname: string; tunnelId: string }

interface Raw { record_id: string; zone_id: string; hostname: string; tunnel_id: string }
const toRow = (r: Raw): ManagedDns => ({ recordId: r.record_id, zoneId: r.zone_id, hostname: r.hostname, tunnelId: r.tunnel_id });

export class DnsRepo {
  constructor(private db: Db) {}

  all() {
    return (this.db.prepare('select * from managed_dns order by hostname').all() as unknown as Raw[]).map(toRow);
  }

  byHostname(h: string) {
    const r = this.db.prepare('select * from managed_dns where hostname = ?').get(h) as unknown as Raw | undefined;
    return r ? toRow(r) : null;
  }

  byTunnel(id: string) {
    return (this.db.prepare('select * from managed_dns where tunnel_id = ?').all(id) as unknown as Raw[]).map(toRow);
  }

  upsert(m: ManagedDns) {
    this.db.prepare('delete from managed_dns where hostname = ? or record_id = ?').run(m.hostname, m.recordId);
    this.db
      .prepare('insert into managed_dns (record_id, zone_id, hostname, tunnel_id) values (?, ?, ?, ?)')
      .run(m.recordId, m.zoneId, m.hostname, m.tunnelId);
  }

  delete(recordId: string) {
    this.db.prepare('delete from managed_dns where record_id = ?').run(recordId);
  }
}
