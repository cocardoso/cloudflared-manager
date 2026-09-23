import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envFilePath, parseEnvFile, renderEnvFile } from './env-file';
import { FakeBackend } from './fake-backend';
import { parseJournalLine, SystemdBackend, type Runner } from './systemd-backend';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';
const env = { token: 'eyJhIjoi', metricsPort: 20241, logLevel: 'info' as const, protocol: 'auto' as const };

describe('env file', () => {
  it('renders and parses', () => {
    const text = renderEnvFile(env);
    expect(text).toContain('TUNNEL_TOKEN=eyJhIjoi');
    expect(text).toContain('TUNNEL_METRICS=127.0.0.1:20241');
    expect(parseEnvFile(text)).toEqual(env);
  });
  it('rejects non-uuid ids', () => {
    expect(() => envFilePath('/etc/tm', '../x')).toThrow();
    expect(envFilePath('/etc/tm', ID)).toBe(`/etc/tm/tunnels/${ID}.env`);
  });
});

describe('SystemdBackend', () => {
  const recorder = () => {
    const calls: string[] = [];
    const run: Runner = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (args.includes('show')) {
        return { stdout: 'ActiveState=active\nActiveEnterTimestamp=@1789984800\nNRestarts=2\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    };
    return { calls, run };
  };
  it('install writes 0600 env and enables unit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-'));
    const { calls, run } = recorder();
    await new SystemdBackend(dir, run).install(ID, env);
    const p = join(dir, 'tunnels', `${ID}.env`);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf8')).toContain('TUNNEL_TOKEN=');
    expect(calls).toEqual([`sudo -n systemctl enable cloudflared@${ID}.service`]);
  });
  it('parses status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-'));
    const { run } = recorder();
    const b = new SystemdBackend(dir, run);
    await b.install(ID, env);
    expect(await b.status(ID)).toEqual({ state: 'active', activeSince: '2026-09-21T10:00:00.000Z', restarts: 2 });
  });
  it('reports not-installed without env file', async () => {
    const { run } = recorder();
    expect((await new SystemdBackend(mkdtempSync(join(tmpdir(), 'tm-')), run).status(ID)).state).toBe('not-installed');
  });
  it('uninstall is idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-'));
    const { calls, run } = recorder();
    const b = new SystemdBackend(dir, run);
    await b.install(ID, env);
    await b.uninstall(ID);
    await b.uninstall(ID);
    expect(existsSync(join(dir, 'tunnels', `${ID}.env`))).toBe(false);
    expect(calls.filter((c) => c.includes('disable --now')).length).toBe(2);
  });
  it('throws SERVICE_COMMAND_FAILED on non-zero exit', async () => {
    const run: Runner = async () => ({ stdout: '', stderr: 'boom', code: 1 });
    await expect(new SystemdBackend('/x', run).restart(ID)).rejects.toMatchObject({ code: 'SERVICE_COMMAND_FAILED' });
  });
});

describe('parseJournalLine', () => {
  it('extracts level from cloudflared message', () => {
    const l = parseJournalLine(JSON.stringify({ __REALTIME_TIMESTAMP: '1758535200000000', MESSAGE: '2026-09-22T10:00:00Z ERR Connection failed', PRIORITY: '3' }));
    expect(l).toEqual({ time: '2025-09-22T10:00:00.000Z', level: 'error', message: '2026-09-22T10:00:00Z ERR Connection failed' });
  });
  it('returns null for garbage', () => {
    expect(parseJournalLine('nope')).toBeNull();
  });
});

describe('FakeBackend', () => {
  it('tracks lifecycle', async () => {
    const b = new FakeBackend(mkdtempSync(join(tmpdir(), 'tm-')));
    await b.install(ID, env);
    expect(b.isInstalled(ID)).toBe(true);
    await b.start(ID);
    expect((await b.status(ID)).state).toBe('active');
    await b.stop(ID);
    expect((await b.status(ID)).state).toBe('inactive');
    await b.uninstall(ID);
    expect((await b.status(ID)).state).toBe('not-installed');
  });
});
