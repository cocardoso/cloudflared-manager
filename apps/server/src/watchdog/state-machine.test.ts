import { describe, expect, it } from 'vitest';
import { BASE_BACKOFF_MS, MAX_RESTARTS, step, type WdState } from './state-machine';

const init: WdState = { state: 'healthy', degradedSince: null, restartAttempts: 0, nextRestartAt: null };
const TOL = 120_000;
const run = (s: WdState, now: number, healthy: boolean, internet = true) => step(s, { now, healthy, internet, toleranceMs: TOL });

describe('watchdog state machine', () => {
  it('stays healthy', () => {
    expect(run(init, 0, true)).toEqual({ next: init, actions: [] });
  });
  it('degrades then restarts after tolerance', () => {
    let r = run(init, 0, false);
    expect(r.next.state).toBe('degraded');
    expect(r.actions).toEqual(['event-degraded']);
    r = run(r.next, TOL - 1, false);
    expect(r.actions).toEqual([]);
    r = run(r.next, TOL, false);
    expect(r.next).toMatchObject({ state: 'restarting', restartAttempts: 1, nextRestartAt: TOL + BASE_BACKOFF_MS });
    expect(r.actions).toEqual(['restart']);
  });
  it('backs off exponentially and gives up after MAX_RESTARTS', () => {
    let s: WdState = { state: 'restarting', degradedSince: 0, restartAttempts: 1, nextRestartAt: 30_000 };
    const restarts: number[] = [];
    let now = 30_000;
    for (let i = 0; i < 10 && s.state !== 'failing'; i++) {
      const r = run(s, now, false);
      if (r.actions.includes('restart')) restarts.push(now);
      if (r.next.state === 'failing') expect(r.actions).toEqual(['event-failing']);
      s = r.next;
      now = s.nextRestartAt ?? now;
    }
    expect(s.state).toBe('failing');
    expect(restarts.length).toBe(MAX_RESTARTS - 1);
    expect(restarts[1]! - restarts[0]!).toBe(2 * BASE_BACKOFF_MS);
  });
  it('failing stops restarting but recovers when the tunnel comes back by itself', () => {
    const s: WdState = { state: 'failing', degradedSince: 0, restartAttempts: 5, nextRestartAt: null };
    expect(run(s, 1e9, false)).toEqual({ next: s, actions: [] });
    expect(run(s, 1e9, true)).toEqual({ next: init, actions: ['event-recovered'] });
  });
  it('recovers and resets', () => {
    const s: WdState = { state: 'restarting', degradedSince: 0, restartAttempts: 3, nextRestartAt: 5 };
    expect(run(s, 10, true)).toEqual({ next: init, actions: ['event-recovered'] });
  });
  it('does not restart or count without internet', () => {
    let r = run(init, 0, false, false);
    expect(r.actions).toEqual(['event-no-connectivity']);
    for (let t = 0; t < 10 * TOL; t += 30_000) {
      r = run(r.next, t, false, false);
      expect(r.actions).toEqual([]);
    }
    expect(r.next.restartAttempts).toBe(0);
    expect(r.next.state).toBe('degraded');
  });
  it('tolerance restarts from when internet came back', () => {
    let r = run(init, 0, false, false);
    r = run(r.next, 10 * TOL, false, false);
    r = run(r.next, 10 * TOL + 30_000, false, true);
    expect(r.actions).toEqual([]);
    r = run(r.next, 11 * TOL, false, true);
    expect(r.actions).toEqual(['restart']);
  });
});
