import type { WatchdogState } from '@tm/shared';

export interface WdInput { now: number; healthy: boolean; internet: boolean; toleranceMs: number }
export interface WdState { state: WatchdogState; degradedSince: number | null; restartAttempts: number; nextRestartAt: number | null }
export type WdAction = 'restart' | 'event-degraded' | 'event-recovered' | 'event-failing' | 'event-no-connectivity';

export const MAX_RESTARTS = 5;
export const BASE_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 600_000;

const HEALTHY: WdState = { state: 'healthy', degradedSince: null, restartAttempts: 0, nextRestartAt: null };

export const backoff = (attempt: number) => Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);

/** Pure keep-alive policy: one call per watchdog tick and tunnel. */
export function step(s: WdState, i: WdInput): { next: WdState; actions: WdAction[] } {
  if (s.state === 'disabled') return { next: s, actions: [] };

  if (i.healthy) {
    return s.state === 'healthy' ? { next: s, actions: [] } : { next: { ...HEALTHY }, actions: ['event-recovered'] };
  }

  // After giving up, never restart again on our own; a recovery or a manual start clears it.
  if (s.state === 'failing') return { next: s, actions: [] };

  // Restarting cannot fix a missing uplink: wait, and count tolerance from when connectivity returns.
  if (!i.internet) {
    const actions: WdAction[] = s.state === 'healthy' ? ['event-no-connectivity'] : [];
    return { next: { state: 'degraded', degradedSince: i.now, restartAttempts: 0, nextRestartAt: null }, actions };
  }

  if (s.state === 'healthy') return { next: { ...s, state: 'degraded', degradedSince: i.now }, actions: ['event-degraded'] };

  if (s.state === 'degraded') {
    if (i.now - (s.degradedSince ?? i.now) < i.toleranceMs) return { next: s, actions: [] };
    return { next: { ...s, state: 'restarting', restartAttempts: 1, nextRestartAt: i.now + backoff(1) }, actions: ['restart'] };
  }

  // restarting
  if (i.now < (s.nextRestartAt ?? 0)) return { next: s, actions: [] };
  if (s.restartAttempts >= MAX_RESTARTS) return { next: { ...s, state: 'failing', nextRestartAt: null }, actions: ['event-failing'] };
  const n = s.restartAttempts + 1;
  return { next: { ...s, restartAttempts: n, nextRestartAt: i.now + backoff(n) }, actions: ['restart'] };
}
