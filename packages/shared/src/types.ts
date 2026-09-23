import type { LogLevel, Protocol, Route } from './schemas';

export type LocalState = 'active' | 'inactive' | 'failed' | 'activating' | 'not-installed';
export type EdgeStatus = 'healthy' | 'degraded' | 'down' | 'inactive';
export type WatchdogState = 'healthy' | 'degraded' | 'restarting' | 'failing' | 'disabled';

export interface TunnelSettings {
  keepAlive: boolean; toleranceMinutes: number; logLevel: LogLevel; protocol: Protocol; metricsPort: number;
}

export interface EdgeConnection { coloName: string; openedAt: string; originIp: string; clientVersion: string }

export interface TunnelSummary {
  id: string; name: string; createdAt: string;
  /** config_src === 'cloudflare' */
  remote: boolean;
  /** Has a unit/env file on this host. */
  managedHere: boolean;
  edgeStatus: EdgeStatus;
  connections: EdgeConnection[];
  local: LocalState;
  activeSince: string | null;
  watchdog: WatchdogState;
  routeCount: number;
  settings: TunnelSettings | null;
}

export interface TunnelDetail extends TunnelSummary { routes: Route[]; configVersion: number }

export type EventType =
  | 'created' | 'deleted' | 'adopted' | 'started' | 'stopped' | 'restarted' | 'config-changed'
  | 'watchdog-degraded' | 'watchdog-restart' | 'watchdog-recovered' | 'watchdog-failing' | 'no-connectivity'
  | 'cloudflared-updated';

export interface TunnelEvent {
  id: number; tunnelId: string | null; type: EventType; message: string; createdAt: string;
}

export interface Zone { id: string; name: string }
export interface CloudflareStatus { connected: boolean; accountId: string | null; accountName: string | null; tokenSuffix: string | null; zones: Zone[] }
export interface SetupStatus { adminCreated: boolean; cloudflareConnected: boolean }
export interface MetricsPoint { t: number; requests: number; errors: number }
export interface MetricsSnapshot { points: MetricsPoint[]; haConnections: number | null }
export interface CloudflaredVersionInfo {
  installed: string | null; latest: string | null; updateAvailable: boolean;
  /** False when cloudflared ships inside a container image and cannot be upgraded in place. */
  canSelfUpdate: boolean;
}
export interface OriginTestResult { reachable: boolean; latencyMs: number | null; error: string | null }
export interface LogLine { time: string; level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'; message: string }
