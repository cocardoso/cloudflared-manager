import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalState } from '@tm/shared';
import { AppError } from '../errors';
import type { LogLine, ServiceBackend, TunnelEnv, UnitStatus } from './backend';
import { envFilePath, writeEnvFile } from './env-file';
import { defaultRunner } from './systemd-backend';

const MAX_LINES = 1000;
const LEVELS: Record<string, LogLine['level']> = { DBG: 'debug', INF: 'info', WRN: 'warn', ERR: 'error', FTL: 'fatal' };

interface Tunnel {
  proc: ChildProcess | null;
  state: LocalState;
  since: string | null;
  restarts: number;
  /** True while the tunnel should be running; false after stop() or during shutdown. */
  wanted: boolean;
  timer: NodeJS.Timeout | null;
  /** Bumped by stop()/uninstall() so an in-flight restart() knows it was overridden. */
  generation: number;
  lines: LogLine[];
  listeners: Set<(l: LogLine) => void>;
}

interface Options { etcDir: string; bin?: string; restartDelayMs?: number; stopGraceMs?: number }

/** Reads the KEY=value pairs of a tunnel env file. */
function readEnvVars(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) vars[line.slice(0, i)] = line.slice(i + 1);
  }
  return vars;
}

/**
 * Runs each tunnel as a supervised child process — the Docker-friendly alternative to systemd units.
 * A `<id>.stopped` marker next to the env file remembers tunnels the user stopped, across restarts.
 */
export class ProcessBackend implements ServiceBackend {
  readonly canSelfUpdate = false;
  private tunnels = new Map<string, Tunnel>();
  private bin: string;
  private restartDelayMs: number;
  private stopGraceMs: number;

  constructor(private opts: Options) {
    this.bin = opts.bin ?? 'cloudflared';
    this.restartDelayMs = opts.restartDelayMs ?? 5_000;
    this.stopGraceMs = opts.stopGraceMs ?? 10_000;
  }

  private entry(id: string): Tunnel {
    let t = this.tunnels.get(id);
    if (!t) {
      t = { proc: null, state: 'inactive', since: null, restarts: 0, wanted: false, timer: null, generation: 0, lines: [], listeners: new Set() };
      this.tunnels.set(id, t);
    }
    return t;
  }

  private markerPath(id: string) {
    return envFilePath(this.opts.etcDir, id).replace(/\.env$/, '.stopped');
  }

  private push(t: Tunnel, message: string) {
    const tag = / (DBG|INF|WRN|ERR|FTL) /.exec(` ${message} `)?.[1];
    const line: LogLine = { time: new Date().toISOString(), level: tag ? LEVELS[tag]! : 'info', message };
    t.lines.push(line);
    if (t.lines.length > MAX_LINES) t.lines.splice(0, t.lines.length - MAX_LINES);
    t.listeners.forEach((f) => f(line));
  }

