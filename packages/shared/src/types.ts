import type { ErrorCode } from './errors';
import type { LogLevel, Protocol, Route } from './schemas';

export type LocalState = 'active' | 'inactive' | 'failed' | 'activating' | 'not-installed';
export type EdgeStatus = 'healthy' | 'degraded' | 'down' | 'inactive';
export type WatchdogState = 'healthy' | 'degraded' | 'restarting' | 'failing' | 'disabled';

export interface TunnelSettings {
  keepAlive: boolean; toleranceMinutes: number; logLevel: LogLevel; protocol: Protocol; metricsPort: number;
}

export interface EdgeConnection { coloName: string; openedAt: string; originIp: string; clientVersion: string }

export interface AccountRef { id: string; name: string }

export interface TunnelSummary {
  id: string; name: string; createdAt: string;
  /** The Cloudflare account that owns the tunnel. */
  account: AccountRef;
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

/** An account whose tunnels could not be listed (e.g. the token lacks Tunnel permission there). */
export interface UnavailableAccount extends AccountRef { code: ErrorCode }
export interface TunnelList { tunnels: TunnelSummary[]; unavailableAccounts: UnavailableAccount[] }

export type EventType =
  | 'created' | 'deleted' | 'adopted' | 'started' | 'stopped' | 'restarted' | 'config-changed'
  | 'watchdog-degraded' | 'watchdog-restart' | 'watchdog-recovered' | 'watchdog-failing' | 'no-connectivity'
  | 'cloudflared-updated';

export interface TunnelEvent {
  id: number; tunnelId: string | null; type: EventType; message: string; createdAt: string;
}

export interface Zone { id: string; name: string }
export interface CloudflareAccount extends AccountRef { zones: Zone[] }
export interface CloudflareStatus {
  connected: boolean; tokenSuffix: string | null;
  /** Account of the most recently created tunnel, preselected for the next one. */
  lastAccountId: string | null;
  accounts: CloudflareAccount[];
}
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
