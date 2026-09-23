import { join, resolve } from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  etcDir: string;
  /** systemd (Proxmox LXC), process (Docker) or fake (development). */
  serviceBackend: 'systemd' | 'process' | 'fake';
  cloudflaredBin: string;
  webDist: string | null;
  cfApiBase: string;
  cookieSecure: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? '/var/lib/tunnel-manager'),
    etcDir: resolve(env.ETC_DIR ?? '/etc/tunnel-manager'),
    serviceBackend: env.SERVICE_BACKEND === 'fake' || env.SERVICE_BACKEND === 'process' ? env.SERVICE_BACKEND : 'systemd',
    cloudflaredBin: env.CLOUDFLARED_BIN ?? 'cloudflared',
    webDist: env.WEB_DIST ? resolve(env.WEB_DIST) : env.NODE_ENV === 'production' ? join(import.meta.dirname, 'web') : null,
    cfApiBase: env.CF_API_BASE ?? 'https://api.cloudflare.com/client/v4',
    cookieSecure: env.COOKIE_SECURE === 'true',
  };
}
