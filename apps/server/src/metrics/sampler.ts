import type { MetricsPoint, MetricsSnapshot } from '@tm/shared';
import { parsePrometheus } from './prometheus';

const WINDOW = 60;

interface Series { last: { req: number; err: number } | null; points: MetricsPoint[]; ha: number | null }

export const fetchMetricsText = async (port: number) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? r.text() : null;
  } catch {
    return null;
  }
};

/** Keeps an in-memory, per-minute window of request/error deltas per tunnel. */
export class MetricsSampler {
  private series = new Map<string, Series>();

  constructor(
    private fetchText: (port: number) => Promise<string | null> = fetchMetricsText,
    private now: () => number = Date.now,
  ) {}

  async sample(id: string, port: number) {
    const s = this.series.get(id) ?? { last: null, points: [], ha: null };
    this.series.set(id, s);
    const text = await this.fetchText(port);
    if (!text) {
      s.ha = null;
      return;
    }
    const m = parsePrometheus(text);
    const req = m.get('cloudflared_tunnel_total_requests') ?? 0;
    const err = m.get('cloudflared_tunnel_request_errors') ?? 0;
    s.ha = m.get('cloudflared_tunnel_ha_connections') ?? null;
    if (s.last) {
      // A counter going down means cloudflared restarted: the new value is the delta.
      s.points.push({
        t: this.now(),
        requests: req >= s.last.req ? req - s.last.req : req,
        errors: err >= s.last.err ? err - s.last.err : err,
      });
      if (s.points.length > WINDOW) s.points.splice(0, s.points.length - WINDOW);
    }
    s.last = { req, err };
  }

  snapshot(id: string): MetricsSnapshot {
    const s = this.series.get(id);
    return { points: s?.points ?? [], haConnections: s?.ha ?? null };
  }

  forget(id: string) {
    this.series.delete(id);
  }
}
