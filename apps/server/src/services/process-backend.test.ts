import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessBackend } from './process-backend';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';
const ID2 = '7ff42ae2-765d-4adf-8112-31c55c1551ef';
const FAKE = join(import.meta.dirname, '../../test/fake-cloudflared.mjs');
const env = { token: 'secret-token-value', metricsPort: 20241, logLevel: 'info' as const, protocol: 'auto' as const };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backends: ProcessBackend[] = [];

function make(opts: { flags?: string; bin?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tm-proc-'));
  const bin = opts.bin ?? join(dir, 'cloudflared');
  if (!opts.bin) {
    writeFileSync(bin, `#!/bin/sh\n${opts.flags ?? ''} exec node ${FAKE} "$@"\n`);
    chmodSync(bin, 0o755);
  }
  const b = new ProcessBackend({ etcDir: join(dir, 'etc'), bin, restartDelayMs: 50, stopGraceMs: 200 });
  backends.push(b);
  return { b, dir };
}
async function until(fn: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(20);
  }
  throw new Error('condition not met');
}
const text = async (b: ProcessBackend, id = ID) => (await b.logs(id, 1000)).map((l) => l.message).join('\n');

afterEach(async () => {
  await Promise.all(backends.splice(0).map((b) => b.shutdownAll()));
});

describe('ProcessBackend', () => {
  it('starts a supervised process and reports it active', async () => {
    const { b } = make();
    await b.install(ID, env);
    expect((await b.status(ID)).state).toBe('inactive');
    await b.start(ID);
    await until(async () => (await text(b)).includes('Registered tunnel connection'));
    const s = await b.status(ID);
    expect(s.state).toBe('active');
    expect(s.activeSince).toBeTruthy();
  });

  it('reports activating until cloudflared registers a connection', async () => {
    const { b } = make({ flags: 'FAKE_CF_NO_CONNECT=1' });
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await text(b)).includes('Starting tunnel'));
    await sleep(200);
    expect(await b.status(ID)).toMatchObject({ state: 'activating', activeSince: null });
  });
  it('passes the token through the environment, never argv', async () => {
    const { b } = make();
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await text(b)).includes('token-present'));
    const t = await text(b);
    expect(t).toContain('token-present=true');
    expect(t).toContain('metrics=127.0.0.1:20241');
    expect(t).toContain('argv=["--no-autoupdate","tunnel","run"]');
    expect(t).not.toContain('secret-token-value');
  });

  it('restarts a crashed process and counts restarts', async () => {
    const { b } = make({ flags: 'FAKE_CF_CRASH=1' });
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await b.status(ID)).restarts >= 2);
    expect(['active', 'activating']).toContain((await b.status(ID)).state);
  });

  it('keeps an intentionally stopped tunnel stopped', async () => {
    const { b, dir } = make();
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await b.status(ID)).state === 'active');
    await b.stop(ID);
    expect((await b.status(ID)).state).toBe('inactive');
    expect(existsSync(join(dir, 'etc', 'tunnels', `${ID}.stopped`))).toBe(true);
    await sleep(200);
    expect((await b.status(ID)).state).toBe('inactive');
  });

  it('startAll starts only tunnels not stopped on purpose', async () => {
    const { b } = make();
    await b.install(ID, env);
    await b.install(ID2, { ...env, metricsPort: 20242 });
    await b.start(ID2);
    await b.stop(ID2);
    await b.startAll();
    await until(async () => (await b.status(ID)).state === 'active');
    expect((await b.status(ID2)).state).toBe('inactive');
  });

  it('shutdownAll does not mark tunnels as stopped, so they come back on boot', async () => {
    const { b, dir } = make();
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await b.status(ID)).state === 'active');
    await b.shutdownAll();
    expect(existsSync(join(dir, 'etc', 'tunnels', `${ID}.stopped`))).toBe(false);
    const again = new ProcessBackend({ etcDir: join(dir, 'etc'), bin: join(dir, 'cloudflared'), restartDelayMs: 50, stopGraceMs: 200 });
    backends.push(again);
    await again.startAll();
    await until(async () => (await again.status(ID)).state === 'active');
  });

  it('kills a process that ignores SIGTERM after the grace period', async () => {
    const { b } = make({ flags: 'FAKE_CF_IGNORE_TERM=1' });
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await text(b)).includes('Starting tunnel'));
    const started = Date.now();
    await b.stop(ID);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect((await b.status(ID)).state).toBe('inactive');
  });

  it('reports failed and retries slowly when the binary is missing', async () => {
    const { b } = make({ bin: '/nonexistent/cloudflared' });
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await b.status(ID)).state === 'failed' || (await b.status(ID)).restarts > 0);
    await sleep(150);
    expect((await b.status(ID)).restarts).toBeLessThanOrEqual(4);
  });

  it('streams new log lines and caps the buffer', async () => {
    const { b } = make();
    await b.install(ID, env);
    const got: string[] = [];
    const off = b.followLogs(ID, (l) => got.push(l.message));
    await b.start(ID);
    await until(() => got.some((m) => m.includes('Starting tunnel')));
    expect((await b.logs(ID, 10)).find((l) => l.message.includes('Starting tunnel'))?.level).toBe('info');
    off();
    const n = got.length;
    await b.restart(ID);
    await sleep(200);
    expect(got.length).toBe(n);
  });

  it('uninstalls idempotently, reports version and refuses self-update', async () => {
    const { b, dir } = make();
    await b.install(ID, env);
    await b.start(ID);
    await b.uninstall(ID);
    await b.uninstall(ID);
    expect(existsSync(join(dir, 'etc', 'tunnels', `${ID}.env`))).toBe(false);
    expect((await b.status(ID)).state).toBe('not-installed');
    expect(await b.cloudflaredVersion()).toBe('2026.9.1');
    expect(b.canSelfUpdate).toBe(false);
    await expect(b.upgradeCloudflared()).rejects.toMatchObject({ code: 'CLOUDFLARED_UPDATE_UNSUPPORTED' });
  });

  it('a stop issued while a restart is in progress wins', async () => {
    const { b, dir } = make({ flags: 'FAKE_CF_IGNORE_TERM=1' });
    await b.install(ID, env);
    await b.start(ID);
    await until(async () => (await text(b)).includes('Starting tunnel'));
    const restarting = b.restart(ID); // waits for the grace period before starting again
    await sleep(20);
    await b.stop(ID);
    await restarting;
    await sleep(150);
    expect((await b.status(ID)).state).toBe('inactive');
    expect(existsSync(join(dir, 'etc', 'tunnels', `${ID}.stopped`))).toBe(true);
  });

  it('boots the valid tunnels even when an entry is broken', async () => {
    const { b, dir } = make();
    await b.install(ID, env);
    writeFileSync(join(dir, 'etc', 'tunnels', 'not-a-uuid.env'), 'TUNNEL_TOKEN=x\n');
    await expect(b.startAll()).resolves.toBeUndefined();
    await until(async () => (await b.status(ID)).state === 'active');
  });
});
