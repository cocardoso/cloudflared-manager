import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/database';
import { EventRepo } from '../events/event-repo';
import { FakeBackend } from '../services/fake-backend';
import { TunnelRepo } from '../tunnels/tunnel-repo';
import { Watchdog } from './watchdog';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';

async function setup() {
  let now = 0;
  let ready = true;
  let internet = true;
  const db = openDatabase(':memory:');
  const tunnels = new TunnelRepo(db);
  const events = new EventRepo(db, () => now);
  const backend = new FakeBackend(mkdtempSync(join(tmpdir(), 'tm-')));
  tunnels.insert(ID, 20241);
  await backend.install(ID, { token: 't', metricsPort: 20241, logLevel: 'info', protocol: 'auto' });
  await backend.start(ID);
  const wd = new Watchdog({ tunnels, backend, events, probeReady: async () => ready, probeInternet: async () => internet, now: () => now });
  const set = (o: { now?: number; ready?: boolean; internet?: boolean }) => {
    now = o.now ?? now;
    ready = o.ready ?? ready;
    internet = o.internet ?? internet;
  };
  return { wd, tunnels, backend, events, set };
}

describe('Watchdog.tick', () => {
  it('restarts unhealthy tunnel after tolerance and records events', async () => {
    const e = await setup();
    e.set({ ready: false });
    await e.wd.tick();
    e.set({ now: 120_000 });
    await e.wd.tick();
    expect(e.backend.calls).toContain(`restart ${ID}`);
    expect(e.tunnels.get(ID)!.watchdogState).toBe('restarting');
    expect(e.events.list({ tunnelId: ID }).map((x) => x.type)).toEqual(['watchdog-restart', 'watchdog-degraded']);
  });
  it('treats a failed unit as unhealthy', async () => {
    const e = await setup();
    e.backend.setState(ID, 'failed');
    await e.wd.tick();
    expect(e.tunnels.get(ID)!.watchdogState).toBe('degraded');
  });
  it('skips tunnels stopped by the user', async () => {
    const e = await setup();
    await e.backend.stop(ID);
    e.set({ ready: false });
    await e.wd.tick();
    expect(e.tunnels.get(ID)!.watchdogState).toBe('healthy');
  });
  it('skips when keepAlive disabled', async () => {
    const e = await setup();
    e.tunnels.update(ID, { keepAlive: false });
    e.set({ ready: false });
    await e.wd.tick();
    e.set({ now: 1e7 });
    await e.wd.tick();
    expect(e.backend.calls).not.toContain(`restart ${ID}`);
  });
  it('never restarts while offline', async () => {
    const e = await setup();
    e.set({ ready: false, internet: false });
    for (let t = 0; t < 3_600_000; t += 30_000) {
      e.set({ now: t });
      await e.wd.tick();
    }
    expect(e.backend.calls).not.toContain(`restart ${ID}`);
    expect(e.events.list({ tunnelId: ID }).map((x) => x.type)).toEqual(['no-connectivity']);
  });
  it('does not undo a manual reset that happens during a tick', async () => {
    const e = await setup();
    e.tunnels.update(ID, { watchdogState: 'restarting', restartAttempts: 2, degradedSince: 0, nextRestartAt: 0 });
    // The user clicks Restart while the watchdog is probing this tunnel.
    const wd = new Watchdog({
      tunnels: e.tunnels, backend: e.backend, events: e.events, probeInternet: async () => true, now: () => 1_000,
      probeReady: async () => {
        e.tunnels.update(ID, { watchdogState: 'healthy', restartAttempts: 0, degradedSince: null, nextRestartAt: null });
        return false;
      },
    });
    await wd.tick();
    expect(e.backend.calls).not.toContain(`restart ${ID}`);
    expect(e.tunnels.get(ID)).toMatchObject({ watchdogState: 'degraded', restartAttempts: 0 });
  });
  it('prunes events older than 30 days', async () => {
    const e = await setup();
    e.events.add(ID, 'started', 'old');
    e.set({ now: 31 * 24 * 3600e3 });
    await e.wd.tick();
    expect(e.events.list({ tunnelId: ID }).find((x) => x.message === 'old')).toBeUndefined();
  });
});
