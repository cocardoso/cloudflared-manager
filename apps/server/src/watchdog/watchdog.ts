import type { EventType } from '@tm/shared';
import type { EventRepo } from '../events/event-repo';
import type { ServiceBackend } from '../services/backend';
import type { TunnelRepo } from '../tunnels/tunnel-repo';
import { MAX_RESTARTS, step, type WdAction } from './state-machine';

interface Deps {
  tunnels: TunnelRepo;
  backend: ServiceBackend;
  events: EventRepo;
  probeReady: (port: number) => Promise<boolean>;
  probeInternet: () => Promise<boolean>;
  now?: () => number;
}

const EVENTS: Partial<Record<WdAction, [EventType, string]>> = {
  'event-degraded': ['watchdog-degraded', 'Tunnel unhealthy'],
  'event-recovered': ['watchdog-recovered', 'Tunnel recovered'],
  'event-failing': ['watchdog-failing', `Gave up after ${MAX_RESTARTS} restarts`],
  'event-no-connectivity': ['no-connectivity', 'No connectivity to Cloudflare; waiting'],
};

export class Watchdog {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private d: Deps) {}

  private now() {
    return (this.d.now ?? Date.now)();
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      this.d.events.prune();
      const internet = await this.d.probeInternet();
      for (const row of this.d.tunnels.list()) {
        if (!row.keepAlive || !this.d.backend.isInstalled(row.id)) continue;
        try {
          const st = await this.d.backend.status(row.id);
          // 'inactive' means stopped on purpose; 'failed' means systemd gave up and is ours to handle.
          if (st.state === 'inactive') continue;
          const healthy = st.state === 'active' && (await this.d.probeReady(row.metricsPort));
          // Re-read after the awaits: a manual start/restart may have reset the state meanwhile.
          const cur = this.d.tunnels.get(row.id);
          if (!cur || !cur.keepAlive) continue;
          const { next, actions } = step(
            { state: cur.watchdogState, degradedSince: cur.degradedSince, restartAttempts: cur.restartAttempts, nextRestartAt: cur.nextRestartAt },
            { now: this.now(), healthy, internet, toleranceMs: cur.toleranceMinutes * 60_000 },
          );
          this.d.tunnels.update(row.id, {
            watchdogState: next.state, degradedSince: next.degradedSince, restartAttempts: next.restartAttempts, nextRestartAt: next.nextRestartAt,
          });
          for (const a of actions) {
            if (a === 'restart') {
              await this.d.backend.restart(row.id);
              this.d.events.add(row.id, 'watchdog-restart', `Restart attempt ${next.restartAttempts}/${MAX_RESTARTS}`);
            } else {
              const [type, message] = EVENTS[a]!;
              this.d.events.add(row.id, type, message);
            }
          }
        } catch (e) {
          this.d.events.add(row.id, 'watchdog-degraded', `Watchdog error: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 30_000) {
    this.stop();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
