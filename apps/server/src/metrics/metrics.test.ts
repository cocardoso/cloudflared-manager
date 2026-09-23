import { describe, expect, it } from 'vitest';
import { parsePrometheus } from './prometheus';
import { MetricsSampler } from './sampler';

const text = (req: number, err: number) => `# HELP x
cloudflared_tunnel_total_requests ${req}
cloudflared_tunnel_request_errors{a="1"} ${err}
cloudflared_tunnel_ha_connections 4
`;

describe('parsePrometheus', () => {
  it('parses and sums series', () => {
    const m = parsePrometheus('a{x="1"} 1\na{x="2"} 2\nb 3.5\n# c 9');
    expect(m.get('a')).toBe(3);
    expect(m.get('b')).toBe(3.5);
    expect(m.has('#')).toBe(false);
  });
});

describe('MetricsSampler', () => {
  it('computes deltas and handles counter resets', async () => {
    let now = 0;
    let body = text(100, 1);
    const s = new MetricsSampler(async () => body, () => now);
    await s.sample('t', 1);
    now = 60_000;
    body = text(160, 3);
    await s.sample('t', 1);
    now = 120_000;
    body = text(10, 0);
    await s.sample('t', 1);
    const snap = s.snapshot('t');
    expect(snap.points.map((p) => [p.requests, p.errors])).toEqual([[60, 2], [10, 0]]);
    expect(snap.haConnections).toBe(4);
  });
  it('keeps at most 60 points and survives fetch failure', async () => {
    let now = 0;
    const s = new MetricsSampler(async () => (now === 5 * 60_000 ? null : text(now / 1000, 0)), () => now);
    for (let i = 0; i < 70; i++) {
      await s.sample('t', 1);
      now += 60_000;
    }
    expect(s.snapshot('t').points.length).toBe(60);
  });
  it('returns empty snapshot for unknown tunnel', () => {
    expect(new MetricsSampler(async () => null).snapshot('x')).toEqual({ points: [], haConnections: null });
  });
});