  private pipe(t: Tunnel, stream: NodeJS.ReadableStream | null) {
    let buf = '';
    stream?.on('data', (d: Buffer) => {
      buf += d.toString();
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const p of parts) if (p.trim()) this.push(t, p);
    });
  }

  private spawnChild(id: string) {
    const t = this.entry(id);
    t.timer = null;
    if (!t.wanted || t.proc) return;
    let vars: Record<string, string>;
    try {
      vars = readEnvVars(envFilePath(this.opts.etcDir, id));
    } catch (e) {
      // An unreadable env file must not crash the app; retry like any other failure.
      this.push(t, `${new Date().toISOString()} ERR cannot read tunnel settings: ${(e as Error).message}`);
      t.state = 'failed';
      t.restarts++;
      t.timer = setTimeout(() => this.spawnChild(id), this.restartDelayMs);
      return;
    }
    const proc = spawn(this.bin, ['--no-autoupdate', 'tunnel', 'run'], {
      // The token travels in the environment only, so it never shows up in `ps`.
      env: { ...process.env, ...vars },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.proc = proc;
    t.state = 'active';
    t.since = new Date().toISOString();
    this.pipe(t, proc.stdout);
    this.pipe(t, proc.stderr);

    let ended = false;
    const onEnd = (failed: boolean, reason: string) => {
      if (ended) return;
      ended = true;
      if (t.proc === proc) t.proc = null;
      t.since = null;
      if (!t.wanted) {
        t.state = 'inactive';
        return;
      }
      this.push(t, `${new Date().toISOString()} ERR cloudflared ${reason}; restarting in ${this.restartDelayMs} ms`);
      t.state = failed ? 'failed' : 'activating';
      t.restarts++;
      t.timer = setTimeout(() => this.spawnChild(id), this.restartDelayMs);
    };
    proc.once('error', (e) => onEnd(true, `failed to start: ${e.message}`));
    proc.once('exit', (code, signal) => onEnd(false, `exited (${signal ?? code})`));
  }

  private async terminate(t: Tunnel) {
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    const proc = t.proc;
    if (!proc) return;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => proc.kill('SIGKILL'), this.stopGraceMs);
      proc.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }

  async install(id: string, env: TunnelEnv) {
    writeEnvFile(this.opts.etcDir, id, env);
    this.entry(id);
  }

  async updateEnv(id: string, env: TunnelEnv) {
    writeEnvFile(this.opts.etcDir, id, env);
  }

  async uninstall(id: string) {
    const path = envFilePath(this.opts.etcDir, id);
    const t = this.tunnels.get(id);
    if (t) {
      t.wanted = false;
      t.generation++;
      await this.terminate(t);
      this.tunnels.delete(id);
    }
    rmSync(path, { force: true });
    rmSync(this.markerPath(id), { force: true });
  }

  isInstalled(id: string) {
    return existsSync(envFilePath(this.opts.etcDir, id));
  }

  async start(id: string) {
    if (!this.isInstalled(id)) throw new AppError('TUNNEL_NOT_MANAGED', 'Tunnel is not installed on this host', 400);
    rmSync(this.markerPath(id), { force: true });
    const t = this.entry(id);
    t.wanted = true;
    this.spawnChild(id);
  }

  async stop(id: string) {
    if (this.isInstalled(id)) writeFileSync(this.markerPath(id), '');
    const t = this.entry(id);
    t.wanted = false;
    t.generation++;
    await this.terminate(t);
    t.state = 'inactive';
  }

  async restart(id: string) {
    const t = this.entry(id);
    const generation = t.generation;
    t.wanted = false;
    await this.terminate(t);
    // A stop() or uninstall() that arrived while we were terminating wins.
    if (t.generation !== generation) return;
    await this.start(id);
  }

  async status(id: string): Promise<UnitStatus> {
    if (!this.isInstalled(id)) return { state: 'not-installed', activeSince: null, restarts: 0 };
    const t = this.tunnels.get(id);
    if (!t) return { state: 'inactive', activeSince: null, restarts: 0 };
    return { state: t.state, activeSince: t.state === 'active' ? t.since : null, restarts: t.restarts };
  }

  async logs(id: string, lines: number) {
    return (this.tunnels.get(id)?.lines ?? []).slice(-lines);
  }

  followLogs(id: string, onLine: (l: LogLine) => void) {
    const t = this.entry(id);
    t.listeners.add(onLine);
    return () => {
      t.listeners.delete(onLine);
    };
  }

  /** Brings back every installed tunnel the user did not stop (container boot). */
  async startAll() {
    const dir = join(this.opts.etcDir, 'tunnels');
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.env')) continue;
      const id = f.replace(/\.env$/, '');
      // One broken entry must not keep the others (or the whole app) from starting.
      try {
        if (!existsSync(this.markerPath(id))) await this.start(id);
      } catch (e) {
        console.error(`cloudflared-manager: skipping ${f}: ${(e as Error).message}`);
      }
    }
  }

  /** Stops every child without marking it stopped, so the next boot restarts it. */
  async shutdownAll() {
    await Promise.all(
      [...this.tunnels.values()].map(async (t) => {
        t.wanted = false;
        await this.terminate(t);
      }),
    );
  }

  async cloudflaredVersion() {
    const r = await defaultRunner(this.bin, ['--version']);
    return /version (\S+)/.exec(r.stdout)?.[1] ?? null;
  }

  async upgradeCloudflared(): Promise<void> {
    throw new AppError('CLOUDFLARED_UPDATE_UNSUPPORTED', 'cloudflared is bundled in the container image', 409);
  }
}
