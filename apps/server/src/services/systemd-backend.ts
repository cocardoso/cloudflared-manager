import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import type { LocalState } from '@tm/shared';
import { AppError } from '../errors';
import type { LogLine, ServiceBackend, TunnelEnv, UnitStatus } from './backend';
import { envFilePath, writeEnvFile } from './env-file';

export type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => resolve({ stdout, stderr: e.message, code: 127 }));
    p.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });

const unit = (id: string) => `cloudflared@${id}.service`;
const LEVELS: Record<string, LogLine['level']> = { DBG: 'debug', INF: 'info', WRN: 'warn', ERR: 'error', FTL: 'fatal' };
const STATES: Record<string, LocalState> = {
  active: 'active', reloading: 'active', inactive: 'inactive', failed: 'failed', activating: 'activating', deactivating: 'inactive',
};

export function parseJournalLine(json: string): LogLine | null {
  try {
    const o = JSON.parse(json) as { __REALTIME_TIMESTAMP?: string; MESSAGE?: string | number[] };
    const message = Array.isArray(o.MESSAGE) ? Buffer.from(o.MESSAGE).toString('utf8') : (o.MESSAGE ?? '');
    const tag = / (DBG|INF|WRN|ERR|FTL) /.exec(message)?.[1];
    return { time: new Date(Number(o.__REALTIME_TIMESTAMP) / 1000).toISOString(), level: tag ? LEVELS[tag]! : 'info', message };
  } catch {
    return null;
  }
}

function parseTimestamp(v: string | undefined) {
  if (!v) return null;
  const d = v.startsWith('@') ? new Date(Number(v.slice(1)) * 1000) : new Date(v.replace(/^\w+ /, ''));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export class SystemdBackend implements ServiceBackend {
  readonly canSelfUpdate = true;

  constructor(private etcDir: string, private run: Runner = defaultRunner) {}

  private async sudo(args: string[]) {
    const r = await this.run('sudo', ['-n', ...args]);
    if (r.code !== 0) throw new AppError('SERVICE_COMMAND_FAILED', `${args.join(' ')} failed: ${r.stderr.trim()}`, 500);
    return r;
  }

  async install(id: string, env: TunnelEnv) {
    writeEnvFile(this.etcDir, id, env);
    await this.sudo(['systemctl', 'enable', unit(id)]);
  }

  async updateEnv(id: string, env: TunnelEnv) {
    writeEnvFile(this.etcDir, id, env);
  }

  async uninstall(id: string) {
    const path = envFilePath(this.etcDir, id);
    // Tolerates "unit not loaded" so a half-removed tunnel can still be cleaned up.
    await this.run('sudo', ['-n', 'systemctl', 'disable', '--now', unit(id)]);
    rmSync(path, { force: true });
  }

  isInstalled(id: string) {
    return existsSync(envFilePath(this.etcDir, id));
  }

  // --no-block: cloudflared is Type=notify and only reports ready once connected;
  // waiting for that during an outage would hang the API and the watchdog.
  async start(id: string) {
    await this.sudo(['systemctl', '--no-block', 'start', unit(id)]);
  }

  async stop(id: string) {
    await this.sudo(['systemctl', '--no-block', 'stop', unit(id)]);
  }

  async restart(id: string) {
    await this.sudo(['systemctl', '--no-block', 'restart', unit(id)]);
  }

  async status(id: string): Promise<UnitStatus> {
    if (!this.isInstalled(id)) return { state: 'not-installed', activeSince: null, restarts: 0 };
    const r = await this.run('systemctl', ['show', unit(id), '--timestamp=unix', '--property=ActiveState,ActiveEnterTimestamp,NRestarts']);
    const kv = Object.fromEntries(
      r.stdout.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    const state = STATES[kv.ActiveState ?? ''] ?? 'inactive';
    return {
      state,
      activeSince: state === 'active' ? parseTimestamp(kv.ActiveEnterTimestamp) : null,
      restarts: Number(kv.NRestarts ?? 0),
    };
  }

  async logs(id: string, lines: number) {
    const r = await this.sudo(['journalctl', '-u', unit(id), '-o', 'json', '-n', String(lines), '--no-pager']);
    return r.stdout.split('\n').map(parseJournalLine).filter((l): l is LogLine => !!l);
  }

  followLogs(id: string, onLine: (l: LogLine) => void) {
    const p = spawn('sudo', ['-n', 'journalctl', '-u', unit(id), '-o', 'json', '-n', '0', '-f', '--no-pager'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buf = '';
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const l = parseJournalLine(part);
        if (l) onLine(l);
      }
    });
    p.on('error', () => undefined);
    return () => {
      p.kill('SIGTERM');
    };
  }

  async cloudflaredVersion() {
    const r = await this.run('cloudflared', ['--version']);
    return /version (\S+)/.exec(r.stdout)?.[1] ?? null;
  }

  async upgradeCloudflared() {
    await this.sudo(['apt-get', 'update', '-qq']);
    await this.sudo(['apt-get', 'install', '--only-upgrade', '-y', 'cloudflared']);
  }
}
