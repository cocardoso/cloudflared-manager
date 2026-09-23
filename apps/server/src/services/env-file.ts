import { uuidSchema } from '@tm/shared';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../errors';
import type { TunnelEnv } from './backend';

export function envFilePath(etcDir: string, tunnelId: string) {
  if (!uuidSchema.safeParse(tunnelId).success) throw new AppError('VALIDATION_ERROR', 'invalid tunnel id', 400);
  return join(etcDir, 'tunnels', `${tunnelId}.env`);
}

export function renderEnvFile(env: TunnelEnv) {
  return [
    `TUNNEL_TOKEN=${env.token}`,
    `TUNNEL_METRICS=127.0.0.1:${env.metricsPort}`,
    `TUNNEL_LOGLEVEL=${env.logLevel}`,
    `TUNNEL_TRANSPORT_PROTOCOL=${env.protocol}`,
    '',
  ].join('\n');
}

export function parseEnvFile(text: string): TunnelEnv {
  const kv = Object.fromEntries(
    text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  return {
    token: kv.TUNNEL_TOKEN ?? '',
    metricsPort: Number((kv.TUNNEL_METRICS ?? '').split(':')[1]),
    logLevel: (kv.TUNNEL_LOGLEVEL ?? 'info') as TunnelEnv['logLevel'],
    protocol: (kv.TUNNEL_TRANSPORT_PROTOCOL ?? 'auto') as TunnelEnv['protocol'],
  };
}

/** Atomic write with 0600 permissions. */
export function writeEnvFile(etcDir: string, tunnelId: string, env: TunnelEnv) {
  const path = envFilePath(etcDir, tunnelId);
  mkdirSync(join(etcDir, 'tunnels'), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, renderEnvFile(env), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
