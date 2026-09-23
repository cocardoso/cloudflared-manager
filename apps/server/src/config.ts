import { join } from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  etcDir: string;
  serviceBackend: 'systemd' | 'fake';
  webDist: string | null;
  cfApiBase: string;
  cookieSecure: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.DATA_DIR ?? '/var/lib/tunnel-manager',
    etcDir: env.ETC_DIR ?? '/etc/tunnel-manager',
    serviceBackend: env.SERVICE_BACKEND === 'fake' ? 'fake' : 'systemd',
    webDist: env.WEB_DIST ?? (env.NODE_ENV === 'production' ? join(import.meta.dirname, 'web') : null),
    cfApiBase: env.CF_API_BASE ?? 'https://api.cloudflare.com/client/v4',
    cookieSecure: env.COOKIE_SECURE === 'true',
  };
}
