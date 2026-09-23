import type { LocalState, LogLevel, LogLine, Protocol } from '@tm/shared';

export type { LogLine };
export interface TunnelEnv { token: string; metricsPort: number; logLevel: LogLevel; protocol: Protocol }
export interface UnitStatus { state: LocalState; activeSince: string | null; restarts: number }

/** Everything that touches the operating system goes through this interface. */
export interface ServiceBackend {
  /** Writes the env file (0600) and enables the unit. */
  install(tunnelId: string, env: TunnelEnv): Promise<void>;
  /** Rewrites the env file without restarting. */
  updateEnv(tunnelId: string, env: TunnelEnv): Promise<void>;
  /** Stops, disables and removes the env file. Idempotent. */
  uninstall(tunnelId: string): Promise<void>;
  isInstalled(tunnelId: string): boolean;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  status(id: string): Promise<UnitStatus>;
  logs(id: string, lines: number): Promise<LogLine[]>;
  /** Returns an unsubscribe function. */
  followLogs(id: string, onLine: (l: LogLine) => void): () => void;
  cloudflaredVersion(): Promise<string | null>;
  upgradeCloudflared(): Promise<void>;
}
