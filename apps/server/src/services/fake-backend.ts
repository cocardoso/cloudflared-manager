import { existsSync, rmSync } from 'node:fs';
import type { LocalState } from '@tm/shared';
import type { LogLine, ServiceBackend, TunnelEnv, UnitStatus } from './backend';
import { envFilePath, writeEnvFile } from './env-file';

/** In-memory systemd stand-in for development and tests (SERVICE_BACKEND=fake). */
export class FakeBackend implements ServiceBackend {
  readonly calls: string[] = [];
  version = '2026.9.1';
  private states = new Map<string, { state: LocalState; since: string | null; restarts: number }>();
  private listeners = new Map<string, Set<(l: LogLine) => void>>();
  private history = new Map<string, LogLine[]>();

  constructor(private etcDir: string) {}

  private set(id: string, state: LocalState) {
    const prev = this.states.get(id);
    this.states.set(id, { state, since: state === 'active' ? new Date().toISOString() : null, restarts: prev?.restarts ?? 0 });
  }

  setState(id: string, state: LocalState) {
    this.set(id, state);
  }

  emitLog(id: string, line: LogLine) {
    const h = this.history.get(id) ?? [];
    h.push(line);
    this.history.set(id, h.slice(-500));
    this.listeners.get(id)?.forEach((f) => f(line));
  }

  private log(id: string, message: string) {
    const now = new Date().toISOString();
    this.emitLog(id, { time: now, level: 'info', message: `${now} INF ${message}` });
  }

  async install(id: string, env: TunnelEnv) {
    this.calls.push(`install ${id}`);
    writeEnvFile(this.etcDir, id, env);
    this.set(id, 'inactive');
  }

  async updateEnv(id: string, env: TunnelEnv) {
    this.calls.push(`updateEnv ${id}`);
    writeEnvFile(this.etcDir, id, env);
  }

  async uninstall(id: string) {
    this.calls.push(`uninstall ${id}`);
    rmSync(envFilePath(this.etcDir, id), { force: true });
    this.states.delete(id);
  }

  isInstalled(id: string) {
    return existsSync(envFilePath(this.etcDir, id));
  }

  async start(id: string) {
    this.calls.push(`start ${id}`);
    this.set(id, 'active');
    this.log(id, 'Registered tunnel connection connIndex=0 location=gru01 protocol=quic');
  }

  async stop(id: string) {
    this.calls.push(`stop ${id}`);
    this.set(id, 'inactive');
    this.log(id, 'Initiating graceful shutdown due to signal terminated');
  }

  async restart(id: string) {
    this.calls.push(`restart ${id}`);
    const prev = this.states.get(id);
    this.set(id, 'active');
    this.states.get(id)!.restarts = (prev?.restarts ?? 0) + 1;
    this.log(id, 'Registered tunnel connection connIndex=0 location=gru01 protocol=quic');
  }

  async status(id: string): Promise<UnitStatus> {
    if (!this.isInstalled(id)) return { state: 'not-installed', activeSince: null, restarts: 0 };
    const s = this.states.get(id) ?? { state: 'inactive' as LocalState, since: null, restarts: 0 };
    return { state: s.state, activeSince: s.since, restarts: s.restarts };
  }

  async logs(id: string, lines: number) {
    return (this.history.get(id) ?? []).slice(-lines);
  }

  followLogs(id: string, onLine: (l: LogLine) => void) {
    const set = this.listeners.get(id) ?? new Set();
    set.add(onLine);
    this.listeners.set(id, set);
    return () => {
      set.delete(onLine);
    };
  }

  async cloudflaredVersion() {
    return this.version;
  }

  async upgradeCloudflared() {
    this.calls.push('upgrade');
  }
}
