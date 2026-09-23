# Cloudflared Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web application (Fastify + React/Kumo) that manages remotely-managed Cloudflare tunnels running as systemd units in a Proxmox LXC, plus the `ct/` + `install/` scripts following the community-scripts pattern.

**Architecture:** pnpm monorepo with `packages/shared` (zod schemas + error codes), `apps/server` (Fastify; `cloudflare/`, `services/`, `tunnels/`, `watchdog/`, `db/`, `auth/`, `http/` modules) and `apps/web` (React SPA + Kumo + TanStack Query + react-i18next). The server is bundled with esbuild into a single `server.mjs`, with no native dependencies, and the release is a single tarball (architecture-independent).

**Tech Stack:** Node 24 LTS (dev works on Node 22.13+), TypeScript 5, Fastify 5, `node:sqlite`, `node:crypto` (scrypt, AES-256-GCM), zod 4, Vitest 4, React 19, Vite 8, Tailwind 4, `@cloudflare/kumo` 2.14.0, `@phosphor-icons/react`, TanStack Query 5, react-router 7, react-i18next, Playwright, esbuild, shellcheck.

**Spec:** `docs/superpowers/specs/2026-09-22-cloudflared-manager-design.md`

## Approved deviations from the spec (decided during planning)

| Spec | Plan | Reason |
|---|---|---|
| Official `cloudflare` SDK | Our own REST client with `fetch` (`apps/server/src/cloudflare/`) | There are ~12 endpoints; the SDK is 7 MB; testing against a fake HTTP server is simpler. |
| `better-sqlite3` | `node:sqlite` (`DatabaseSync`) | No native module → a single tarball for x64/arm64, nothing compiled in the container. |
| argon2 | `crypto.scrypt` (N=16384, r=8, p=1, salt 16 B, key 64 B) | Same reason; scrypt is a suitable password KDF. |
| Per-architecture tarballs | A single tarball | Consequence of the two rows above. |
| Node 22 LTS | Node 24 LTS in the LXC | `node:sqlite` is more mature; 24 is the active LTS as of 2026-09. |
| `msw` | In-memory fake of the Cloudflare API (`apps/server/test/fake-cloudflare.ts`) | The same fake serves both unit tests and e2e. |
| Routes edited per item (`POST/PUT/DELETE /routes/:index`) | Whole list with optimistic versioning (`PUT /api/tunnels/:id/routes` with `version`) | Covers add, edit, remove and reorder in a single transactional path with rollback. |

## Global Constraints

- Language: code, comments, file names, commits and strings in **English**; `.md` files in **pt-BR**. UI messages via i18n `en` + `pt-BR`.
- Commits carry no co-author trailer.
- Tunnels are always created with `config_src: "cloudflare"`.
- Token permissions: Account → Cloudflare Tunnel → Edit; Zone → DNS → Edit; Zone → Zone → Read; all zones.
- Cloudflare token encrypted with AES-256-GCM; key at `${ETC_DIR}/secret.key` (32 bytes, mode 0600); never returned to the UI (only the last 4 characters).
- Tunnel `.env`: `${ETC_DIR}/tunnels/<uuid>.env`, mode 0600, with `TUNNEL_TOKEN`, `TUNNEL_METRICS=127.0.0.1:<port>`, `TUNNEL_LOGLEVEL`, `TUNNEL_TRANSPORT_PROTOCOL`.
- Unit: `cloudflared@<uuid>.service`. The tunnel id is validated as a UUID before becoming a unit or file name.
- Metrics ports: starting at 20241, unique per tunnel.
- Watchdog: 30 s interval; default tolerance 2 min; backoff 30 s → 10 min (doubles each attempt); `failing` after 5 consecutive restarts; no connectivity to `api.cloudflare.com:443` does not count as a restart.
- The `http_status:404` catch-all is always the last ingress rule and is not editable.
- CNAME: `<hostname> → <tunnelId>.cfargotunnel.com`, `proxied: true`, `comment: "managed by cloudflared-manager"`.
- Session: `tm_session` cookie, `httpOnly`, `SameSite=Strict`, 7 days; login rate-limited to 5/min per IP; password with a minimum of 12 characters.
- API errors: `{ code, message, details? }`.
- Events: 30-day retention.
- Default HTTP port 8080. Default LXC: Debian 13, 1 vCPU, 1024 MB, 4 GB, unprivileged, `var_arm64=yes`, tags `network;cloudflare`.
- Kumo: semantic tokens only (`bg-kumo-*`, `text-kumo-*`), no `dark:` prefix, Phosphor icons, pinned version `2.14.0`.

## Review Focus

1. **Hostname whose zone is not in the account** (e.g. `app.anotherdomain.com`): must fail with `ZONE_NOT_FOUND` before touching the ingress. Tested in Task 7.
2. **Ingress edited in the Zero Trust dashboard while the GUI is open**: saving with a stale `version` must produce `CONFIG_VERSION_CONFLICT`, not overwrite. Tested in Task 7.
3. **Same hostname used in two rules (different paths) and one is removed**: the CNAME must not be deleted while another rule still uses the host. Tested in Task 7.
4. **Internet outage**: the watchdog must not enter a restart loop or mark `failing`. Tested in Task 8.
5. **Delete a tunnel with active connections or a stopped/nonexistent unit**: deletion must be idempotent (stop the unit, clear connections, delete managed DNS, delete the tunnel, remove unit/env) and tolerate parts that no longer exist. Tested in Task 7.

---

## File structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .nvmrc
packages/shared/src/index.ts          # re-exports everything
packages/shared/src/errors.ts         # ErrorCode, ApiError shape
packages/shared/src/schemas.ts        # zod: routes, tunnels, setup, settings
packages/shared/src/types.ts          # response types (TunnelSummary, TunnelDetail...)
apps/server/src/config.ts             # reads env
apps/server/src/errors.ts             # AppError
apps/server/src/db/database.ts        # openDatabase + migrations
apps/server/src/crypto/secret-box.ts  # AES-256-GCM + key file
apps/server/src/auth/password.ts      # scrypt hash/verify
apps/server/src/auth/sessions.ts      # sessions in SQLite
apps/server/src/settings/settings-repo.ts
apps/server/src/cloudflare/client.ts  # fetch + error mapping
apps/server/src/cloudflare/api.ts     # typed endpoints
apps/server/src/cloudflare/types.ts
apps/server/src/tunnels/ingress.ts    # pure ingress/route functions
apps/server/src/tunnels/zones.ts      # resolves zone by hostname
apps/server/src/tunnels/tunnel-repo.ts
apps/server/src/tunnels/dns-repo.ts
apps/server/src/tunnels/tunnel-service.ts
apps/server/src/services/backend.ts   # interface ServiceBackend
apps/server/src/services/env-file.ts
apps/server/src/services/systemd-backend.ts
apps/server/src/services/fake-backend.ts
apps/server/src/events/event-repo.ts
apps/server/src/watchdog/state-machine.ts
apps/server/src/watchdog/probes.ts
apps/server/src/watchdog/watchdog.ts
apps/server/src/metrics/prometheus.ts
apps/server/src/metrics/sampler.ts
apps/server/src/system/cloudflared-info.ts
apps/server/src/system/origin-test.ts
apps/server/src/http/app.ts
apps/server/src/http/context.ts       # AppContext (dependency injection)
apps/server/src/http/routes/*.ts
apps/server/src/main.ts
apps/server/test/fake-cloudflare.ts
apps/server/test/helpers.ts
apps/server/build.mjs                 # esbuild
apps/web/index.html, vite.config.ts
apps/web/src/main.tsx, app.tsx, styles.css
apps/web/src/i18n/{index.ts,en.json,pt-BR.json}
apps/web/src/api/{client.ts,hooks.ts}
apps/web/src/components/*.tsx
apps/web/src/pages/*.tsx
deploy/cloudflared@.service, deploy/tunnel-manager.service, deploy/sudoers
ct/cloudflared-manager.sh
install/cloudflared-manager-install.sh
scripts/package-release.sh
.github/workflows/ci.yml, .github/workflows/release.yml
e2e/*.spec.ts, playwright.config.ts
README.md, docs/manual-test-checklist.md
```

---

### Task 1: Monorepo and `shared` package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- Create: `packages/shared/{package.json,tsconfig.json}`, `packages/shared/src/{index.ts,errors.ts,schemas.ts,types.ts}`
- Test: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Produces:
  - `ErrorCode` (string union): `CF_UNREACHABLE | CF_TOKEN_INVALID | CF_PERMISSION_MISSING | CF_RATE_LIMITED | CF_API_ERROR | CF_NOT_CONNECTED | ACCOUNT_SELECTION_REQUIRED | DNS_CONFLICT | ZONE_NOT_FOUND | CONFIG_VERSION_CONFLICT | TUNNEL_NOT_FOUND | TUNNEL_NOT_MANAGED | TUNNEL_NOT_REMOTE | SERVICE_COMMAND_FAILED | VALIDATION_ERROR | UNAUTHORIZED | SETUP_ALREADY_DONE | INVALID_CREDENTIALS | RATE_LIMITED | INTERNAL`
  - `ApiErrorBody = { code: ErrorCode; message: string; details?: unknown }`
  - zod: `routeSchema`, `routesUpdateSchema`, `createTunnelSchema`, `updateTunnelSchema`, `adminSetupSchema`, `loginSchema`, `changePasswordSchema`, `cloudflareTokenSchema`, `testOriginSchema`, `backupSchema`, `uuidSchema`
  - types: `Route`, `OriginRequest`, `TunnelSummary`, `TunnelDetail`, `LocalState`, `EdgeStatus`, `WatchdogState`, `TunnelSettings`, `TunnelEvent`, `Zone`, `CloudflareStatus`, `SetupStatus`, `MetricsSnapshot`, `CloudflaredVersionInfo`

- [ ] **Step 1: Create workspace files**

`package.json`:
```json
{
  "name": "cloudflared-manager",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev": "pnpm --parallel --filter @tm/server --filter @tm/web dev",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "@playwright/test": "^1.63.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  }
}
```

`.gitignore`:
```
node_modules/
dist/
release/
*.log
.data/
test-results/
playwright-report/
.DS_Store
```

`.nvmrc`: `24`

- [ ] **Step 2: `shared` package**

`packages/shared/package.json`:
```json
{
  "name": "@tm/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit", "build": "echo shared: source-only" },
  "dependencies": { "zod": "^4.3.0" },
  "devDependencies": { "vitest": "^4.1.0", "@types/node": "^24.0.0" }
}
```
`packages/shared/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`

`packages/shared/src/errors.ts`:
```ts
export const ERROR_CODES = [
  'CF_UNREACHABLE', 'CF_TOKEN_INVALID', 'CF_PERMISSION_MISSING', 'CF_RATE_LIMITED', 'CF_API_ERROR',
  'CF_NOT_CONNECTED', 'ACCOUNT_SELECTION_REQUIRED', 'DNS_CONFLICT', 'ZONE_NOT_FOUND',
  'CONFIG_VERSION_CONFLICT', 'TUNNEL_NOT_FOUND', 'TUNNEL_NOT_MANAGED', 'TUNNEL_NOT_REMOTE',
  'SERVICE_COMMAND_FAILED', 'VALIDATION_ERROR', 'UNAUTHORIZED', 'SETUP_ALREADY_DONE',
  'INVALID_CREDENTIALS', 'RATE_LIMITED', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiErrorBody { code: ErrorCode; message: string; details?: unknown }
```

- [ ] **Step 3: Write failing tests** — `packages/shared/src/schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { routeSchema, routesUpdateSchema, adminSetupSchema, uuidSchema } from './schemas';

describe('routeSchema', () => {
  it('accepts http service with hostname', () => {
    expect(routeSchema.parse({ hostname: 'app.example.com', service: 'http://192.168.1.10:8123' }).hostname)
      .toBe('app.example.com');
  });
  it('lowercases and trims hostname', () => {
    expect(routeSchema.parse({ hostname: ' App.Example.com ', service: 'http://a:1' }).hostname).toBe('app.example.com');
  });
  it('rejects hostname without dot', () => {
    expect(() => routeSchema.parse({ hostname: 'localhost', service: 'http://a:1' })).toThrow();
  });
  it('rejects unknown scheme', () => {
    expect(() => routeSchema.parse({ hostname: 'a.example.com', service: 'ftp://a:21' })).toThrow();
  });
  it('accepts ssh, tcp, rdp, unix and http_status services', () => {
    for (const service of ['ssh://10.0.0.2:22', 'tcp://10.0.0.2:5432', 'rdp://10.0.0.3:3389', 'unix:/run/app.sock', 'http_status:404']) {
      expect(routeSchema.parse({ hostname: 'a.example.com', service }).service).toBe(service);
    }
  });
  it('accepts path and originRequest options', () => {
    const r = routeSchema.parse({ hostname: 'a.example.com', path: '^/api', service: 'https://10.0.0.2',
      originRequest: { noTLSVerify: true, httpHostHeader: 'x', originServerName: 'y', connectTimeout: '10s', keepAliveTimeout: '90s' } });
    expect(r.originRequest?.noTLSVerify).toBe(true);
  });
});

describe('routesUpdateSchema', () => {
  it('requires numeric version', () => {
    expect(() => routesUpdateSchema.parse({ routes: [] })).toThrow();
    expect(routesUpdateSchema.parse({ version: 3, routes: [] }).overwriteDns).toEqual([]);
  });
});

describe('adminSetupSchema', () => {
  it('requires 12+ char password', () => {
    expect(() => adminSetupSchema.parse({ username: 'admin', password: 'short' })).toThrow();
    expect(adminSetupSchema.parse({ username: 'admin', password: 'a-very-long-pass' }).username).toBe('admin');
  });
});

describe('uuidSchema', () => {
  it('rejects path traversal', () => {
    expect(() => uuidSchema.parse('../../etc/passwd')).toThrow();
    expect(uuidSchema.parse('6ff42ae2-765d-4adf-8112-31c55c1551ef')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run and see it fail**

Run: `pnpm install && pnpm --filter @tm/shared test`
Expected: FAIL — `Cannot find module './schemas'`

- [ ] **Step 5: Implement `schemas.ts`, `types.ts`, `index.ts`**

`packages/shared/src/schemas.ts`:
```ts
import { z } from 'zod';

export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const hostnameSchema = z.string().trim().toLowerCase()
  .regex(/^(?=.{1,253}$)(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'invalid hostname');

const serviceSchema = z.string().trim().refine(
  (s) => /^(https?|tcp|ssh|rdp|smb|unix|unix\+tls):/.test(s) || /^http_status:\d{3}$/.test(s) || s === 'hello_world',
  'unsupported service',
);

const durationSchema = z.string().regex(/^\d+(ms|s|m|h)$/);

export const originRequestSchema = z.object({
  noTLSVerify: z.boolean().optional(),
  httpHostHeader: z.string().min(1).optional(),
  originServerName: z.string().min(1).optional(),
  connectTimeout: durationSchema.optional(),
  keepAliveTimeout: durationSchema.optional(),
}).strict();

export const routeSchema = z.object({
  hostname: hostnameSchema,
  path: z.string().min(1).optional(),
  service: serviceSchema,
  originRequest: originRequestSchema.optional(),
});

export const routesUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  routes: z.array(routeSchema).max(200),
  overwriteDns: z.array(hostnameSchema).default([]),
  keepDns: z.array(hostnameSchema).default([]),
});

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
export const protocolSchema = z.enum(['auto', 'quic', 'http2']);

export const createTunnelSchema = z.object({ name: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/) });

export const updateTunnelSchema = z.object({
  name: createTunnelSchema.shape.name.optional(),
  keepAlive: z.boolean().optional(),
  toleranceMinutes: z.number().int().min(1).max(60).optional(),
  logLevel: logLevelSchema.optional(),
  protocol: protocolSchema.optional(),
});

export const adminSetupSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(12).max(256),
});
export const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(256) });
export const cloudflareTokenSchema = z.object({ token: z.string().trim().min(20), accountId: z.string().regex(/^[0-9a-f]{32}$/).optional() });
export const testOriginSchema = z.object({ service: serviceSchema });

export const backupSchema = z.object({
  version: z.literal(1),
  tunnels: z.array(z.object({
    id: uuidSchema, keepAlive: z.boolean(), toleranceMinutes: z.number().int().min(1).max(60),
    logLevel: logLevelSchema, protocol: protocolSchema,
  })),
  managedDns: z.array(z.object({ recordId: z.string(), zoneId: z.string(), hostname: hostnameSchema, tunnelId: uuidSchema })),
});

export type Route = z.infer<typeof routeSchema>;
export type OriginRequest = z.infer<typeof originRequestSchema>;
export type RoutesUpdate = z.infer<typeof routesUpdateSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type Protocol = z.infer<typeof protocolSchema>;
export type UpdateTunnel = z.infer<typeof updateTunnelSchema>;
export type Backup = z.infer<typeof backupSchema>;
```

`packages/shared/src/types.ts`:
```ts
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
  remote: boolean;            // config_src === 'cloudflare'
  managedHere: boolean;       // tem unit/env neste LXC
  edgeStatus: EdgeStatus;
  connections: EdgeConnection[];
  local: LocalState;
  activeSince: string | null;
  watchdog: WatchdogState;
  routeCount: number;
  settings: TunnelSettings | null;
}

export interface TunnelDetail extends TunnelSummary { routes: Route[]; configVersion: number }

export interface TunnelEvent {
  id: number; tunnelId: string | null; type: EventType; message: string; createdAt: string;
}
export type EventType =
  | 'created' | 'deleted' | 'adopted' | 'started' | 'stopped' | 'restarted' | 'config-changed'
  | 'watchdog-degraded' | 'watchdog-restart' | 'watchdog-recovered' | 'watchdog-failing' | 'no-connectivity'
  | 'cloudflared-updated';

export interface Zone { id: string; name: string }
export interface CloudflareStatus { connected: boolean; accountId: string | null; accountName: string | null; tokenSuffix: string | null; zones: Zone[] }
export interface SetupStatus { adminCreated: boolean; cloudflareConnected: boolean }
export interface MetricsPoint { t: number; requests: number; errors: number }
export interface MetricsSnapshot { points: MetricsPoint[]; haConnections: number | null }
export interface CloudflaredVersionInfo { installed: string | null; latest: string | null; updateAvailable: boolean }
export interface OriginTestResult { reachable: boolean; latencyMs: number | null; error: string | null }
```

`packages/shared/src/index.ts`:
```ts
export * from './errors';
export * from './schemas';
export * from './types';
```

- [ ] **Step 6: Run tests** — `pnpm --filter @tm/shared test` → PASS; `pnpm --filter @tm/shared typecheck` → no errors.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "chore: scaffold monorepo and shared schemas"`

---

### Task 2: Server — config, database, encryption

**Files:**
- Create: `apps/server/{package.json,tsconfig.json,vitest.config.ts}`, `apps/server/src/config.ts`, `apps/server/src/errors.ts`, `apps/server/src/db/database.ts`, `apps/server/src/crypto/secret-box.ts`
- Test: `apps/server/src/db/database.test.ts`, `apps/server/src/crypto/secret-box.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env = process.env): AppConfig` with `{ port, host, dataDir, etcDir, serviceBackend: 'systemd'|'fake', webDist: string|null, cfApiBase, cookieSecure: boolean }`
  - `class AppError extends Error { constructor(code: ErrorCode, message: string, status: number, details?: unknown) }`
  - `openDatabase(path: string): Db` where `type Db = DatabaseSync`; applies migrations
  - `loadOrCreateKey(path: string): Buffer`; `encrypt(key: Buffer, plain: string): string`; `decrypt(key: Buffer, boxed: string): string`

- [ ] **Step 1: `apps/server/package.json`**
```json
{
  "name": "@tm/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "SERVICE_BACKEND=fake DATA_DIR=.data ETC_DIR=.data/etc node --disable-warning=ExperimentalWarning --import tsx --watch src/main.ts",
    "build": "node build.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tm/shared": "workspace:*",
    "fastify": "^5.8.0",
    "@fastify/cookie": "^11.0.0",
    "@fastify/static": "^8.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "zod": "^4.3.0"
  },
  "devDependencies": { "@types/node": "^24.0.0", "esbuild": "^0.28.0", "tsx": "^4.20.0", "vitest": "^4.1.0", "typescript": "^5.9.0" }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`
`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'], execArgv: ['--disable-warning=ExperimentalWarning'] } });
```
(If `execArgv` is not accepted by the installed Vitest version, use `NODE_OPTIONS=--disable-warning=ExperimentalWarning` in the `test` script.)

- [ ] **Step 2: Failing tests**

`apps/server/src/crypto/secret-box.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decrypt, encrypt, loadOrCreateKey } from './secret-box';

describe('secret-box', () => {
  it('round-trips', () => {
    const key = loadOrCreateKey(join(mkdtempSync(join(tmpdir(), 'tm-')), 'secret.key'));
    expect(decrypt(key, encrypt(key, 'cf-token-123'))).toBe('cf-token-123');
  });
  it('produces different ciphertext each time', () => {
    const key = Buffer.alloc(32, 1);
    expect(encrypt(key, 'x')).not.toBe(encrypt(key, 'x'));
  });
  it('fails with wrong key', () => {
    const boxed = encrypt(Buffer.alloc(32, 1), 'x');
    expect(() => decrypt(Buffer.alloc(32, 2), boxed)).toThrow();
  });
  it('creates key file with 0600 and reuses it', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'tm-')), 'secret.key');
    const k1 = loadOrCreateKey(p);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(loadOrCreateKey(p).equals(k1)).toBe(true);
  });
});
```

`apps/server/src/db/database.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';

describe('openDatabase', () => {
  it('creates all tables', () => {
    const db = openDatabase(':memory:');
    const names = (db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['admin', 'sessions', 'settings', 'tunnels', 'managed_dns', 'events', 'schema_version']));
  });
  it('is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(() => openDatabase(':memory:')).not.toThrow();
    expect((db.prepare('select max(version) v from schema_version').get() as { v: number }).v).toBe(1);
  });
});
```

- [ ] **Step 3: Run** — `pnpm install && pnpm --filter @tm/server test` → FAIL (missing modules).

- [ ] **Step 4: Implement**

`apps/server/src/errors.ts`:
```ts
import type { ErrorCode } from '@tm/shared';
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400, public details?: unknown) { super(message); }
}
```

`apps/server/src/config.ts`:
```ts
import { join } from 'node:path';
export interface AppConfig {
  port: number; host: string; dataDir: string; etcDir: string;
  serviceBackend: 'systemd' | 'fake'; webDist: string | null; cfApiBase: string; cookieSecure: boolean;
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
```

`apps/server/src/crypto/secret-box.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadOrCreateKey(path: string): Buffer {
  if (existsSync(path)) {
    const key = readFileSync(path);
    if (key.length !== 32) throw new Error(`invalid key length in ${path}`);
    return key;
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key, { mode: 0o600 });
  return key;
}

// Format: base64(iv[12] | tag[16] | ciphertext)
export function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(key: Buffer, boxed: string): string {
  const raw = Buffer.from(boxed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
```

`apps/server/src/db/database.ts`:
```ts
import { DatabaseSync } from 'node:sqlite';
export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  create table admin (id integer primary key check (id = 1), username text not null, password_hash text not null);
  create table sessions (token_hash text primary key, expires_at integer not null);
  create table settings (key text primary key, value text not null);
  create table tunnels (
    id text primary key,
    metrics_port integer not null unique,
    keep_alive integer not null default 1,
    tolerance_minutes integer not null default 2,
    log_level text not null default 'info',
    protocol text not null default 'auto',
    watchdog_state text not null default 'healthy',
    degraded_since integer,
    restart_attempts integer not null default 0,
    next_restart_at integer
  );
  create table managed_dns (
    record_id text primary key, zone_id text not null, hostname text not null unique, tunnel_id text not null
  );
  create table events (
    id integer primary key autoincrement, tunnel_id text, type text not null, message text not null, created_at integer not null
  );
  create index events_tunnel on events(tunnel_id, created_at);
  `,
];

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec('create table if not exists schema_version (version integer primary key)');
  const current = (db.prepare('select coalesce(max(version), 0) v from schema_version').get() as { v: number }).v;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('begin');
    try {
      db.exec(MIGRATIONS[i]!);
      db.prepare('insert into schema_version (version) values (?)').run(i + 1);
      db.exec('commit');
    } catch (e) { db.exec('rollback'); throw e; }
  }
  return db;
}
```

- [ ] **Step 5: Run** — `pnpm --filter @tm/server test` → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(server): add config, sqlite migrations and secret box"`

---

### Task 3: Server — password, sessions and settings

**Files:**
- Create: `apps/server/src/auth/password.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/settings/settings-repo.ts`
- Test: `apps/server/src/auth/auth.test.ts`, `apps/server/src/settings/settings-repo.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `encrypt/decrypt`
- Produces:
  - `hashPassword(pw: string): Promise<string>` (format `scrypt$<saltB64>$<hashB64>`), `verifyPassword(pw: string, stored: string): Promise<boolean>`
  - `class AdminRepo { constructor(db: Db); exists(): boolean; create(username, hash): void; get(): {username, passwordHash} | null; setPasswordHash(hash): void }`
  - `class SessionStore { constructor(db: Db, ttlMs = 7*24*3600e3, now = Date.now); create(): string; validate(token: string): boolean; revoke(token: string): void; revokeAll(): void }`
  - `class SettingsRepo { constructor(db: Db, key: Buffer); getCloudflare(): { token: string; accountId: string; accountName: string } | null; setCloudflare(v): void; tokenSuffix(): string | null; get(key): string | null; set(key, value): void }`

- [ ] **Step 1: Failing tests** — `apps/server/src/auth/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { hashPassword, verifyPassword } from './password';
import { AdminRepo, SessionStore } from './sessions';

describe('password', () => {
  it('verifies correct password and rejects wrong', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('rejects malformed stored hash', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('SessionStore', () => {
  it('creates, validates, expires and revokes', () => {
    let now = 1_000;
    const s = new SessionStore(openDatabase(':memory:'), 100, () => now);
    const t = s.create();
    expect(s.validate(t)).toBe(true);
    now = 1_101;
    expect(s.validate(t)).toBe(false);
    now = 1_000;
    const t2 = s.create();
    s.revoke(t2);
    expect(s.validate(t2)).toBe(false);
  });
  it('stores only token hash', () => {
    const db = openDatabase(':memory:');
    const t = new SessionStore(db).create();
    const row = db.prepare('select token_hash from sessions').get() as { token_hash: string };
    expect(row.token_hash).not.toBe(t);
  });
});

describe('AdminRepo', () => {
  it('creates single admin', () => {
    const r = new AdminRepo(openDatabase(':memory:'));
    expect(r.exists()).toBe(false);
    r.create('admin', 'h');
    expect(r.exists()).toBe(true);
    expect(() => r.create('other', 'h')).toThrow();
  });
});
```

`apps/server/src/settings/settings-repo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { SettingsRepo } from './settings-repo';

describe('SettingsRepo', () => {
  it('stores cloudflare token encrypted and exposes suffix', () => {
    const db = openDatabase(':memory:');
    const repo = new SettingsRepo(db, Buffer.alloc(32, 7));
    repo.setCloudflare({ token: 'abcdefghijklmnopqrstuvwxyz1234', accountId: 'a'.repeat(32), accountName: 'Home' });
    const raw = (db.prepare("select value from settings where key='cf_token'").get() as { value: string }).value;
    expect(raw).not.toContain('abcdef');
    expect(repo.getCloudflare()?.token).toBe('abcdefghijklmnopqrstuvwxyz1234');
    expect(repo.tokenSuffix()).toBe('1234');
  });
  it('returns null when not configured', () => {
    expect(new SettingsRepo(openDatabase(':memory:'), Buffer.alloc(32)).getCloudflare()).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @tm/server test` → FAIL.

- [ ] **Step 3: Implement**

`apps/server/src/auth/password.ts`:
```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64, OPTS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, OPTS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

`apps/server/src/auth/sessions.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/database';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export class AdminRepo {
  constructor(private db: Db) {}
  exists() { return !!this.db.prepare('select 1 from admin where id = 1').get(); }
  create(username: string, passwordHash: string) {
    this.db.prepare('insert into admin (id, username, password_hash) values (1, ?, ?)').run(username, passwordHash);
  }
  get() {
    const r = this.db.prepare('select username, password_hash from admin where id = 1').get() as { username: string; password_hash: string } | undefined;
    return r ? { username: r.username, passwordHash: r.password_hash } : null;
  }
  setPasswordHash(hash: string) { this.db.prepare('update admin set password_hash = ? where id = 1').run(hash); }
}

export class SessionStore {
  constructor(private db: Db, private ttlMs = 7 * 24 * 3600e3, private now: () => number = Date.now) {}
  create(): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('delete from sessions where expires_at <= ?').run(this.now());
    this.db.prepare('insert into sessions (token_hash, expires_at) values (?, ?)').run(sha(token), this.now() + this.ttlMs);
    return token;
  }
  validate(token: string): boolean {
    const r = this.db.prepare('select expires_at from sessions where token_hash = ?').get(sha(token)) as { expires_at: number } | undefined;
    return !!r && r.expires_at > this.now();
  }
  revoke(token: string) { this.db.prepare('delete from sessions where token_hash = ?').run(sha(token)); }
  revokeAll() { this.db.exec('delete from sessions'); }
}
```

`apps/server/src/settings/settings-repo.ts`:
```ts
import { decrypt, encrypt } from '../crypto/secret-box';
import type { Db } from '../db/database';

export interface CloudflareCredentials { token: string; accountId: string; accountName: string }

export class SettingsRepo {
  constructor(private db: Db, private key: Buffer) {}
  get(key: string): string | null {
    const r = this.db.prepare('select value from settings where key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  set(key: string, value: string) {
    this.db.prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, value);
  }
  setCloudflare(c: CloudflareCredentials) {
    this.set('cf_token', encrypt(this.key, c.token));
    this.set('cf_token_suffix', c.token.slice(-4));
    this.set('cf_account_id', c.accountId);
    this.set('cf_account_name', c.accountName);
  }
  getCloudflare(): CloudflareCredentials | null {
    const t = this.get('cf_token'); const a = this.get('cf_account_id');
    if (!t || !a) return null;
    return { token: decrypt(this.key, t), accountId: a, accountName: this.get('cf_account_name') ?? '' };
  }
  tokenSuffix() { return this.get('cf_token_suffix'); }
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): add password hashing, sessions and settings repo"` (use `git add -A` first).

---

### Task 4: Cloudflare API client + in-memory fake

**Files:**
- Create: `apps/server/src/cloudflare/{types.ts,client.ts,api.ts}`, `apps/server/test/fake-cloudflare.ts`
- Test: `apps/server/src/cloudflare/api.test.ts`

**Interfaces:**
- Produces:
  - `class CfClient { constructor(opts: { token: string; baseUrl: string; fetch?: typeof fetch }); request<T>(method, path, body?): Promise<T>; paginate<T>(path): Promise<T[]> }` — unwraps `{ success, result, errors }` and maps errors:
    - network/timeout (10 s) → `CF_UNREACHABLE` (502)
    - 401, or an error with code 1000/9109/6003/10000 and 401/403 with "Invalid" → `CF_TOKEN_INVALID` (401)
    - 403 → `CF_PERMISSION_MISSING` (403)
    - 429 → `CF_RATE_LIMITED` (429)
    - 404 → `TUNNEL_NOT_FOUND` only when the path contains `/cfd_tunnel/`; otherwise `CF_API_ERROR` (502)
    - other → `CF_API_ERROR` (502) with `details: errors`
  - `class CfApi { constructor(client: CfClient, accountId: string) }` with:
    - `static verifyToken(client): Promise<{ status: string }>` (`GET /user/tokens/verify`)
    - `static listAccounts(client): Promise<CfAccount[]>` (`GET /accounts`)
    - `listZones(): Promise<CfZone[]>` (`GET /zones?account.id=…&per_page=50` paginated)
    - `listTunnels(): Promise<CfTunnel[]>` (`GET /accounts/{a}/cfd_tunnel?is_deleted=false&per_page=100` paginated)
    - `getTunnel(id)`, `createTunnel(name)` (`POST … { name, config_src: 'cloudflare' }`), `renameTunnel(id, name)` (`PATCH`), `deleteTunnel(id)` (`DELETE`), `cleanupConnections(id)` (`DELETE …/connections`)
    - `getTunnelToken(id): Promise<string>`
    - `getConfig(id): Promise<{ version: number; config: CfTunnelConfig }>` (`GET …/configurations`)
    - `putConfig(id, config: CfTunnelConfig): Promise<{ version: number }>` (`PUT …/configurations { config }`)
    - `findDnsRecords(zoneId, name): Promise<CfDnsRecord[]>` (`GET /zones/{z}/dns_records?name.exact=…`)
    - `createCname(zoneId, name, target): Promise<CfDnsRecord>`; `updateCname(zoneId, recordId, name, target)`; `deleteDnsRecord(zoneId, recordId)`
  - types `CfAccount {id,name}`, `CfZone {id,name,status}`, `CfTunnel {id,name,created_at,deleted_at,status,config_src,connections: CfConnection[]}`, `CfConnection {colo_name,opened_at,origin_ip,client_version,is_pending_reconnect}`, `CfTunnelConfig { ingress: CfIngressRule[]; originRequest?: object; 'warp-routing'?: object }`, `CfIngressRule { hostname?, path?, service, originRequest? }`, `CfDnsRecord {id,name,type,content,proxied,comment?}`
  - Test helper `startFakeCloudflare(): Promise<FakeCf>` with `{ baseUrl, state, close(), token }`. `state` exposes `accounts`, `zones`, `tunnels: Map<id, {tunnel, config, version, token}>`, `dns: Map<zoneId, CfDnsRecord[]>`, `failNext(pathRegex, status, errors)` for fault injection.

- [ ] **Step 1: Cloudflare fake** — `apps/server/test/fake-cloudflare.ts`:
```ts
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { CfDnsRecord, CfTunnel, CfTunnelConfig } from '../src/cloudflare/types';

export const FAKE_TOKEN = 'fake-token-0123456789abcdefghij';
export const FAKE_ACCOUNT = { id: 'a'.repeat(32), name: 'Home Lab' };

interface TunnelEntry { tunnel: CfTunnel; config: CfTunnelConfig; version: number; token: string }
export interface FakeState {
  accounts: { id: string; name: string }[];
  zones: { id: string; name: string; status: string }[];
  tunnels: Map<string, TunnelEntry>;
  dns: Map<string, CfDnsRecord[]>;
  failures: { re: RegExp; method?: string; status: number; errors: { code: number; message: string }[] }[];
  failNext(re: RegExp, status: number, errors?: { code: number; message: string }[], method?: string): void;
}

export async function startFakeCloudflare() {
  const state: FakeState = {
    accounts: [FAKE_ACCOUNT],
    zones: [{ id: 'z'.repeat(31) + '1', name: 'example.com', status: 'active' }, { id: 'z'.repeat(31) + '2', name: 'other.dev', status: 'active' }],
    tunnels: new Map(), dns: new Map(), failures: [],
    failNext(re, status, errors = [{ code: 1000, message: 'injected' }], method) { this.failures.push({ re, status, errors, method }); },
  };
  for (const z of state.zones) state.dns.set(z.id, []);

  const app = Fastify();
  const ok = (result: unknown, extra: object = {}) => ({ success: true, errors: [], messages: [], result, ...extra });
  const fail = (reply: FastifyReply, status: number, errors: { code: number; message: string }[]) =>
    reply.code(status).send({ success: false, errors, messages: [], result: null });

  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) return fail(reply, 401, [{ code: 10000, message: 'Authentication error' }]);
    const i = state.failures.findIndex((f) => f.re.test(req.url) && (!f.method || f.method === req.method));
    if (i >= 0) { const f = state.failures.splice(i, 1)[0]!; return fail(reply, f.status, f.errors); }
  });

  const entry = (id: string, reply: FastifyReply) => {
    const e = state.tunnels.get(id);
    if (!e || e.tunnel.deleted_at) { fail(reply, 404, [{ code: 1003, message: 'Tunnel not found' }]); return null; }
    return e;
  };

  app.get('/user/tokens/verify', async () => ok({ id: 't1', status: 'active' }));
  app.get('/accounts', async () => ok(state.accounts, { result_info: { page: 1, per_page: 50, total_pages: 1, count: state.accounts.length } }));
  app.get('/zones', async () => ok(state.zones, { result_info: { page: 1, per_page: 50, total_pages: 1, count: state.zones.length } }));

  app.get('/accounts/:a/cfd_tunnel', async () => {
    const list = [...state.tunnels.values()].filter((e) => !e.tunnel.deleted_at).map((e) => e.tunnel);
    return ok(list, { result_info: { page: 1, per_page: 100, total_pages: 1, count: list.length } });
  });
  app.post('/accounts/:a/cfd_tunnel', async (req) => {
    const { name, config_src } = req.body as { name: string; config_src: 'cloudflare' | 'local' };
    const id = randomUUID();
    const tunnel: CfTunnel = { id, name, created_at: new Date().toISOString(), deleted_at: null, status: 'inactive', config_src, connections: [] };
    state.tunnels.set(id, { tunnel, config: { ingress: [{ service: 'http_status:404' }] }, version: 0, token: `tok-${id}` });
    return ok(tunnel);
  });
  app.get('/accounts/:a/cfd_tunnel/:id', async (req, reply) => { const e = entry((req.params as { id: string }).id, reply); return e && ok(e.tunnel); });
  app.patch('/accounts/:a/cfd_tunnel/:id', async (req, reply) => {
    const e = entry((req.params as { id: string }).id, reply); if (!e) return;
    e.tunnel.name = (req.body as { name: string }).name; return ok(e.tunnel);
  });
  app.delete('/accounts/:a/cfd_tunnel/:id', async (req, reply) => {
    const e = entry((req.params as { id: string }).id, reply); if (!e) return;
    if (e.tunnel.connections.length) return fail(reply, 400, [{ code: 1022, message: 'Cannot delete tunnel with active connections' }]);
    e.tunnel.deleted_at = new Date().toISOString(); return ok(e.tunnel);
  });
  app.delete('/accounts/:a/cfd_tunnel/:id/connections', async (req, reply) => {
    const e = entry((req.params as { id: string }).id, reply); if (!e) return;
    e.tunnel.connections = []; e.tunnel.status = 'inactive'; return ok(null);
  });
  app.get('/accounts/:a/cfd_tunnel/:id/token', async (req, reply) => { const e = entry((req.params as { id: string }).id, reply); return e && ok(e.token); });
  app.get('/accounts/:a/cfd_tunnel/:id/configurations', async (req, reply) => {
    const e = entry((req.params as { id: string }).id, reply); if (!e) return;
    return ok({ tunnel_id: e.tunnel.id, version: e.version, config: e.config, source: 'cloudflare' });
  });
  app.put('/accounts/:a/cfd_tunnel/:id/configurations', async (req, reply) => {
    const e = entry((req.params as { id: string }).id, reply); if (!e) return;
    e.config = (req.body as { config: CfTunnelConfig }).config; e.version += 1;
    return ok({ tunnel_id: e.tunnel.id, version: e.version, config: e.config, source: 'cloudflare' });
  });

  app.get('/zones/:z/dns_records', async (req) => {
    const name = (req.query as Record<string, string>)['name.exact'];
    const list = (state.dns.get((req.params as { z: string }).z) ?? []).filter((r) => !name || r.name === name);
    return ok(list, { result_info: { page: 1, per_page: 100, total_pages: 1, count: list.length } });
  });
  app.post('/zones/:z/dns_records', async (req, reply) => {
    const z = (req.params as { z: string }).z; const b = req.body as Omit<CfDnsRecord, 'id'>;
    const list = state.dns.get(z)!;
    if (list.some((r) => r.name === b.name)) return fail(reply, 400, [{ code: 81053, message: 'An A, AAAA, or CNAME record with that host already exists.' }]);
    const rec = { ...b, id: randomUUID().replace(/-/g, '') }; list.push(rec); return ok(rec);
  });
  app.put('/zones/:z/dns_records/:r', async (req) => {
    const { z, r } = req.params as { z: string; r: string };
    const list = state.dns.get(z)!; const i = list.findIndex((x) => x.id === r);
    list[i] = { ...(req.body as CfDnsRecord), id: r }; return ok(list[i]);
  });
  app.delete('/zones/:z/dns_records/:r', async (req, reply) => {
    const { z, r } = req.params as { z: string; r: string };
    const list = state.dns.get(z)!; const i = list.findIndex((x) => x.id === r);
    if (i < 0) return fail(reply, 404, [{ code: 81044, message: 'Record does not exist.' }]);
    list.splice(i, 1); return ok({ id: r });
  });

  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { baseUrl: address, state, token: FAKE_TOKEN, close: () => app.close() };
}
export type FakeCf = Awaited<ReturnType<typeof startFakeCloudflare>>;
```

- [ ] **Step 2: Failing tests** — `apps/server/src/cloudflare/api.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_ACCOUNT, startFakeCloudflare, type FakeCf } from '../../test/fake-cloudflare';
import { CfApi } from './api';
import { CfClient } from './client';
import { AppError } from '../errors';

let cf: FakeCf; let api: CfApi; let client: CfClient;
beforeEach(async () => {
  cf = await startFakeCloudflare();
  client = new CfClient({ token: cf.token, baseUrl: cf.baseUrl });
  api = new CfApi(client, FAKE_ACCOUNT.id);
});
afterEach(() => cf.close());

describe('CfApi', () => {
  it('verifies token and lists accounts and zones', async () => {
    expect((await CfApi.verifyToken(client)).status).toBe('active');
    expect(await CfApi.listAccounts(client)).toEqual([FAKE_ACCOUNT]);
    expect((await api.listZones()).map((z) => z.name)).toEqual(['example.com', 'other.dev']);
  });
  it('creates a remotely-managed tunnel and fetches its token and config', async () => {
    const t = await api.createTunnel('home');
    expect(t.config_src).toBe('cloudflare');
    expect(await api.getTunnelToken(t.id)).toBe(`tok-${t.id}`);
    expect(await api.getConfig(t.id)).toEqual({ version: 0, config: { ingress: [{ service: 'http_status:404' }] } });
    expect((await api.putConfig(t.id, { ingress: [{ service: 'http_status:404' }] })).version).toBe(1);
  });
  it('maps bad token to CF_TOKEN_INVALID', async () => {
    const bad = new CfClient({ token: 'nope-nope-nope-nope-nope', baseUrl: cf.baseUrl });
    await expect(CfApi.verifyToken(bad)).rejects.toMatchObject({ code: 'CF_TOKEN_INVALID', status: 401 });
  });
  it('maps 403 to CF_PERMISSION_MISSING', async () => {
    cf.state.failNext(/dns_records/, 403, [{ code: 10000, message: 'Authentication error' }]);
    await expect(api.findDnsRecords(cf.state.zones[0]!.id, 'a.example.com')).rejects.toMatchObject({ code: 'CF_PERMISSION_MISSING' });
  });
  it('maps 429 to CF_RATE_LIMITED', async () => {
    cf.state.failNext(/zones/, 429);
    await expect(api.listZones()).rejects.toMatchObject({ code: 'CF_RATE_LIMITED' });
  });
  it('maps missing tunnel to TUNNEL_NOT_FOUND', async () => {
    await expect(api.getTunnel('6ff42ae2-765d-4adf-8112-31c55c1551ef')).rejects.toMatchObject({ code: 'TUNNEL_NOT_FOUND', status: 404 });
  });
  it('maps network failure to CF_UNREACHABLE', async () => {
    const dead = new CfClient({ token: cf.token, baseUrl: 'http://127.0.0.1:1' });
    const err = await CfApi.verifyToken(dead).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('CF_UNREACHABLE');
  });
  it('creates, finds and deletes CNAME', async () => {
    const z = cf.state.zones[0]!.id;
    const rec = await api.createCname(z, 'app.example.com', 'x.cfargotunnel.com');
    expect(rec.proxied).toBe(true);
    expect((await api.findDnsRecords(z, 'app.example.com'))[0]!.content).toBe('x.cfargotunnel.com');
    await api.deleteDnsRecord(z, rec.id);
    expect(await api.findDnsRecords(z, 'app.example.com')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run** — FAIL.

- [ ] **Step 4: Implement**

`apps/server/src/cloudflare/types.ts`:
```ts
export interface CfAccount { id: string; name: string }
export interface CfZone { id: string; name: string; status: string }
export interface CfConnection { colo_name: string; opened_at: string; origin_ip: string; client_version: string; is_pending_reconnect: boolean }
export interface CfTunnel {
  id: string; name: string; created_at: string; deleted_at: string | null;
  status: 'inactive' | 'degraded' | 'healthy' | 'down'; config_src: 'cloudflare' | 'local'; connections: CfConnection[];
}
export interface CfIngressRule { hostname?: string; path?: string; service: string; originRequest?: Record<string, unknown> }
export interface CfTunnelConfig { ingress: CfIngressRule[]; originRequest?: Record<string, unknown>; 'warp-routing'?: Record<string, unknown> }
export interface CfDnsRecord { id: string; name: string; type: string; content: string; proxied: boolean; comment?: string | null }
export interface CfEnvelope<T> {
  success: boolean; result: T; errors: { code: number; message: string }[];
  result_info?: { page: number; per_page: number; total_pages: number; count: number };
}
```

`apps/server/src/cloudflare/client.ts`:
```ts
import { AppError } from '../errors';
import type { CfEnvelope } from './types';

export class CfClient {
  private fetchImpl: typeof fetch;
  constructor(private opts: { token: string; baseUrl: string; fetch?: typeof fetch }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async raw<T>(method: string, path: string, body?: unknown): Promise<CfEnvelope<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.opts.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new AppError('CF_UNREACHABLE', `Cloudflare API unreachable: ${(e as Error).message}`, 502);
    }
    let env: CfEnvelope<T>;
    try { env = (await res.json()) as CfEnvelope<T>; } catch {
      throw new AppError('CF_API_ERROR', `Invalid response from Cloudflare (HTTP ${res.status})`, 502);
    }
    if (res.ok && env.success) return env;
    const msg = env.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    if (res.status === 401) throw new AppError('CF_TOKEN_INVALID', msg, 401, env.errors);
    if (res.status === 403) throw new AppError('CF_PERMISSION_MISSING', msg, 403, env.errors);
    if (res.status === 429) throw new AppError('CF_RATE_LIMITED', msg, 429, env.errors);
    if (res.status === 404 && path.includes('/cfd_tunnel/')) throw new AppError('TUNNEL_NOT_FOUND', msg, 404, env.errors);
    throw new AppError('CF_API_ERROR', msg, 502, env.errors);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.raw<T>(method, path, body)).result;
  }

  async paginate<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const env = await this.raw<T[]>('GET', `${path}${sep}page=${page}`);
      out.push(...env.result);
      if (!env.result_info || page >= env.result_info.total_pages) return out;
    }
  }
}
```

`apps/server/src/cloudflare/api.ts`:
```ts
import type { CfClient } from './client';
import type { CfAccount, CfDnsRecord, CfTunnel, CfTunnelConfig, CfZone } from './types';

export const MANAGED_COMMENT = 'managed by cloudflared-manager';

export class CfApi {
  constructor(private c: CfClient, public readonly accountId: string) {}
  static verifyToken(c: CfClient) { return c.request<{ status: string }>('GET', '/user/tokens/verify'); }
  static listAccounts(c: CfClient) {
    return c.paginate<CfAccount>('/accounts?per_page=50').then((l) => l.map(({ id, name }) => ({ id, name })));
  }
  private get t() { return `/accounts/${this.accountId}/cfd_tunnel`; }

  listZones() {
    return this.c.paginate<CfZone>(`/zones?account.id=${this.accountId}&per_page=50`)
      .then((l) => l.map(({ id, name, status }) => ({ id, name, status })));
  }
  listTunnels() { return this.c.paginate<CfTunnel>(`${this.t}?is_deleted=false&per_page=100`); }
  getTunnel(id: string) { return this.c.request<CfTunnel>('GET', `${this.t}/${id}`); }
  createTunnel(name: string) { return this.c.request<CfTunnel>('POST', this.t, { name, config_src: 'cloudflare' }); }
  renameTunnel(id: string, name: string) { return this.c.request<CfTunnel>('PATCH', `${this.t}/${id}`, { name }); }
  deleteTunnel(id: string) { return this.c.request<CfTunnel>('DELETE', `${this.t}/${id}`); }
  cleanupConnections(id: string) { return this.c.request<null>('DELETE', `${this.t}/${id}/connections`); }
  getTunnelToken(id: string) { return this.c.request<string>('GET', `${this.t}/${id}/token`); }
  async getConfig(id: string) {
    const r = await this.c.request<{ version: number; config: CfTunnelConfig | null }>('GET', `${this.t}/${id}/configurations`);
    return { version: r.version, config: r.config ?? { ingress: [{ service: 'http_status:404' }] } };
  }
  async putConfig(id: string, config: CfTunnelConfig) {
    const r = await this.c.request<{ version: number }>('PUT', `${this.t}/${id}/configurations`, { config });
    return { version: r.version };
  }
  findDnsRecords(zoneId: string, name: string) {
    return this.c.paginate<CfDnsRecord>(`/zones/${zoneId}/dns_records?name.exact=${encodeURIComponent(name)}&per_page=100`);
  }
  createCname(zoneId: string, name: string, target: string) {
    return this.c.request<CfDnsRecord>('POST', `/zones/${zoneId}/dns_records`,
      { type: 'CNAME', name, content: target, proxied: true, ttl: 1, comment: MANAGED_COMMENT });
  }
  updateCname(zoneId: string, recordId: string, name: string, target: string) {
    return this.c.request<CfDnsRecord>('PUT', `/zones/${zoneId}/dns_records/${recordId}`,
      { type: 'CNAME', name, content: target, proxied: true, ttl: 1, comment: MANAGED_COMMENT });
  }
  deleteDnsRecord(zoneId: string, recordId: string) {
    return this.c.request<{ id: string }>('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }
}
```

- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(server): add Cloudflare REST client and in-memory fake"`

---

### Task 5: Pure ingress and zone functions

**Files:**
- Create: `apps/server/src/tunnels/ingress.ts`, `apps/server/src/tunnels/zones.ts`
- Test: `apps/server/src/tunnels/ingress.test.ts`

**Interfaces:**
- Produces:
  - `configToRoutes(config: CfTunnelConfig): Route[]` — removes the last rule if it has no `hostname` (catch-all); rules without a hostname in the middle are kept out (ignored) and counted in `ignoredRules`.
  - `routesToConfig(routes: Route[], base: CfTunnelConfig): CfTunnelConfig` — preserves the global `originRequest` and `warp-routing` from `base`, appends `{ service: 'http_status:404' }` at the end.
  - `diffHostnames(before: Route[], after: Route[]): { added: string[]; removed: string[] }` — by unique hostname (a host used by several rules is only "removed" when no rule uses it anymore).
  - `findZoneForHostname(hostname: string, zones: {id,name}[]): {id,name} | null` — longest suffix match; `*.example.com` matches `example.com`.
  - `tunnelTarget(tunnelId: string): string` → `${tunnelId}.cfargotunnel.com`

- [ ] **Step 1: Failing tests** — `apps/server/src/tunnels/ingress.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { configToRoutes, diffHostnames, routesToConfig } from './ingress';
import { findZoneForHostname } from './zones';

const r = (hostname: string, service = 'http://10.0.0.1:80', path?: string) => ({ hostname, service, ...(path ? { path } : {}) });

describe('configToRoutes / routesToConfig', () => {
  it('strips catch-all and re-adds it at the end', () => {
    const cfg = { ingress: [r('a.example.com'), { service: 'http_status:404' }] };
    const routes = configToRoutes(cfg);
    expect(routes).toEqual([r('a.example.com')]);
    expect(routesToConfig(routes, cfg).ingress.at(-1)).toEqual({ service: 'http_status:404' });
  });
  it('preserves global originRequest and warp-routing', () => {
    const base = { ingress: [{ service: 'http_status:404' }], originRequest: { connectTimeout: '5s' }, 'warp-routing': { enabled: true } };
    const out = routesToConfig([r('a.example.com')], base);
    expect(out.originRequest).toEqual({ connectTimeout: '5s' });
    expect(out['warp-routing']).toEqual({ enabled: true });
  });
  it('handles empty ingress', () => {
    expect(configToRoutes({ ingress: [] })).toEqual([]);
  });
});

describe('diffHostnames', () => {
  it('detects added and removed hosts', () => {
    expect(diffHostnames([r('a.example.com')], [r('b.example.com')])).toEqual({ added: ['b.example.com'], removed: ['a.example.com'] });
  });
  it('does not remove host still used by another path rule', () => {
    const before = [r('a.example.com', 'http://x:1', '^/api'), r('a.example.com')];
    const after = [r('a.example.com')];
    expect(diffHostnames(before, after)).toEqual({ added: [], removed: [] });
  });
});

describe('findZoneForHostname', () => {
  const zones = [{ id: '1', name: 'example.com' }, { id: '2', name: 'sub.example.com' }, { id: '3', name: 'other.dev' }];
  it('picks longest suffix', () => {
    expect(findZoneForHostname('x.sub.example.com', zones)?.id).toBe('2');
    expect(findZoneForHostname('a.example.com', zones)?.id).toBe('1');
    expect(findZoneForHostname('example.com', zones)?.id).toBe('1');
  });
  it('does not match partial labels', () => {
    expect(findZoneForHostname('notexample.com', zones)).toBeNull();
  });
  it('supports wildcard', () => {
    expect(findZoneForHostname('*.other.dev', zones)?.id).toBe('3');
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`apps/server/src/tunnels/ingress.ts`:
```ts
import type { Route } from '@tm/shared';
import type { CfIngressRule, CfTunnelConfig } from '../cloudflare/types';

export const CATCH_ALL: CfIngressRule = { service: 'http_status:404' };
export const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`;

export function configToRoutes(config: CfTunnelConfig): Route[] {
  return (config.ingress ?? [])
    .filter((rule) => !!rule.hostname)
    .map((rule) => ({
      hostname: rule.hostname!,
      ...(rule.path ? { path: rule.path } : {}),
      service: rule.service,
      ...(rule.originRequest && Object.keys(rule.originRequest).length ? { originRequest: rule.originRequest as Route['originRequest'] } : {}),
    }));
}

export function routesToConfig(routes: Route[], base: CfTunnelConfig): CfTunnelConfig {
  const ingress: CfIngressRule[] = routes.map((r) => ({
    hostname: r.hostname,
    ...(r.path ? { path: r.path } : {}),
    service: r.service,
    ...(r.originRequest ? { originRequest: r.originRequest } : {}),
  }));
  return {
    ...(base.originRequest ? { originRequest: base.originRequest } : {}),
    ...(base['warp-routing'] ? { 'warp-routing': base['warp-routing'] } : {}),
    ingress: [...ingress, CATCH_ALL],
  };
}

export function diffHostnames(before: Route[], after: Route[]) {
  const b = new Set(before.map((r) => r.hostname));
  const a = new Set(after.map((r) => r.hostname));
  return { added: [...a].filter((h) => !b.has(h)), removed: [...b].filter((h) => !a.has(h)) };
}
```

`apps/server/src/tunnels/zones.ts`:
```ts
export function findZoneForHostname<Z extends { id: string; name: string }>(hostname: string, zones: Z[]): Z | null {
  const host = hostname.replace(/^\*\./, '');
  let best: Z | null = null;
  for (const z of zones) {
    if ((host === z.name || host.endsWith(`.${z.name}`)) && (!best || z.name.length > best.name.length)) best = z;
  }
  return best;
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): add ingress and zone helpers"`

---

### Task 6: Service backend (systemd + fake) and the `.env` file

**Files:**
- Create: `apps/server/src/services/{backend.ts,env-file.ts,systemd-backend.ts,fake-backend.ts}`
- Test: `apps/server/src/services/services.test.ts`

**Interfaces:**
- Produces:
```ts
export interface TunnelEnv { token: string; metricsPort: number; logLevel: LogLevel; protocol: Protocol }
export interface UnitStatus { state: LocalState; activeSince: string | null; restarts: number }
export interface LogLine { time: string; level: 'debug'|'info'|'warn'|'error'|'fatal'; message: string }
export interface ServiceBackend {
  install(tunnelId: string, env: TunnelEnv): Promise<void>;   // escreve .env (0600) e `enable`
  updateEnv(tunnelId: string, env: TunnelEnv): Promise<void>; // rewrites .env (no restart)
  uninstall(tunnelId: string): Promise<void>;                 // stop + disable + remove .env; idempotente
  isInstalled(tunnelId: string): boolean;                     // .env existe
  start(id: string): Promise<void>; stop(id: string): Promise<void>; restart(id: string): Promise<void>;
  status(id: string): Promise<UnitStatus>;
  logs(id: string, lines: number): Promise<LogLine[]>;
  followLogs(id: string, onLine: (l: LogLine) => void): () => void; // returns unsubscribe
  cloudflaredVersion(): Promise<string | null>;
  upgradeCloudflared(): Promise<void>;
}
export function renderEnvFile(env: TunnelEnv): string;
export function parseEnvFile(text: string): TunnelEnv;
export function envFilePath(etcDir: string, tunnelId: string): string; // validates UUID; throws VALIDATION_ERROR
export function parseJournalLine(json: string): LogLine | null;
export class SystemdBackend implements ServiceBackend { constructor(etcDir: string, run?: Runner) }
export type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
export class FakeBackend implements ServiceBackend { constructor(etcDir: string); readonly calls: string[]; setState(id, state: LocalState): void; emitLog(id, line: LogLine): void }
```

- [ ] **Step 1: Failing tests** — `apps/server/src/services/services.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envFilePath, parseEnvFile, renderEnvFile } from './env-file';
import { SystemdBackend, parseJournalLine, type Runner } from './systemd-backend';
import { FakeBackend } from './fake-backend';

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
      if (args.includes('show')) return { stdout: 'ActiveState=active\nActiveEnterTimestamp=Mon 2026-09-21 10:00:00 UTC\nNRestarts=2\n', stderr: '', code: 0 };
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
    const { run } = recorder();
    const s = await new SystemdBackend('/x', run).status(ID);
    expect(s).toEqual({ state: 'active', activeSince: expect.any(String), restarts: 2 });
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
  it('returns null for garbage', () => { expect(parseJournalLine('nope')).toBeNull(); });
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
```
(Note: the timestamp `1758535200000000` µs = 2025-09-22T10:00:00Z; the test checks the µs-to-ISO conversion.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`apps/server/src/services/backend.ts`:
```ts
import type { LocalState, LogLevel, Protocol } from '@tm/shared';
export interface TunnelEnv { token: string; metricsPort: number; logLevel: LogLevel; protocol: Protocol }
export interface UnitStatus { state: LocalState; activeSince: string | null; restarts: number }
export interface LogLine { time: string; level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'; message: string }
export interface ServiceBackend {
  install(tunnelId: string, env: TunnelEnv): Promise<void>;
  updateEnv(tunnelId: string, env: TunnelEnv): Promise<void>;
  uninstall(tunnelId: string): Promise<void>;
  isInstalled(tunnelId: string): boolean;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  status(id: string): Promise<UnitStatus>;
  logs(id: string, lines: number): Promise<LogLine[]>;
  followLogs(id: string, onLine: (l: LogLine) => void): () => void;
  cloudflaredVersion(): Promise<string | null>;
  upgradeCloudflared(): Promise<void>;
}
```

`apps/server/src/services/env-file.ts`:
```ts
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
  const kv = Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return {
    token: kv.TUNNEL_TOKEN ?? '',
    metricsPort: Number((kv.TUNNEL_METRICS ?? '').split(':')[1]),
    logLevel: (kv.TUNNEL_LOGLEVEL ?? 'info') as TunnelEnv['logLevel'],
    protocol: (kv.TUNNEL_TRANSPORT_PROTOCOL ?? 'auto') as TunnelEnv['protocol'],
  };
}

export function writeEnvFile(etcDir: string, tunnelId: string, env: TunnelEnv) {
  const path = envFilePath(etcDir, tunnelId);
  mkdirSync(join(etcDir, 'tunnels'), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, renderEnvFile(env), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
```

`apps/server/src/services/systemd-backend.ts`:
```ts
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import type { LocalState } from '@tm/shared';
import { AppError } from '../errors';
import type { LogLine, ServiceBackend, TunnelEnv, UnitStatus } from './backend';
import { envFilePath, writeEnvFile } from './env-file';

export type Runner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;

export const defaultRunner: Runner = (cmd, args) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
  p.on('error', (e) => resolve({ stdout, stderr: e.message, code: 127 }));
  p.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
});

const unit = (id: string) => `cloudflared@${id}.service`;
const LEVELS: Record<string, LogLine['level']> = { DBG: 'debug', INF: 'info', WRN: 'warn', ERR: 'error', FTL: 'fatal' };

export function parseJournalLine(json: string): LogLine | null {
  try {
    const o = JSON.parse(json) as { __REALTIME_TIMESTAMP?: string; MESSAGE?: string | number[] };
    const message = Array.isArray(o.MESSAGE) ? Buffer.from(o.MESSAGE).toString('utf8') : (o.MESSAGE ?? '');
    const tag = / (DBG|INF|WRN|ERR|FTL) /.exec(message)?.[1];
    return { time: new Date(Number(o.__REALTIME_TIMESTAMP) / 1000).toISOString(), level: tag ? LEVELS[tag]! : 'info', message };
  } catch { return null; }
}

export class SystemdBackend implements ServiceBackend {
  constructor(private etcDir: string, private run: Runner = defaultRunner) {}

  private async sudo(args: string[]) {
    const r = await this.run('sudo', ['-n', ...args]);
    if (r.code !== 0) throw new AppError('SERVICE_COMMAND_FAILED', `${args.join(' ')} failed: ${r.stderr.trim()}`, 500);
    return r;
  }
  async install(id: string, env: TunnelEnv) { writeEnvFile(this.etcDir, id, env); await this.sudo(['systemctl', 'enable', unit(id)]); }
  async updateEnv(id: string, env: TunnelEnv) { writeEnvFile(this.etcDir, id, env); }
  async uninstall(id: string) {
    const path = envFilePath(this.etcDir, id);
    await this.run('sudo', ['-n', 'systemctl', 'disable', '--now', unit(id)]); // tolerate "not loaded"
    rmSync(path, { force: true });
  }
  isInstalled(id: string) { return existsSync(envFilePath(this.etcDir, id)); }
  async start(id: string) { await this.sudo(['systemctl', 'start', unit(id)]); }
  async stop(id: string) { await this.sudo(['systemctl', 'stop', unit(id)]); }
  async restart(id: string) { await this.sudo(['systemctl', 'restart', unit(id)]); }

  async status(id: string): Promise<UnitStatus> {
    if (!this.isInstalled(id)) return { state: 'not-installed', activeSince: null, restarts: 0 };
    const r = await this.run('systemctl', ['show', unit(id), '--property=ActiveState,ActiveEnterTimestamp,NRestarts']);
    const kv = Object.fromEntries(r.stdout.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const map: Record<string, LocalState> = { active: 'active', reloading: 'active', inactive: 'inactive', failed: 'failed', activating: 'activating', deactivating: 'inactive' };
    const ts = kv.ActiveEnterTimestamp ? new Date(kv.ActiveEnterTimestamp.replace(/^\w+ /, '')) : null;
    return {
      state: map[kv.ActiveState ?? ''] ?? 'inactive',
      activeSince: kv.ActiveState === 'active' && ts && !isNaN(ts.getTime()) ? ts.toISOString() : null,
      restarts: Number(kv.NRestarts ?? 0),
    };
  }

  async logs(id: string, lines: number) {
    const r = await this.sudo(['journalctl', '-u', unit(id), '-o', 'json', '-n', String(lines), '--no-pager']);
    return r.stdout.split('\n').map(parseJournalLine).filter((l): l is LogLine => !!l);
  }

  followLogs(id: string, onLine: (l: LogLine) => void) {
    const p = spawn('sudo', ['-n', 'journalctl', '-u', unit(id), '-o', 'json', '-n', '0', '-f', '--no-pager'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      const parts = buf.split('\n'); buf = parts.pop() ?? '';
      for (const part of parts) { const l = parseJournalLine(part); if (l) onLine(l); }
    });
    return () => { p.kill('SIGTERM'); };
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
```

`apps/server/src/services/fake-backend.ts`:
```ts
import { existsSync, rmSync } from 'node:fs';
import type { LocalState } from '@tm/shared';
import type { LogLine, ServiceBackend, TunnelEnv, UnitStatus } from './backend';
import { envFilePath, writeEnvFile } from './env-file';

export class FakeBackend implements ServiceBackend {
  readonly calls: string[] = [];
  private states = new Map<string, { state: LocalState; since: string | null; restarts: number }>();
  private listeners = new Map<string, Set<(l: LogLine) => void>>();
  private history = new Map<string, LogLine[]>();
  version = '2026.9.1';

  constructor(private etcDir: string) {}
  private set(id: string, state: LocalState) {
    const prev = this.states.get(id);
    this.states.set(id, { state, since: state === 'active' ? new Date().toISOString() : null, restarts: prev?.restarts ?? 0 });
  }
  setState(id: string, state: LocalState) { this.set(id, state); }
  emitLog(id: string, line: LogLine) {
    const h = this.history.get(id) ?? []; h.push(line); this.history.set(id, h.slice(-500));
    this.listeners.get(id)?.forEach((f) => f(line));
  }
  private log(id: string, message: string) {
    this.emitLog(id, { time: new Date().toISOString(), level: 'info', message: `${new Date().toISOString()} INF ${message}` });
  }
  async install(id: string, env: TunnelEnv) { this.calls.push(`install ${id}`); writeEnvFile(this.etcDir, id, env); this.set(id, 'inactive'); }
  async updateEnv(id: string, env: TunnelEnv) { this.calls.push(`updateEnv ${id}`); writeEnvFile(this.etcDir, id, env); }
  async uninstall(id: string) { this.calls.push(`uninstall ${id}`); rmSync(envFilePath(this.etcDir, id), { force: true }); this.states.delete(id); }
  isInstalled(id: string) { return existsSync(envFilePath(this.etcDir, id)); }
  async start(id: string) { this.calls.push(`start ${id}`); this.set(id, 'active'); this.log(id, 'Registered tunnel connection connIndex=0 location=gru01'); }
  async stop(id: string) { this.calls.push(`stop ${id}`); this.set(id, 'inactive'); this.log(id, 'Initiating graceful shutdown'); }
  async restart(id: string) {
    this.calls.push(`restart ${id}`);
    const prev = this.states.get(id);
    this.set(id, 'active');
    this.states.get(id)!.restarts = (prev?.restarts ?? 0) + 1;
    this.log(id, 'Restarted');
  }
  async status(id: string): Promise<UnitStatus> {
    if (!this.isInstalled(id)) return { state: 'not-installed', activeSince: null, restarts: 0 };
    const s = this.states.get(id) ?? { state: 'inactive' as LocalState, since: null, restarts: 0 };
    return { state: s.state, activeSince: s.since, restarts: s.restarts };
  }
  async logs(id: string, lines: number) { return (this.history.get(id) ?? []).slice(-lines); }
  followLogs(id: string, onLine: (l: LogLine) => void) {
    const set = this.listeners.get(id) ?? new Set(); set.add(onLine); this.listeners.set(id, set);
    return () => { set.delete(onLine); };
  }
  async cloudflaredVersion() { return this.version; }
  async upgradeCloudflared() { this.calls.push('upgrade'); }
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): add systemd and fake service backends"`

---

### Task 7: Tunnel orchestration (`TunnelService`)

**Files:**
- Create: `apps/server/src/tunnels/{tunnel-repo.ts,dns-repo.ts,tunnel-service.ts}`, `apps/server/src/events/event-repo.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/src/tunnels/tunnel-service.test.ts`

**Interfaces:**
- Consumes: `CfApi`, `ServiceBackend`, `configToRoutes`, `routesToConfig`, `diffHostnames`, `findZoneForHostname`, `tunnelTarget`, `Db`
- Produces:
```ts
export interface TunnelRow { id: string; metricsPort: number; keepAlive: boolean; toleranceMinutes: number; logLevel: LogLevel; protocol: Protocol;
  watchdogState: WatchdogState; degradedSince: number | null; restartAttempts: number; nextRestartAt: number | null }
export class TunnelRepo { constructor(db: Db); list(): TunnelRow[]; get(id): TunnelRow | null; insert(id: string, metricsPort: number): TunnelRow;
  update(id: string, patch: Partial<Omit<TunnelRow,'id'>>): void; delete(id): void; nextMetricsPort(): number /* max+1, min 20241 */ }
export class DnsRepo { constructor(db: Db); byHostname(h): ManagedDns | null; byTunnel(id): ManagedDns[]; upsert(r: ManagedDns): void; delete(recordId): void; all(): ManagedDns[] }
export interface ManagedDns { recordId: string; zoneId: string; hostname: string; tunnelId: string }
export class EventRepo { constructor(db: Db, now?: () => number); add(tunnelId: string | null, type: EventType, message: string): void;
  list(opts: { tunnelId?: string; limit?: number }): TunnelEvent[]; prune(maxAgeMs = 30*24*3600e3): void }
export class TunnelService {
  constructor(deps: { api: () => CfApi; backend: ServiceBackend; tunnels: TunnelRepo; dns: DnsRepo; events: EventRepo });
  list(): Promise<TunnelSummary[]>;
  get(id: string): Promise<TunnelDetail>;
  create(name: string): Promise<TunnelSummary>;           // cria, instala, inicia
  adopt(id: string): Promise<TunnelSummary>;              // config_src cloudflare only; installs and starts
  update(id: string, patch: UpdateTunnel): Promise<TunnelSummary>; // rename via API; the rest is local; logLevel/protocol => updateEnv + restart if active
  start(id): Promise<void>; stop(id): Promise<void>; restart(id): Promise<void>;
  delete(id: string): Promise<void>;
  updateRoutes(id: string, input: RoutesUpdate): Promise<TunnelDetail>;
}
```
`api` is a (lazy) function because credentials can change at runtime; it throws `CF_NOT_CONNECTED` (409) if there's no token.

`updateRoutes` rules (in order):
1. `getConfig` → if `version !== input.version` → `CONFIG_VERSION_CONFLICT` (409, `details: { currentVersion }`).
2. `zones = listZones()`; for each route, `findZoneForHostname`; if none found → `ZONE_NOT_FOUND` (400, `details: { hostnames }`).
3. `{added, removed} = diffHostnames(before, after)`. For each `added`: `findDnsRecords`. If no record exists → create it. If a CNAME exists with `content === tunnelTarget(id)` → reuse it (upsert into `managed_dns`). If another destination exists and the host isn't in `overwriteDns` → add it to `conflicts`. If there are conflicts → `DNS_CONFLICT` (409, `details: { hostnames: conflicts }`) **before** any write.
4. `putConfig(routesToConfig(after, before))`.
5. DNS for `added`: create (or `updateCname` if overwriting). On any failure: `putConfig(beforeConfig)` (rollback), delete the CNAMEs created in this call, rethrow the error.
6. DNS for `removed`: for each host in this tunnel's `managed_dns` that is not in `keepDns`, `deleteDnsRecord` (404 ignored) and remove it from the repo. A failure here does not undo the ingress; it is recorded as a `config-changed` event with a warning and continues.
7. `config-changed` event; returns `get(id)`.

`delete` rules (idempotent): if installed → `backend.uninstall`; `cleanupConnections` (errors ignored except `CF_UNREACHABLE`/`CF_TOKEN_INVALID`); for each `managed_dns` entry of the tunnel → `deleteDnsRecord` (404 ignored) and remove it from the repo; `deleteTunnel` (`TUNNEL_NOT_FOUND` ignored); `tunnels.delete(id)`; `deleted` event.

Combined status in `list()`: `listTunnels()` from the API; for each tunnel, `local = backend.status(id)`, `settings` from the repo (null if not managed here), `routeCount` via `getConfig` **only** for `managedHere` tunnels (avoids N calls; the rest show 0), `watchdog = row?.keepAlive === false ? 'disabled' : row?.watchdogState ?? 'disabled'`. Tunnels in the repo that no longer come from the API (deleted from the dashboard) show up with `edgeStatus: 'down'`, `name: '(deleted in Cloudflare)'`, `remote: true`, so the user can delete them locally.

- [ ] **Step 1: Test helpers** — `apps/server/test/helpers.ts`:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CfApi } from '../src/cloudflare/api';
import { CfClient } from '../src/cloudflare/client';
import { openDatabase } from '../src/db/database';
import { EventRepo } from '../src/events/event-repo';
import { FakeBackend } from '../src/services/fake-backend';
import { DnsRepo } from '../src/tunnels/dns-repo';
import { TunnelRepo } from '../src/tunnels/tunnel-repo';
import { TunnelService } from '../src/tunnels/tunnel-service';
import { FAKE_ACCOUNT, startFakeCloudflare } from './fake-cloudflare';

export async function makeTunnelEnv() {
  const cf = await startFakeCloudflare();
  const db = openDatabase(':memory:');
  const backend = new FakeBackend(mkdtempSync(join(tmpdir(), 'tm-')));
  const api = new CfApi(new CfClient({ token: cf.token, baseUrl: cf.baseUrl }), FAKE_ACCOUNT.id);
  const repos = { tunnels: new TunnelRepo(db), dns: new DnsRepo(db), events: new EventRepo(db) };
  const service = new TunnelService({ api: () => api, backend, ...repos });
  return { cf, db, backend, api, service, ...repos };
}
```

- [ ] **Step 2: Failing tests** — `apps/server/src/tunnels/tunnel-service.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTunnelEnv } from '../../test/helpers';

let env: Awaited<ReturnType<typeof makeTunnelEnv>>;
beforeEach(async () => { env = await makeTunnelEnv(); });
afterEach(() => env.cf.close());
const zone1 = () => env.cf.state.zones[0]!.id;
const zone2 = () => env.cf.state.zones[1]!.id;
const route = (hostname: string, path?: string) => ({ hostname, service: 'http://10.0.0.5:8080', ...(path ? { path } : {}) });

describe('create / list', () => {
  it('creates remote tunnel, installs and starts unit', async () => {
    const t = await env.service.create('home');
    expect(t.managedHere).toBe(true);
    expect(t.settings?.metricsPort).toBe(20241);
    expect(env.backend.calls).toEqual([`install ${t.id}`, `start ${t.id}`]);
    expect(env.cf.state.tunnels.get(t.id)!.tunnel.config_src).toBe('cloudflare');
    const second = await env.service.create('lab');
    expect(second.settings?.metricsPort).toBe(20242);
    expect((await env.service.list()).map((x) => x.name).sort()).toEqual(['home', 'lab']);
  });
  it('lists unmanaged remote tunnels with managedHere=false', async () => {
    const t = await env.api.createTunnel('elsewhere');
    const [s] = await env.service.list();
    expect(s).toMatchObject({ id: t.id, managedHere: false, local: 'not-installed', settings: null });
  });
});

describe('adopt', () => {
  it('installs existing remote tunnel', async () => {
    const t = await env.api.createTunnel('elsewhere');
    const s = await env.service.adopt(t.id);
    expect(s.managedHere).toBe(true);
    expect(env.backend.calls).toContain(`start ${t.id}`);
  });
  it('refuses local-config tunnels', async () => {
    const id = (await env.api.createTunnel('x')).id;
    env.cf.state.tunnels.get(id)!.tunnel.config_src = 'local';
    await expect(env.service.adopt(id)).rejects.toMatchObject({ code: 'TUNNEL_NOT_REMOTE' });
  });
});

describe('updateRoutes', () => {
  it('adds routes across two zones and creates CNAMEs', async () => {
    const t = await env.service.create('home');
    const d = await env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com'), route('git.other.dev')], overwriteDns: [], keepDns: [] });
    expect(d.routes).toHaveLength(2);
    expect(d.configVersion).toBe(1);
    expect(env.cf.state.tunnels.get(t.id)!.config.ingress.at(-1)).toEqual({ service: 'http_status:404' });
    expect(env.cf.state.dns.get(zone1())![0]).toMatchObject({ name: 'ha.example.com', content: `${t.id}.cfargotunnel.com`, proxied: true });
    expect(env.cf.state.dns.get(zone2())![0]!.name).toBe('git.other.dev');
    expect(env.dns.byTunnel(t.id)).toHaveLength(2);
  });
  it('rejects stale version', async () => {
    const t = await env.service.create('home');
    await env.api.putConfig(t.id, { ingress: [{ service: 'http_status:404' }] }); // edited in dashboard
    await expect(env.service.updateRoutes(t.id, { version: 0, routes: [], overwriteDns: [], keepDns: [] }))
      .rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', status: 409 });
  });
  it('rejects hostname outside account zones before writing', async () => {
    const t = await env.service.create('home');
    await expect(env.service.updateRoutes(t.id, { version: 0, routes: [route('a.notmine.io')], overwriteDns: [], keepDns: [] }))
      .rejects.toMatchObject({ code: 'ZONE_NOT_FOUND', details: { hostnames: ['a.notmine.io'] } });
    expect(env.cf.state.tunnels.get(t.id)!.version).toBe(0);
  });
  it('reports DNS conflict without writing, then overwrites when asked', async () => {
    const t = await env.service.create('home');
    env.cf.state.dns.get(zone1())!.push({ id: 'r1', name: 'ha.example.com', type: 'A', content: '1.2.3.4', proxied: false });
    await expect(env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com')], overwriteDns: [], keepDns: [] }))
      .rejects.toMatchObject({ code: 'DNS_CONFLICT', details: { hostnames: ['ha.example.com'] } });
    expect(env.cf.state.tunnels.get(t.id)!.version).toBe(0);
    await env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com')], overwriteDns: ['ha.example.com'], keepDns: [] });
    expect(env.cf.state.dns.get(zone1())!.find((r) => r.name === 'ha.example.com')!.content).toBe(`${t.id}.cfargotunnel.com`);
  });
  it('reuses CNAME already pointing to this tunnel', async () => {
    const t = await env.service.create('home');
    env.cf.state.dns.get(zone1())!.push({ id: 'r9', name: 'ha.example.com', type: 'CNAME', content: `${t.id}.cfargotunnel.com`, proxied: true });
    await env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com')], overwriteDns: [], keepDns: [] });
    expect(env.cf.state.dns.get(zone1())).toHaveLength(1);
    expect(env.dns.byHostname('ha.example.com')?.recordId).toBe('r9');
  });
  it('rolls back ingress when DNS creation fails', async () => {
    const t = await env.service.create('home');
    env.cf.state.failNext(/dns_records$/, 500, [{ code: 1000, message: 'boom' }], 'POST');
    await expect(env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com')], overwriteDns: [], keepDns: [] })).rejects.toBeTruthy();
    const e = env.cf.state.tunnels.get(t.id)!;
    expect(e.config.ingress).toEqual([{ service: 'http_status:404' }]);
  });
  it('removes CNAME only when no rule uses the host anymore', async () => {
    const t = await env.service.create('home');
    let d = await env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com', '^/api'), route('ha.example.com')], overwriteDns: [], keepDns: [] });
    d = await env.service.updateRoutes(t.id, { version: d.configVersion, routes: [route('ha.example.com')], overwriteDns: [], keepDns: [] });
    expect(env.cf.state.dns.get(zone1())).toHaveLength(1);
    await env.service.updateRoutes(t.id, { version: d.configVersion, routes: [], overwriteDns: [], keepDns: [] });
    expect(env.cf.state.dns.get(zone1())).toHaveLength(0);
    expect(env.dns.byTunnel(t.id)).toHaveLength(0);
  });
  it('keeps DNS when listed in keepDns', async () => {
    const t = await env.service.create('home');
    const d = await env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com')], overwriteDns: [], keepDns: [] });
    await env.service.updateRoutes(t.id, { version: d.configVersion, routes: [], overwriteDns: [], keepDns: ['ha.example.com'] });
    expect(env.cf.state.dns.get(zone1())).toHaveLength(1);
  });
});

describe('delete', () => {
  it('removes unit, managed DNS and remote tunnel even with active connections', async () => {
    const t = await env.service.create('home');
    await env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com')], overwriteDns: [], keepDns: [] });
    env.cf.state.tunnels.get(t.id)!.tunnel.connections = [{ colo_name: 'gru01', opened_at: '', origin_ip: '', client_version: '', is_pending_reconnect: false }];
    await env.service.delete(t.id);
    expect(env.backend.calls).toContain(`uninstall ${t.id}`);
    expect(env.cf.state.dns.get(zone1())).toHaveLength(0);
    expect(env.cf.state.tunnels.get(t.id)!.tunnel.deleted_at).not.toBeNull();
    expect(env.tunnels.get(t.id)).toBeNull();
  });
  it('is idempotent when parts are already gone', async () => {
    const t = await env.service.create('home');
    await env.service.updateRoutes(t.id, { version: 0, routes: [route('ha.example.com')], overwriteDns: [], keepDns: [] });
    env.cf.state.dns.get(zone1())!.length = 0;          // DNS removed manually
    env.cf.state.tunnels.get(t.id)!.tunnel.deleted_at = 'x'; // tunnel removed in dashboard
    await expect(env.service.delete(t.id)).resolves.toBeUndefined();
    expect(env.dns.byTunnel(t.id)).toHaveLength(0);
  });
});

describe('update settings', () => {
  it('renames remotely and rewrites env + restarts when logLevel changes on active tunnel', async () => {
    const t = await env.service.create('home');
    const s = await env.service.update(t.id, { name: 'house', logLevel: 'debug', keepAlive: false });
    expect(s.name).toBe('house');
    expect(s.settings).toMatchObject({ logLevel: 'debug', keepAlive: false });
    expect(s.watchdog).toBe('disabled');
    expect(env.backend.calls.slice(-2)).toEqual([`updateEnv ${t.id}`, `restart ${t.id}`]);
  });
});
```

- [ ] **Step 3: Run** — FAIL.

- [ ] **Step 4: Implement repos** — `apps/server/src/tunnels/tunnel-repo.ts`:
```ts
import type { LogLevel, Protocol, WatchdogState } from '@tm/shared';
import type { Db } from '../db/database';

export interface TunnelRow {
  id: string; metricsPort: number; keepAlive: boolean; toleranceMinutes: number; logLevel: LogLevel; protocol: Protocol;
  watchdogState: WatchdogState; degradedSince: number | null; restartAttempts: number; nextRestartAt: number | null;
}
interface Raw { id: string; metrics_port: number; keep_alive: number; tolerance_minutes: number; log_level: string; protocol: string;
  watchdog_state: string; degraded_since: number | null; restart_attempts: number; next_restart_at: number | null }
const toRow = (r: Raw): TunnelRow => ({
  id: r.id, metricsPort: r.metrics_port, keepAlive: !!r.keep_alive, toleranceMinutes: r.tolerance_minutes,
  logLevel: r.log_level as LogLevel, protocol: r.protocol as Protocol, watchdogState: r.watchdog_state as WatchdogState,
  degradedSince: r.degraded_since, restartAttempts: r.restart_attempts, nextRestartAt: r.next_restart_at,
});
const COLS: Record<keyof Omit<TunnelRow, 'id'>, string> = {
  metricsPort: 'metrics_port', keepAlive: 'keep_alive', toleranceMinutes: 'tolerance_minutes', logLevel: 'log_level', protocol: 'protocol',
  watchdogState: 'watchdog_state', degradedSince: 'degraded_since', restartAttempts: 'restart_attempts', nextRestartAt: 'next_restart_at',
};

export class TunnelRepo {
  constructor(private db: Db) {}
  list() { return (this.db.prepare('select * from tunnels order by id').all() as unknown as Raw[]).map(toRow); }
  get(id: string) { const r = this.db.prepare('select * from tunnels where id = ?').get(id) as unknown as Raw | undefined; return r ? toRow(r) : null; }
  nextMetricsPort() { const r = this.db.prepare('select max(metrics_port) m from tunnels').get() as { m: number | null }; return Math.max(20241, (r.m ?? 20240) + 1); }
  insert(id: string, metricsPort: number) { this.db.prepare('insert into tunnels (id, metrics_port) values (?, ?)').run(id, metricsPort); return this.get(id)!; }
  update(id: string, patch: Partial<Omit<TunnelRow, 'id'>>) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof typeof COLS, unknown][];
    if (!entries.length) return;
    const sql = `update tunnels set ${entries.map(([k]) => `${COLS[k]} = ?`).join(', ')} where id = ?`;
    this.db.prepare(sql).run(...entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v) as string | number | null), id);
  }
  delete(id: string) { this.db.prepare('delete from tunnels where id = ?').run(id); }
}
```

`apps/server/src/tunnels/dns-repo.ts`:
```ts
import type { Db } from '../db/database';
export interface ManagedDns { recordId: string; zoneId: string; hostname: string; tunnelId: string }
interface Raw { record_id: string; zone_id: string; hostname: string; tunnel_id: string }
const toRow = (r: Raw): ManagedDns => ({ recordId: r.record_id, zoneId: r.zone_id, hostname: r.hostname, tunnelId: r.tunnel_id });

export class DnsRepo {
  constructor(private db: Db) {}
  all() { return (this.db.prepare('select * from managed_dns').all() as unknown as Raw[]).map(toRow); }
  byHostname(h: string) { const r = this.db.prepare('select * from managed_dns where hostname = ?').get(h) as unknown as Raw | undefined; return r ? toRow(r) : null; }
  byTunnel(id: string) { return (this.db.prepare('select * from managed_dns where tunnel_id = ?').all(id) as unknown as Raw[]).map(toRow); }
  upsert(m: ManagedDns) {
    this.db.prepare('delete from managed_dns where hostname = ? or record_id = ?').run(m.hostname, m.recordId);
    this.db.prepare('insert into managed_dns (record_id, zone_id, hostname, tunnel_id) values (?, ?, ?, ?)').run(m.recordId, m.zoneId, m.hostname, m.tunnelId);
  }
  delete(recordId: string) { this.db.prepare('delete from managed_dns where record_id = ?').run(recordId); }
}
```

`apps/server/src/events/event-repo.ts`:
```ts
import type { EventType, TunnelEvent } from '@tm/shared';
import type { Db } from '../db/database';

export class EventRepo {
  constructor(private db: Db, private now: () => number = Date.now) {}
  add(tunnelId: string | null, type: EventType, message: string) {
    this.db.prepare('insert into events (tunnel_id, type, message, created_at) values (?, ?, ?, ?)').run(tunnelId, type, message, this.now());
  }
  list({ tunnelId, limit = 100 }: { tunnelId?: string; limit?: number } = {}): TunnelEvent[] {
    const rows = (tunnelId
      ? this.db.prepare('select * from events where tunnel_id = ? order by id desc limit ?').all(tunnelId, limit)
      : this.db.prepare('select * from events order by id desc limit ?').all(limit)) as { id: number; tunnel_id: string | null; type: EventType; message: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, tunnelId: r.tunnel_id, type: r.type, message: r.message, createdAt: new Date(r.created_at).toISOString() }));
  }
  prune(maxAgeMs = 30 * 24 * 3600e3) { this.db.prepare('delete from events where created_at < ?').run(this.now() - maxAgeMs); }
}
```
An additional test in the same service test file is not necessary; `prune` is covered in Task 8.

- [ ] **Step 5: Implement `tunnel-service.ts`**
```ts
import type { RoutesUpdate, TunnelDetail, TunnelSummary, UpdateTunnel, Route } from '@tm/shared';
import type { CfApi } from '../cloudflare/api';
import type { CfTunnel, CfZone } from '../cloudflare/types';
import { AppError } from '../errors';
import type { EventRepo } from '../events/event-repo';
import type { ServiceBackend, TunnelEnv } from '../services/backend';
import type { DnsRepo } from './dns-repo';
import { configToRoutes, diffHostnames, routesToConfig, tunnelTarget } from './ingress';
import type { TunnelRepo, TunnelRow } from './tunnel-repo';
import { findZoneForHostname } from './zones';

interface Deps { api: () => CfApi; backend: ServiceBackend; tunnels: TunnelRepo; dns: DnsRepo; events: EventRepo }
const ignore = (...codes: string[]) => (e: unknown) => { if (e instanceof AppError && codes.includes(e.code)) return; throw e; };

export class TunnelService {
  constructor(private d: Deps) {}

  private async summarize(t: CfTunnel, row: TunnelRow | null, routeCount: number): Promise<TunnelSummary> {
    const local = await this.d.backend.status(t.id);
    return {
      id: t.id, name: t.name, createdAt: t.created_at, remote: t.config_src === 'cloudflare',
      managedHere: !!row && this.d.backend.isInstalled(t.id),
      edgeStatus: t.status,
      connections: (t.connections ?? []).map((c) => ({ coloName: c.colo_name, openedAt: c.opened_at, originIp: c.origin_ip, clientVersion: c.client_version })),
      local: local.state, activeSince: local.activeSince,
      watchdog: !row || !row.keepAlive ? 'disabled' : row.watchdogState,
      routeCount,
      settings: row ? { keepAlive: row.keepAlive, toleranceMinutes: row.toleranceMinutes, logLevel: row.logLevel, protocol: row.protocol, metricsPort: row.metricsPort } : null,
    };
  }

  private ghost(row: TunnelRow): CfTunnel {
    return { id: row.id, name: '(deleted in Cloudflare)', created_at: '', deleted_at: null, status: 'down', config_src: 'cloudflare', connections: [] };
  }

  async list(): Promise<TunnelSummary[]> {
    const api = this.d.api();
    const remote = await api.listTunnels();
    const rows = new Map(this.d.tunnels.list().map((r) => [r.id, r]));
    const out = await Promise.all(remote.map(async (t) => {
      const row = rows.get(t.id) ?? null; rows.delete(t.id);
      const count = row ? configToRoutes((await api.getConfig(t.id)).config).length : 0;
      return this.summarize(t, row, count);
    }));
    for (const row of rows.values()) out.push(await this.summarize(this.ghost(row), row, 0));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<TunnelDetail> {
    const api = this.d.api();
    const row = this.d.tunnels.get(id);
    let t: CfTunnel;
    try { t = await api.getTunnel(id); } catch (e) {
      if (row && e instanceof AppError && e.code === 'TUNNEL_NOT_FOUND') return { ...(await this.summarize(this.ghost(row), row, 0)), routes: [], configVersion: 0 };
      throw e;
    }
    const { version, config } = t.config_src === 'cloudflare' ? await api.getConfig(id) : { version: 0, config: { ingress: [] } };
    const routes = configToRoutes(config);
    return { ...(await this.summarize(t, row, routes.length)), routes, configVersion: version };
  }

  private envFor(row: TunnelRow, token: string): TunnelEnv {
    return { token, metricsPort: row.metricsPort, logLevel: row.logLevel, protocol: row.protocol };
  }

  private async installAndStart(id: string) {
    const token = await this.d.api().getTunnelToken(id);
    const row = this.d.tunnels.get(id) ?? this.d.tunnels.insert(id, this.d.tunnels.nextMetricsPort());
    await this.d.backend.install(id, this.envFor(row, token));
    await this.d.backend.start(id);
  }

  async create(name: string) {
    const t = await this.d.api().createTunnel(name);
    await this.installAndStart(t.id);
    this.d.events.add(t.id, 'created', `Tunnel "${name}" created`);
    return this.summarize(await this.d.api().getTunnel(t.id), this.d.tunnels.get(t.id), 0);
  }

  async adopt(id: string) {
    const t = await this.d.api().getTunnel(id);
    if (t.config_src !== 'cloudflare') throw new AppError('TUNNEL_NOT_REMOTE', 'Only remotely-managed tunnels can be adopted', 400);
    await this.installAndStart(id);
    this.d.events.add(id, 'adopted', `Tunnel "${t.name}" adopted`);
    return (await this.get(id)) as TunnelSummary;
  }

  private requireRow(id: string) {
    const row = this.d.tunnels.get(id);
    if (!row) throw new AppError('TUNNEL_NOT_MANAGED', 'Tunnel is not managed by this host', 400);
    return row;
  }

  async update(id: string, patch: UpdateTunnel) {
    const row = this.requireRow(id);
    if (patch.name) await this.d.api().renameTunnel(id, patch.name);
    const envChanged = (patch.logLevel && patch.logLevel !== row.logLevel) || (patch.protocol && patch.protocol !== row.protocol);
    this.d.tunnels.update(id, {
      keepAlive: patch.keepAlive, toleranceMinutes: patch.toleranceMinutes, logLevel: patch.logLevel, protocol: patch.protocol,
      ...(patch.keepAlive === true && !row.keepAlive ? { watchdogState: 'healthy', restartAttempts: 0, degradedSince: null, nextRestartAt: null } : {}),
    });
    if (envChanged) {
      const token = await this.d.api().getTunnelToken(id);
      await this.d.backend.updateEnv(id, this.envFor(this.d.tunnels.get(id)!, token));
      if ((await this.d.backend.status(id)).state === 'active') await this.d.backend.restart(id);
    }
    this.d.events.add(id, 'config-changed', 'Tunnel settings updated');
    return (await this.get(id)) as TunnelSummary;
  }

  async start(id: string) { this.requireRow(id); await this.d.backend.start(id); this.d.tunnels.update(id, { watchdogState: 'healthy', restartAttempts: 0, degradedSince: null, nextRestartAt: null }); this.d.events.add(id, 'started', 'Tunnel started'); }
  async stop(id: string) { this.requireRow(id); await this.d.backend.stop(id); this.d.events.add(id, 'stopped', 'Tunnel stopped'); }
  async restart(id: string) { this.requireRow(id); await this.d.backend.restart(id); this.d.events.add(id, 'restarted', 'Tunnel restarted manually'); }

  async delete(id: string) {
    const api = this.d.api();
    if (this.d.backend.isInstalled(id)) await this.d.backend.uninstall(id);
    await api.cleanupConnections(id).catch(ignore('TUNNEL_NOT_FOUND', 'CF_API_ERROR'));
    const zones = await api.listZones();
    for (const m of this.d.dns.byTunnel(id)) {
      if (zones.some((z) => z.id === m.zoneId)) await api.deleteDnsRecord(m.zoneId, m.recordId).catch(ignore('CF_API_ERROR'));
      this.d.dns.delete(m.recordId);
    }
    await api.deleteTunnel(id).catch(ignore('TUNNEL_NOT_FOUND'));
    this.d.tunnels.delete(id);
    this.d.events.add(id, 'deleted', 'Tunnel deleted');
  }

  async updateRoutes(id: string, input: RoutesUpdate): Promise<TunnelDetail> {
    const api = this.d.api();
    const t = await api.getTunnel(id);
    if (t.config_src !== 'cloudflare') throw new AppError('TUNNEL_NOT_REMOTE', 'Tunnel uses local configuration', 400);
    const before = await api.getConfig(id);
    if (before.version !== input.version) throw new AppError('CONFIG_VERSION_CONFLICT', 'Configuration changed elsewhere', 409, { currentVersion: before.version });

    const zones = await api.listZones();
    const zoneOf = new Map<string, CfZone>();
    const missing: string[] = [];
    for (const r of input.routes) {
      const z = findZoneForHostname(r.hostname, zones);
      if (z) zoneOf.set(r.hostname, z); else if (!missing.includes(r.hostname)) missing.push(r.hostname);
    }
    if (missing.length) throw new AppError('ZONE_NOT_FOUND', 'Hostname does not belong to any zone in this account', 400, { hostnames: missing });

    const beforeRoutes = configToRoutes(before.config);
    const { added, removed } = diffHostnames(beforeRoutes, input.routes);
    const target = tunnelTarget(id);

    type Plan = { hostname: string; zoneId: string; action: 'create' | 'reuse' | 'overwrite'; recordId?: string };
    const plans: Plan[] = []; const conflicts: string[] = [];
    for (const hostname of added) {
      const zoneId = zoneOf.get(hostname)!.id;
      const existing = await api.findDnsRecords(zoneId, hostname);
      const rec = existing[0];
      if (!rec) plans.push({ hostname, zoneId, action: 'create' });
      else if (rec.type === 'CNAME' && rec.content === target) plans.push({ hostname, zoneId, action: 'reuse', recordId: rec.id });
      else if (input.overwriteDns.includes(hostname) && existing.length === 1) plans.push({ hostname, zoneId, action: 'overwrite', recordId: rec.id });
      else conflicts.push(hostname);
    }
    if (conflicts.length) throw new AppError('DNS_CONFLICT', 'DNS record already exists for hostname', 409, { hostnames: conflicts });

    await api.putConfig(id, routesToConfig(input.routes, before.config));

    const created: { zoneId: string; recordId: string }[] = [];
    try {
      for (const p of plans) {
        let recordId = p.recordId!;
        if (p.action === 'create') { recordId = (await api.createCname(p.zoneId, p.hostname, target)).id; created.push({ zoneId: p.zoneId, recordId }); }
        if (p.action === 'overwrite') await api.updateCname(p.zoneId, recordId, p.hostname, target);
        this.d.dns.upsert({ recordId, zoneId: p.zoneId, hostname: p.hostname, tunnelId: id });
      }
    } catch (e) {
      await api.putConfig(id, before.config).catch(() => undefined);
      for (const c of created) { await api.deleteDnsRecord(c.zoneId, c.recordId).catch(() => undefined); this.d.dns.delete(c.recordId); }
      throw e;
    }

    const failures: string[] = [];
    for (const hostname of removed) {
      if (input.keepDns.includes(hostname)) continue;
      const m = this.d.dns.byHostname(hostname);
      if (!m || m.tunnelId !== id) continue;
      try { await api.deleteDnsRecord(m.zoneId, m.recordId); } catch (e) {
        if (!(e instanceof AppError && e.code === 'CF_API_ERROR')) { failures.push(hostname); continue; }
      }
      this.d.dns.delete(m.recordId);
    }
    this.d.events.add(id, 'config-changed',
      `Routes updated (+${added.length} / -${removed.length})${failures.length ? `; failed to remove DNS for ${failures.join(', ')}` : ''}`);
    return this.get(id);
  }
}

export type { Route };
```

- [ ] **Step 6: Run** — `pnpm --filter @tm/server test` → PASS. If a test fails due to a fake detail (e.g. `failNext` with regex `dns_records$` needs to match the URL without the query string), adjust the test/fake, not the business rule.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(server): add tunnel orchestration with DNS rollback"`

---

### Task 8: Watchdog

**Files:**
- Create: `apps/server/src/watchdog/{state-machine.ts,probes.ts,watchdog.ts}`
- Test: `apps/server/src/watchdog/state-machine.test.ts`, `apps/server/src/watchdog/watchdog.test.ts`

**Interfaces:**
- Produces:
```ts
// state-machine.ts (puro)
export interface WdInput { now: number; healthy: boolean; internet: boolean; toleranceMs: number }
export interface WdState { state: WatchdogState; degradedSince: number | null; restartAttempts: number; nextRestartAt: number | null }
export type WdAction = 'none' | 'restart' | 'event-degraded' | 'event-recovered' | 'event-failing' | 'event-no-connectivity';
export const MAX_RESTARTS = 5; export const BASE_BACKOFF_MS = 30_000; export const MAX_BACKOFF_MS = 600_000;
export function step(s: WdState, i: WdInput): { next: WdState; actions: WdAction[] };
// probes.ts
export function probeReady(port: number, timeoutMs?: number): Promise<boolean>;   // GET http://127.0.0.1:port/ready → 200
export function probeInternet(host?: string, port?: number, timeoutMs?: number): Promise<boolean>; // TCP connect api.cloudflare.com:443
// watchdog.ts
export class Watchdog { constructor(deps: { tunnels: TunnelRepo; backend: ServiceBackend; events: EventRepo; probeReady; probeInternet; now?: () => number });
  tick(): Promise<void>; start(intervalMs = 30_000): void; stop(): void }
```

`step` rules:
- `failing`: does nothing until it leaves `failing` (the exit is via a manual `start`, which resets the state — Task 7).
- `healthy` and healthy → no action.
- unhealthy and `internet === false` → stays/enters `degraded` without counting a restart; `event-no-connectivity` action only on the transition (when `state` was `healthy`).
- unhealthy with internet: if `state === 'healthy'` → `degraded`, `degradedSince = now`, `event-degraded` action.
  - if `degraded` and `now - degradedSince >= toleranceMs` → `restarting`, `restartAttempts = 1`, `nextRestartAt = now + backoff(1)`, `restart` action.
  - if `restarting` and `now >= nextRestartAt`: if `restartAttempts >= MAX_RESTARTS` (5 restarts already done without recovering) → `failing` + `event-failing`; otherwise `restartAttempts++`, `restart` action, `nextRestartAt = now + backoff(attempts)`.
- `backoff(n) = min(BASE * 2^(n-1), MAX)`.
- healthy coming from `degraded`/`restarting` → `healthy`, resets everything, `event-recovered` action.

`tick()`: `events.prune()`; `internet = await probeInternet()` (once per tick); for each `row` with `keepAlive` and `backend.isInstalled`: if `backend.status().state` is `inactive` (stopped by the user) → skip; `healthy = state === 'active' && await probeReady(row.metricsPort)`; applies `step`, persists `next` in `tunnels.update`, runs actions (`restart` → `backend.restart` + `watchdog-restart` event "attempt N/5"; events mapped to `watchdog-degraded`, `watchdog-recovered`, `watchdog-failing`, `no-connectivity`). Errors on one tunnel don't interrupt the others.

Note: a `failed` unit (systemd gave up) counts as unhealthy and is handled by the watchdog; `inactive` means intentionally stopped.

- [ ] **Step 1: Failing tests** — `state-machine.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BASE_BACKOFF_MS, MAX_RESTARTS, step, type WdState } from './state-machine';

const init: WdState = { state: 'healthy', degradedSince: null, restartAttempts: 0, nextRestartAt: null };
const TOL = 120_000;
const run = (s: WdState, now: number, healthy: boolean, internet = true) => step(s, { now, healthy, internet, toleranceMs: TOL });

describe('watchdog state machine', () => {
  it('stays healthy', () => { expect(run(init, 0, true)).toEqual({ next: init, actions: [] }); });
  it('degrades then restarts after tolerance', () => {
    let r = run(init, 0, false);
    expect(r.next.state).toBe('degraded'); expect(r.actions).toEqual(['event-degraded']);
    r = run(r.next, TOL - 1, false); expect(r.actions).toEqual([]);
    r = run(r.next, TOL, false);
    expect(r.next).toMatchObject({ state: 'restarting', restartAttempts: 1, nextRestartAt: TOL + BASE_BACKOFF_MS });
    expect(r.actions).toEqual(['restart']);
  });
  it('backs off exponentially and gives up after MAX_RESTARTS', () => {
    let s: WdState = { state: 'restarting', degradedSince: 0, restartAttempts: 1, nextRestartAt: 30_000 };
    const restarts: number[] = [];
    let now = 30_000;
    for (let i = 0; i < 10 && s.state !== 'failing'; i++) {
      const r = run(s, now, false);
      if (r.actions.includes('restart')) restarts.push(now);
      s = r.next; now = s.nextRestartAt ?? now;
    }
    expect(s.state).toBe('failing');
    expect(restarts.length).toBe(MAX_RESTARTS - 1);
    expect(restarts[1]! - restarts[0]!).toBe(2 * BASE_BACKOFF_MS); // backoff(2)
  });
  it('failing is sticky', () => {
    const s: WdState = { state: 'failing', degradedSince: 0, restartAttempts: 5, nextRestartAt: null };
    expect(run(s, 1e9, false)).toEqual({ next: s, actions: [] });
    expect(run(s, 1e9, true)).toEqual({ next: s, actions: [] });
  });
  it('recovers and resets', () => {
    const s: WdState = { state: 'restarting', degradedSince: 0, restartAttempts: 3, nextRestartAt: 5 };
    expect(run(s, 10, true)).toEqual({ next: init, actions: ['event-recovered'] });
  });
  it('does not restart or count without internet', () => {
    let r = run(init, 0, false, false);
    expect(r.actions).toEqual(['event-no-connectivity']);
    for (let t = 0; t < 10 * TOL; t += 30_000) { r = run(r.next, t, false, false); expect(r.actions).toEqual([]); }
    expect(r.next.restartAttempts).toBe(0);
    expect(r.next.state).toBe('degraded');
  });
  it('tolerance restarts from when internet came back', () => {
    let r = run(init, 0, false, false);
    r = run(r.next, 10 * TOL, false, false);        // last tick still offline
    r = run(r.next, 10 * TOL + 30_000, false, true); // internet is back
    expect(r.actions).toEqual([]);
    r = run(r.next, 11 * TOL, false, true);
    expect(r.actions).toEqual(['restart']);
  });
});
```
For the last test to pass, while `internet === false` the `degradedSince` is **updated to `now`** on every tick (the tolerance counts from when connectivity returns).

`watchdog.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/database';
import { EventRepo } from '../events/event-repo';
import { FakeBackend } from '../services/fake-backend';
import { TunnelRepo } from '../tunnels/tunnel-repo';
import { Watchdog } from './watchdog';

const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';
async function setup() {
  let now = 0;
  const db = openDatabase(':memory:');
  const tunnels = new TunnelRepo(db); const events = new EventRepo(db, () => now);
  const backend = new FakeBackend(mkdtempSync(join(tmpdir(), 'tm-')));
  tunnels.insert(ID, 20241);
  await backend.install(ID, { token: 't', metricsPort: 20241, logLevel: 'info', protocol: 'auto' });
  await backend.start(ID);
  let ready = true; let internet = true;
  const wd = new Watchdog({ tunnels, backend, events, probeReady: async () => ready, probeInternet: async () => internet, now: () => now });
  return { wd, tunnels, backend, events, set: (o: { now?: number; ready?: boolean; internet?: boolean }) => { now = o.now ?? now; ready = o.ready ?? ready; internet = o.internet ?? internet; } };
}

describe('Watchdog.tick', () => {
  it('restarts unhealthy tunnel after tolerance and records events', async () => {
    const e = await setup();
    e.set({ ready: false }); await e.wd.tick();
    e.set({ now: 120_000 }); await e.wd.tick();
    expect(e.backend.calls).toContain(`restart ${ID}`);
    expect(e.tunnels.get(ID)!.watchdogState).toBe('restarting');
    expect(e.events.list({ tunnelId: ID }).map((x) => x.type)).toEqual(['watchdog-restart', 'watchdog-degraded']);
  });
  it('skips tunnels stopped by the user', async () => {
    const e = await setup();
    await e.backend.stop(ID); e.set({ ready: false }); await e.wd.tick();
    expect(e.tunnels.get(ID)!.watchdogState).toBe('healthy');
  });
  it('skips when keepAlive disabled', async () => {
    const e = await setup();
    e.tunnels.update(ID, { keepAlive: false }); e.set({ ready: false });
    await e.wd.tick(); e.set({ now: 1e7 }); await e.wd.tick();
    expect(e.backend.calls).not.toContain(`restart ${ID}`);
  });
  it('prunes events older than 30 days', async () => {
    const e = await setup();
    e.events.add(ID, 'started', 'old');
    e.set({ now: 31 * 24 * 3600e3 }); await e.wd.tick();
    expect(e.events.list({ tunnelId: ID }).find((x) => x.message === 'old')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`apps/server/src/watchdog/state-machine.ts`:
```ts
import type { WatchdogState } from '@tm/shared';
export interface WdInput { now: number; healthy: boolean; internet: boolean; toleranceMs: number }
export interface WdState { state: WatchdogState; degradedSince: number | null; restartAttempts: number; nextRestartAt: number | null }
export type WdAction = 'none' | 'restart' | 'event-degraded' | 'event-recovered' | 'event-failing' | 'event-no-connectivity';
export const MAX_RESTARTS = 5;
export const BASE_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 600_000;
const HEALTHY: WdState = { state: 'healthy', degradedSince: null, restartAttempts: 0, nextRestartAt: null };
export const backoff = (n: number) => Math.min(BASE_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);

export function step(s: WdState, i: WdInput): { next: WdState; actions: WdAction[] } {
  if (s.state === 'failing' || s.state === 'disabled') return { next: s, actions: [] };
  if (i.healthy) return s.state === 'healthy' ? { next: s, actions: [] } : { next: { ...HEALTHY }, actions: ['event-recovered'] };
  if (!i.internet) {
    const actions: WdAction[] = s.state === 'healthy' ? ['event-no-connectivity'] : [];
    return { next: { state: 'degraded', degradedSince: i.now, restartAttempts: 0, nextRestartAt: null }, actions };
  }
  if (s.state === 'healthy') return { next: { ...s, state: 'degraded', degradedSince: i.now }, actions: ['event-degraded'] };
  if (s.state === 'degraded') {
    if (i.now - (s.degradedSince ?? i.now) < i.toleranceMs) return { next: s, actions: [] };
    return { next: { ...s, state: 'restarting', restartAttempts: 1, nextRestartAt: i.now + backoff(1) }, actions: ['restart'] };
  }
  // restarting
  if (i.now < (s.nextRestartAt ?? 0)) return { next: s, actions: [] };
  if (s.restartAttempts >= MAX_RESTARTS) return { next: { ...s, state: 'failing', nextRestartAt: null }, actions: ['event-failing'] };
  const n = s.restartAttempts + 1;
  return { next: { ...s, restartAttempts: n, nextRestartAt: i.now + backoff(n) }, actions: ['restart'] };
}
```
(With `MAX_RESTARTS = 5`: the backoff test starts with 1 attempt already made and expects 4 more restarts before `failing`, for a total of 5. `nextRestartAt` after attempt n is `now + backoff(n)`: 30 s, 1 min, 2 min, 4 min.)

`apps/server/src/watchdog/probes.ts`:
```ts
import { connect } from 'node:net';
export async function probeReady(port: number, timeoutMs = 3000) {
  try { return (await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(timeoutMs) })).status === 200; }
  catch { return false; }
}
export function probeInternet(host = 'api.cloudflare.com', port = 443, timeoutMs = 3000) {
  return new Promise<boolean>((resolve) => {
    const s = connect({ host, port });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}
```

`apps/server/src/watchdog/watchdog.ts`:
```ts
import type { EventType } from '@tm/shared';
import type { EventRepo } from '../events/event-repo';
import type { ServiceBackend } from '../services/backend';
import type { TunnelRepo } from '../tunnels/tunnel-repo';
import { MAX_RESTARTS, step, type WdAction } from './state-machine';

interface Deps {
  tunnels: TunnelRepo; backend: ServiceBackend; events: EventRepo;
  probeReady: (port: number) => Promise<boolean>; probeInternet: () => Promise<boolean>; now?: () => number;
}
const EVENT: Partial<Record<WdAction, [EventType, string]>> = {
  'event-degraded': ['watchdog-degraded', 'Tunnel unhealthy'],
  'event-recovered': ['watchdog-recovered', 'Tunnel recovered'],
  'event-failing': ['watchdog-failing', `Gave up after ${MAX_RESTARTS} restarts`],
  'event-no-connectivity': ['no-connectivity', 'No connectivity to Cloudflare; waiting'],
};

export class Watchdog {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private d: Deps) {}
  private now() { return (this.d.now ?? Date.now)(); }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      this.d.events.prune();
      const internet = await this.d.probeInternet();
      for (const row of this.d.tunnels.list()) {
        if (!row.keepAlive || !this.d.backend.isInstalled(row.id)) continue;
        try {
          const st = await this.d.backend.status(row.id);
          if (st.state === 'inactive') continue;
          const healthy = st.state === 'active' && (await this.d.probeReady(row.metricsPort));
          const { next, actions } = step(
            { state: row.watchdogState, degradedSince: row.degradedSince, restartAttempts: row.restartAttempts, nextRestartAt: row.nextRestartAt },
            { now: this.now(), healthy, internet, toleranceMs: row.toleranceMinutes * 60_000 },
          );
          this.d.tunnels.update(row.id, { watchdogState: next.state, degradedSince: next.degradedSince, restartAttempts: next.restartAttempts, nextRestartAt: next.nextRestartAt });
          for (const a of actions) {
            if (a === 'restart') {
              await this.d.backend.restart(row.id);
              this.d.events.add(row.id, 'watchdog-restart', `Restart attempt ${next.restartAttempts}/${MAX_RESTARTS}`);
            } else if (EVENT[a]) this.d.events.add(row.id, EVENT[a]![0], EVENT[a]![1]);
          }
        } catch (e) {
          this.d.events.add(row.id, 'watchdog-degraded', `Watchdog error: ${(e as Error).message}`);
        }
      }
    } finally { this.running = false; }
  }
  start(intervalMs = 30_000) { this.stop(); this.timer = setInterval(() => void this.tick(), intervalMs); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
```

- [ ] **Step 4: Run** — PASS. (Note: `events.list` orders by `id desc`, so events appear from newest to oldest, as in the test.)
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): add keep-alive watchdog"`

---

### Task 9: Metrics, cloudflared version and origin test

**Files:**
- Create: `apps/server/src/metrics/{prometheus.ts,sampler.ts}`, `apps/server/src/system/{cloudflared-info.ts,origin-test.ts}`
- Test: `apps/server/src/metrics/metrics.test.ts`, `apps/server/src/system/system.test.ts`

**Interfaces:**
- Produces:
  - `parsePrometheus(text: string): Map<string, number>` — sums series with the same name (ignores labels); keys used: `cloudflared_tunnel_total_requests`, `cloudflared_tunnel_request_errors`, `cloudflared_tunnel_ha_connections`.
  - `class MetricsSampler { constructor(fetchText: (port: number) => Promise<string | null>, now?: () => number); sample(tunnelId: string, port: number): Promise<void>; snapshot(tunnelId: string): MetricsSnapshot; forget(id): void }` — stores per-minute deltas (60-point window); counters that decrease (restart) count as a reset (delta = current value).
  - `latestCloudflaredVersion(fetchImpl?): Promise<string | null>` — `GET https://api.github.com/repos/cloudflare/cloudflared/releases/latest` → `tag_name`; 6 h in-memory cache.
  - `compareVersions(a, b): number` (format `YYYY.M.P`).
  - `testOrigin(service: string, timeoutMs = 3000): Promise<OriginTestResult>` — `http(s)://` does a `fetch` with `redirect: 'manual'` (any HTTP response = reachable; invalid TLS is accepted — for HTTPS it uses a TCP connection + handshake via `node:tls` with `rejectUnauthorized: false`); `tcp|ssh|rdp|smb://host:port` makes a TCP connection; `unix:`/`http_status:`/`hello_world` → `{ reachable: true, latencyMs: 0, error: null }`.

- [ ] **Step 1: Failing tests** — `metrics.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parsePrometheus } from './prometheus';
import { MetricsSampler } from './sampler';

const text = (req: number, err: number) => `# HELP x
cloudflared_tunnel_total_requests ${req}
cloudflared_tunnel_request_errors{a="1"} ${err}
cloudflared_tunnel_ha_connections 4
`;

describe('parsePrometheus', () => {
  it('parses and sums series', () => {
    const m = parsePrometheus('a{x="1"} 1\na{x="2"} 2\nb 3.5\n# c 9');
    expect(m.get('a')).toBe(3); expect(m.get('b')).toBe(3.5); expect(m.has('#')).toBe(false);
  });
});

describe('MetricsSampler', () => {
  it('computes deltas and handles counter resets', async () => {
    let now = 0; let body = text(100, 1);
    const s = new MetricsSampler(async () => body, () => now);
    await s.sample('t', 1);
    now = 60_000; body = text(160, 3); await s.sample('t', 1);
    now = 120_000; body = text(10, 0); await s.sample('t', 1);
    const snap = s.snapshot('t');
    expect(snap.points.map((p) => [p.requests, p.errors])).toEqual([[60, 2], [10, 0]]);
    expect(snap.haConnections).toBe(4);
  });
  it('keeps at most 60 points and survives fetch failure', async () => {
    let now = 0;
    const s = new MetricsSampler(async () => (now === 5 * 60_000 ? null : text(now / 1000, 0)), () => now);
    for (let i = 0; i < 70; i++) { await s.sample('t', 1); now += 60_000; }
    expect(s.snapshot('t').points.length).toBe(60);
  });
});
```

`system.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { compareVersions, latestCloudflaredVersion } from './cloudflared-info';
import { testOrigin } from './origin-test';

describe('compareVersions', () => {
  it('orders calendar versions', () => {
    expect(compareVersions('2026.9.1', '2026.10.0')).toBeLessThan(0);
    expect(compareVersions('2026.9.1', '2026.9.1')).toBe(0);
  });
});
describe('latestCloudflaredVersion', () => {
  it('reads tag_name', async () => {
    const f = (async () => new Response(JSON.stringify({ tag_name: '2026.9.1' }))) as typeof fetch;
    expect(await latestCloudflaredVersion(f)).toBe('2026.9.1');
  });
});
describe('testOrigin', () => {
  it('reaches a TCP listener and reports closed port', async () => {
    const srv = createServer(() => undefined).listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as { port: number }).port;
    expect((await testOrigin(`tcp://127.0.0.1:${port}`)).reachable).toBe(true);
    srv.close();
    expect((await testOrigin('tcp://127.0.0.1:1', 500)).reachable).toBe(false);
  });
  it('short-circuits non-network services', async () => {
    expect(await testOrigin('http_status:404')).toEqual({ reachable: true, latencyMs: 0, error: null });
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`apps/server/src/metrics/prometheus.ts`:
```ts
export function parsePrometheus(text: string) {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const v = Number(m[3]); if (Number.isNaN(v)) continue;
    out.set(m[1]!, (out.get(m[1]!) ?? 0) + v);
  }
  return out;
}
```

`apps/server/src/metrics/sampler.ts`:
```ts
import type { MetricsPoint, MetricsSnapshot } from '@tm/shared';
import { parsePrometheus } from './prometheus';

interface Series { last: { req: number; err: number } | null; points: MetricsPoint[]; ha: number | null }
export const fetchMetricsText = async (port: number) => {
  try { const r = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(3000) }); return r.ok ? r.text() : null; }
  catch { return null; }
};

export class MetricsSampler {
  private series = new Map<string, Series>();
  constructor(private fetchText: (port: number) => Promise<string | null> = fetchMetricsText, private now: () => number = Date.now) {}
  async sample(id: string, port: number) {
    const s = this.series.get(id) ?? { last: null, points: [], ha: null };
    this.series.set(id, s);
    const text = await this.fetchText(port);
    if (!text) { s.ha = null; return; }
    const m = parsePrometheus(text);
    const req = m.get('cloudflared_tunnel_total_requests') ?? 0;
    const err = m.get('cloudflared_tunnel_request_errors') ?? 0;
    s.ha = m.get('cloudflared_tunnel_ha_connections') ?? null;
    if (s.last) {
      s.points.push({ t: this.now(), requests: req >= s.last.req ? req - s.last.req : req, errors: err >= s.last.err ? err - s.last.err : err });
      if (s.points.length > 60) s.points.splice(0, s.points.length - 60);
    }
    s.last = { req, err };
  }
  snapshot(id: string): MetricsSnapshot { const s = this.series.get(id); return { points: s?.points ?? [], haConnections: s?.ha ?? null }; }
  forget(id: string) { this.series.delete(id); }
}
```

`apps/server/src/system/cloudflared-info.ts`:
```ts
let cache: { at: number; value: string | null } | null = null;
export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}
export async function latestCloudflaredVersion(fetchImpl: typeof fetch = fetch) {
  if (cache && Date.now() - cache.at < 6 * 3600e3 && fetchImpl === fetch) return cache.value;
  try {
    const r = await fetchImpl('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',
      { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000) });
    const value = r.ok ? ((await r.json()) as { tag_name?: string }).tag_name ?? null : null;
    if (fetchImpl === fetch) cache = { at: Date.now(), value };
    return value;
  } catch { return null; }
}
```

`apps/server/src/system/origin-test.ts`:
```ts
import type { OriginTestResult } from '@tm/shared';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

function tcp(host: string, port: number, timeoutMs: number, tls: boolean): Promise<OriginTestResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const s = tls ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false }) : connect({ host, port });
    const done = (reachable: boolean, error: string | null) => { s.destroy(); resolve({ reachable, latencyMs: reachable ? Date.now() - started : null, error }); };
    s.setTimeout(timeoutMs, () => done(false, 'timeout'));
    s.once(tls ? 'secureConnect' : 'connect', () => done(true, null));
    s.once('error', (e) => done(false, e.message));
  });
}

export async function testOrigin(service: string, timeoutMs = 3000): Promise<OriginTestResult> {
  if (/^(unix|unix\+tls):|^http_status:|^hello_world$/.test(service)) return { reachable: true, latencyMs: 0, error: null };
  let url: URL;
  try { url = new URL(service); } catch { return { reachable: false, latencyMs: null, error: 'invalid service URL' }; }
  const defaults: Record<string, number> = { 'http:': 80, 'https:': 443, 'ssh:': 22, 'rdp:': 3389, 'smb:': 445 };
  const port = Number(url.port) || defaults[url.protocol];
  if (!port) return { reachable: false, latencyMs: null, error: 'missing port' };
  return tcp(url.hostname, port, timeoutMs, url.protocol === 'https:');
}
```
(Deliberate simplification: HTTP is tested via TCP (and HTTPS via a TLS handshake), which is enough to confirm "the origin is listening".)

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): add metrics sampler, version check and origin test"`

---

### Task 10: HTTP layer (Fastify)

**Files:**
- Create: `apps/server/src/http/{context.ts,app.ts}`, `apps/server/src/http/routes/{setup.ts,auth.ts,cloudflare.ts,tunnels.ts,system.ts,backup.ts}`
- Test: `apps/server/src/http/http.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces:
```ts
export interface AppContext {
  config: AppConfig; db: Db; admin: AdminRepo; sessions: SessionStore; settings: SettingsRepo;
  tunnels: TunnelRepo; dns: DnsRepo; events: EventRepo; backend: ServiceBackend; sampler: MetricsSampler;
  cfClient(token: string): CfClient;       // factory (baseUrl = config.cfApiBase)
  api(): CfApi;                             // throws CF_NOT_CONNECTED when no credentials are stored
  service: TunnelService;
  latestVersion: () => Promise<string | null>;
}
export function createContext(config: AppConfig, overrides?: Partial<Pick<AppContext, 'backend' | 'latestVersion'>>): AppContext;
export async function buildApp(ctx: AppContext): Promise<FastifyInstance>;
```

Endpoints (all under `/api`, JSON; except where marked, all require a session):

| Method | Route | Public | Body / Query | Response |
|---|---|---|---|---|
| GET | `/health` | ✓ | — | `{ ok: true }` |
| GET | `/setup/status` | ✓ | — | `SetupStatus` |
| POST | `/setup/admin` | ✓ | `adminSetupSchema` | 201 + cookie; `SETUP_ALREADY_DONE` (409) if an admin already exists |
| POST | `/auth/login` | ✓ (rate limit 5/min) | `loginSchema` | 204 + cookie; `INVALID_CREDENTIALS` (401) |
| POST | `/auth/logout` | | — | 204, clears cookie |
| GET | `/auth/me` | | — | `{ username }` |
| POST | `/auth/password` | | `changePasswordSchema` | 204; revokes other sessions and creates a new one |
| GET | `/cloudflare/status` | | — | `CloudflareStatus` (zones only if connected; API error → `zones: []`) |
| POST | `/cloudflare/token` | | `cloudflareTokenSchema` | `CloudflareStatus`; 409 `ACCOUNT_SELECTION_REQUIRED` with `details.accounts` |
| GET | `/zones` | | — | `Zone[]` |
| GET | `/tunnels` | | — | `TunnelSummary[]` |
| POST | `/tunnels` | | `createTunnelSchema` | 201 `TunnelSummary` |
| GET | `/tunnels/:id` | | — | `TunnelDetail` |
| PATCH | `/tunnels/:id` | | `updateTunnelSchema` | `TunnelSummary` |
| DELETE | `/tunnels/:id` | | — | 204 |
| POST | `/tunnels/:id/{adopt,start,stop,restart}` | | — | 204 (adopt: `TunnelSummary`) |
| PUT | `/tunnels/:id/routes` | | `routesUpdateSchema` | `TunnelDetail` |
| GET | `/tunnels/:id/events` | | `?limit=` | `TunnelEvent[]` |
| GET | `/tunnels/:id/metrics` | | — | `MetricsSnapshot` |
| GET | `/tunnels/:id/logs` | | `?lines=200` | `LogLine[]` |
| GET | `/tunnels/:id/logs/stream` | | — | SSE `data: LogLine` |
| GET | `/events` | | `?limit=50` | `TunnelEvent[]` |
| POST | `/tools/test-origin` | | `testOriginSchema` | `OriginTestResult` |
| GET | `/system/cloudflared` | | — | `CloudflaredVersionInfo` |
| POST | `/system/cloudflared/update` | | — | `CloudflaredVersionInfo`; restarts active managed tunnels; `cloudflared-updated` event |
| GET | `/backup` | | — | `Backup` (JSON, `content-disposition: attachment`) |
| POST | `/backup` | | `backupSchema` | 204; applies settings to tunnels that already exist in the repo (ignores unknown ids) and upserts `managed_dns` |

`:id` is validated with `uuidSchema` (400 `VALIDATION_ERROR`). Errors: `setErrorHandler` converts `AppError` → `{code,message,details}` with its status; `ZodError` → 400 `VALIDATION_ERROR` with `details: issues`; rate-limit error → 429 `RATE_LIMITED`; everything else → 500 `INTERNAL` (logs the error). Non-`/api` routes serve `webDist` with an SPA fallback to `index.html` when `webDist` is set.

`tm_session` cookie: `httpOnly`, `sameSite: 'strict'`, `path: '/'`, `secure: config.cookieSecure`, `maxAge: 7 days`.

`/cloudflare/token`: `client = cfClient(token)`; `CfApi.verifyToken(client)` (status ≠ `active` → `CF_TOKEN_INVALID`); `accounts = CfApi.listAccounts(client)`; none → `CF_PERMISSION_MISSING` with `details: { permission: 'Account: Cloudflare Tunnel: Edit' }`; several and no `accountId` → 409 `ACCOUNT_SELECTION_REQUIRED` `details: { accounts }`; validates access by calling `listTunnels()` (403 → `CF_PERMISSION_MISSING` `details.permission = 'Account: Cloudflare Tunnel: Edit'`) and `listZones()` (empty list or 403 → `CF_PERMISSION_MISSING` `details.permission = 'Zone: Zone: Read'`); saves with `settings.setCloudflare`.

Log SSE: `reply.hijack()`, headers `content-type: text/event-stream`, `cache-control: no-cache`, sends `: ping` every 15 s, `unsubscribe` on request `close`.

Metrics loop: in `main.ts` (Task 11), not here.

- [ ] **Step 1: Failing tests** — `apps/server/src/http/http.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config';
import { startFakeCloudflare, type FakeCf } from '../../test/fake-cloudflare';
import { buildApp } from './app';
import { createContext } from './context';

let cf: FakeCf; let app: FastifyInstance;
beforeEach(async () => {
  cf = await startFakeCloudflare();
  const dir = mkdtempSync(join(tmpdir(), 'tm-'));
  const config = loadConfig({ DATA_DIR: dir, ETC_DIR: join(dir, 'etc'), SERVICE_BACKEND: 'fake', CF_API_BASE: cf.baseUrl });
  app = await buildApp(createContext(config, { latestVersion: async () => '2026.10.0' }));
});
afterEach(async () => { await app.close(); await cf.close(); });

const PW = 'a-very-long-password';
async function setupAdmin() {
  const r = await app.inject({ method: 'POST', url: '/api/setup/admin', payload: { username: 'admin', password: PW } });
  expect(r.statusCode).toBe(201);
  return { cookie: `tm_session=${r.cookies.find((c) => c.name === 'tm_session')!.value}` };
}
async function connect(headers: { cookie: string }) {
  const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers, payload: { token: cf.token } });
  expect(r.statusCode).toBe(200);
}

describe('setup and auth', () => {
  it('reports setup status and blocks second admin', async () => {
    expect((await app.inject('/api/setup/status')).json()).toEqual({ adminCreated: false, cloudflareConnected: false });
    await setupAdmin();
    const again = await app.inject({ method: 'POST', url: '/api/setup/admin', payload: { username: 'x', password: PW } });
    expect(again.statusCode).toBe(409); expect(again.json().code).toBe('SETUP_ALREADY_DONE');
  });
  it('requires session for protected routes', async () => {
    const r = await app.inject('/api/tunnels');
    expect(r.statusCode).toBe(401); expect(r.json().code).toBe('UNAUTHORIZED');
  });
  it('logs in with correct password only and rate-limits', async () => {
    await setupAdmin();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } });
    expect(bad.json().code).toBe('INVALID_CREDENTIALS');
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: PW } });
    expect(ok.statusCode).toBe(204);
    const c = ok.cookies.find((x) => x.name === 'tm_session')!;
    expect(c.httpOnly).toBe(true); expect(c.sameSite).toBe('Strict');
    for (let i = 0; i < 4; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } });
    const limited = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: PW } });
    expect(limited.statusCode).toBe(429); expect(limited.json().code).toBe('RATE_LIMITED');
  });
});

describe('cloudflare connection', () => {
  it('connects, never returns the token, exposes suffix and zones', async () => {
    const h = await setupAdmin(); await connect(h);
    const s = (await app.inject({ url: '/api/cloudflare/status', headers: h })).json();
    expect(s).toMatchObject({ connected: true, accountName: 'Home Lab', tokenSuffix: cf.token.slice(-4) });
    expect(JSON.stringify(s)).not.toContain(cf.token);
    expect(s.zones.map((z: { name: string }) => z.name)).toEqual(['example.com', 'other.dev']);
  });
  it('asks for account selection when token has several accounts', async () => {
    const h = await setupAdmin();
    cf.state.accounts.push({ id: 'b'.repeat(32), name: 'Work' });
    const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers: h, payload: { token: cf.token } });
    expect(r.statusCode).toBe(409); expect(r.json().details.accounts).toHaveLength(2);
  });
  it('rejects invalid token', async () => {
    const h = await setupAdmin();
    const r = await app.inject({ method: 'POST', url: '/api/cloudflare/token', headers: h, payload: { token: 'x'.repeat(40) } });
    expect(r.json().code).toBe('CF_TOKEN_INVALID');
  });
  it('returns CF_NOT_CONNECTED before token is set', async () => {
    const h = await setupAdmin();
    expect((await app.inject({ url: '/api/tunnels', headers: h })).json().code).toBe('CF_NOT_CONNECTED');
  });
});

describe('tunnels API', () => {
  it('full lifecycle', async () => {
    const h = await setupAdmin(); await connect(h);
    const created = await app.inject({ method: 'POST', url: '/api/tunnels', headers: h, payload: { name: 'home' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const detail = (await app.inject({ url: `/api/tunnels/${id}`, headers: h })).json();
    const put = await app.inject({ method: 'PUT', url: `/api/tunnels/${id}/routes`, headers: h,
      payload: { version: detail.configVersion, routes: [{ hostname: 'ha.example.com', service: 'http://10.0.0.5:8123' }] } });
    expect(put.statusCode).toBe(200); expect(put.json().routes).toHaveLength(1);
    const stale = await app.inject({ method: 'PUT', url: `/api/tunnels/${id}/routes`, headers: h, payload: { version: 0, routes: [] } });
    expect(stale.statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/tunnels/${id}/stop`, headers: h })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/tunnels/${id}/events`, headers: h })).json()[0].type).toBe('stopped');
    expect((await app.inject({ method: 'DELETE', url: `/api/tunnels/${id}`, headers: h })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/tunnels', headers: h })).json()).toEqual([]);
  });
  it('validates ids and bodies', async () => {
    const h = await setupAdmin(); await connect(h);
    expect((await app.inject({ url: '/api/tunnels/..%2Fetc', headers: h })).json().code).toBe('VALIDATION_ERROR');
    expect((await app.inject({ method: 'POST', url: '/api/tunnels', headers: h, payload: { name: '' } })).json().code).toBe('VALIDATION_ERROR');
  });
  it('reports cloudflared version info', async () => {
    const h = await setupAdmin();
    expect((await app.inject({ url: '/api/system/cloudflared', headers: h })).json())
      .toEqual({ installed: '2026.9.1', latest: '2026.10.0', updateAvailable: true });
  });
  it('exports backup without token', async () => {
    const h = await setupAdmin(); await connect(h);
    await app.inject({ method: 'POST', url: '/api/tunnels', headers: h, payload: { name: 'home' } });
    const b = await app.inject({ url: '/api/backup', headers: h });
    expect(b.json().tunnels).toHaveLength(1);
    expect(b.body).not.toContain(cf.token);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `context.ts`**
```ts
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { AppConfig } from '../config';
import { AdminRepo, SessionStore } from '../auth/sessions';
import { CfApi } from '../cloudflare/api';
import { CfClient } from '../cloudflare/client';
import { loadOrCreateKey } from '../crypto/secret-box';
import { openDatabase, type Db } from '../db/database';
import { AppError } from '../errors';
import { EventRepo } from '../events/event-repo';
import { MetricsSampler } from '../metrics/sampler';
import type { ServiceBackend } from '../services/backend';
import { FakeBackend } from '../services/fake-backend';
import { SystemdBackend } from '../services/systemd-backend';
import { SettingsRepo } from '../settings/settings-repo';
import { latestCloudflaredVersion } from '../system/cloudflared-info';
import { DnsRepo } from '../tunnels/dns-repo';
import { TunnelRepo } from '../tunnels/tunnel-repo';
import { TunnelService } from '../tunnels/tunnel-service';

export interface AppContext {
  config: AppConfig; db: Db; admin: AdminRepo; sessions: SessionStore; settings: SettingsRepo;
  tunnels: TunnelRepo; dns: DnsRepo; events: EventRepo; backend: ServiceBackend; sampler: MetricsSampler;
  cfClient(token: string): CfClient; api(): CfApi; service: TunnelService; latestVersion: () => Promise<string | null>;
}

export function createContext(config: AppConfig, overrides: Partial<Pick<AppContext, 'backend' | 'latestVersion'>> = {}): AppContext {
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, 'data.db'));
  const settings = new SettingsRepo(db, loadOrCreateKey(join(config.etcDir, 'secret.key')));
  const backend = overrides.backend ?? (config.serviceBackend === 'fake' ? new FakeBackend(config.etcDir) : new SystemdBackend(config.etcDir));
  const cfClient = (token: string) => new CfClient({ token, baseUrl: config.cfApiBase });
  let cached: { token: string; accountId: string; api: CfApi } | null = null;
  const api = () => {
    const c = settings.getCloudflare();
    if (!c) throw new AppError('CF_NOT_CONNECTED', 'Cloudflare account not connected', 409);
    if (!cached || cached.token !== c.token || cached.accountId !== c.accountId) cached = { ...c, api: new CfApi(cfClient(c.token), c.accountId) };
    return cached.api;
  };
  const tunnels = new TunnelRepo(db); const dns = new DnsRepo(db); const events = new EventRepo(db);
  return {
    config, db, settings, backend, tunnels, dns, events, cfClient, api,
    admin: new AdminRepo(db), sessions: new SessionStore(db), sampler: new MetricsSampler(),
    service: new TunnelService({ api, backend, tunnels, dns, events }),
    latestVersion: overrides.latestVersion ?? (() => latestCloudflaredVersion()),
  };
}
```

- [ ] **Step 4: Implement `app.ts`**
```ts
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import type { AppContext } from './context';
import { setupRoutes } from './routes/setup';
import { authRoutes } from './routes/auth';
import { cloudflareRoutes } from './routes/cloudflare';
import { tunnelRoutes } from './routes/tunnels';
import { systemRoutes } from './routes/system';
import { backupRoutes } from './routes/backup';

export const SESSION_COOKIE = 'tm_session';
const PUBLIC = new Set(['/api/health', '/api/setup/status', '/api/setup/admin', '/api/auth/login']);

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/', secure: ctx.config.cookieSecure, maxAge: 7 * 24 * 3600 });
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === 'production' ? { level: 'info' } : false });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 'Too many attempts, try again in a minute', 429),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ code: err.code, message: err.message, details: err.details });
    if (err instanceof ZodError) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.issues });
    if ((err as { statusCode?: number }).statusCode === 429) return reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many attempts' });
    req.log.error(err);
    return reply.code(500).send({ code: 'INTERNAL', message: 'Internal error' });
  });

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || PUBLIC.has(path)) return;
    const token = req.cookies[SESSION_COOKIE];
    if (!token || !ctx.sessions.validate(token)) throw new AppError('UNAUTHORIZED', 'Login required', 401);
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(async (api) => {
    await setupRoutes(api, ctx); await authRoutes(api, ctx); await cloudflareRoutes(api, ctx);
    await tunnelRoutes(api, ctx); await systemRoutes(api, ctx); await backupRoutes(api, ctx);
  }, { prefix: '/api' });

  if (ctx.config.webDist) {
    await app.register(fastifyStatic, { root: ctx.config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ code: 'VALIDATION_ERROR', message: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
```
(The rate-limit `errorResponseBuilder` throws an `AppError` that falls into `setErrorHandler`; if the plugin version requires an object with `statusCode`, return `{ statusCode: 429, code: 'RATE_LIMITED', message: '…' }` and the handler handles it via the `statusCode === 429` branch.)

- [ ] **Step 5: Implement routes**

`routes/setup.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { adminSetupSchema } from '@tm/shared';
import { hashPassword } from '../../auth/password';
import { AppError } from '../../errors';
import { setSessionCookie } from '../app';
import type { AppContext } from '../context';

export async function setupRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/setup/status', async () => ({ adminCreated: ctx.admin.exists(), cloudflareConnected: !!ctx.settings.getCloudflare() }));
  app.post('/setup/admin', async (req, reply) => {
    if (ctx.admin.exists()) throw new AppError('SETUP_ALREADY_DONE', 'Admin already created', 409);
    const body = adminSetupSchema.parse(req.body);
    ctx.admin.create(body.username, await hashPassword(body.password));
    setSessionCookie(ctx, reply, ctx.sessions.create());
    return reply.code(201).send({ username: body.username });
  });
}
```

`routes/auth.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, loginSchema } from '@tm/shared';
import { hashPassword, verifyPassword } from '../../auth/password';
import { AppError } from '../../errors';
import { SESSION_COOKIE, setSessionCookie } from '../app';
import type { AppContext } from '../context';

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const admin = ctx.admin.get();
    if (!admin || admin.username !== username || !(await verifyPassword(password, admin.passwordHash)))
      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
    setSessionCookie(ctx, reply, ctx.sessions.create());
    return reply.code(204).send();
  });
  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE]; if (t) ctx.sessions.revoke(t);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
  app.get('/auth/me', async () => ({ username: ctx.admin.get()!.username }));
  app.post('/auth/password', async (req, reply) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const admin = ctx.admin.get()!;
    if (!(await verifyPassword(currentPassword, admin.passwordHash))) throw new AppError('INVALID_CREDENTIALS', 'Current password is wrong', 401);
    ctx.admin.setPasswordHash(await hashPassword(newPassword));
    ctx.sessions.revokeAll();
    setSessionCookie(ctx, reply, ctx.sessions.create());
    return reply.code(204).send();
  });
}
```

`routes/cloudflare.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { cloudflareTokenSchema, type CloudflareStatus } from '@tm/shared';
import { CfApi } from '../../cloudflare/api';
import { AppError } from '../../errors';
import type { AppContext } from '../context';

export async function cloudflareRoutes(app: FastifyInstance, ctx: AppContext) {
  const status = async (): Promise<CloudflareStatus> => {
    const c = ctx.settings.getCloudflare();
    if (!c) return { connected: false, accountId: null, accountName: null, tokenSuffix: null, zones: [] };
    const zones = await ctx.api().listZones().then((l) => l.map(({ id, name }) => ({ id, name }))).catch(() => []);
    return { connected: true, accountId: c.accountId, accountName: c.accountName, tokenSuffix: ctx.settings.tokenSuffix(), zones };
  };
  app.get('/cloudflare/status', status);
  app.get('/zones', async () => (await ctx.api().listZones()).map(({ id, name }) => ({ id, name })));
  app.post('/cloudflare/token', async (req) => {
    const { token, accountId } = cloudflareTokenSchema.parse(req.body);
    const client = ctx.cfClient(token);
    const v = await CfApi.verifyToken(client);
    if (v.status !== 'active') throw new AppError('CF_TOKEN_INVALID', `Token status is ${v.status}`, 401);
    const accounts = await CfApi.listAccounts(client);
    if (!accounts.length) throw new AppError('CF_PERMISSION_MISSING', 'Token has no account access', 403, { permission: 'Account: Cloudflare Tunnel: Edit' });
    const account = accountId ? accounts.find((a) => a.id === accountId) : accounts.length === 1 ? accounts[0] : undefined;
    if (!account) throw new AppError('ACCOUNT_SELECTION_REQUIRED', 'Choose an account', 409, { accounts });
    const api = new CfApi(client, account.id);
    await api.listTunnels().catch((e) => {
      if (e instanceof AppError && e.code === 'CF_PERMISSION_MISSING') e.details = { permission: 'Account: Cloudflare Tunnel: Edit' };
      throw e;
    });
    const zones = await api.listZones().catch((e) => {
      if (e instanceof AppError && e.code === 'CF_PERMISSION_MISSING') e.details = { permission: 'Zone: Zone: Read' };
      throw e;
    });
    if (!zones.length) throw new AppError('CF_PERMISSION_MISSING', 'Token cannot read any zone', 403, { permission: 'Zone: Zone: Read' });
    ctx.settings.setCloudflare({ token, accountId: account.id, accountName: account.name });
    return status();
  });
}
```

`routes/tunnels.ts`:
```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createTunnelSchema, routesUpdateSchema, testOriginSchema, updateTunnelSchema, uuidSchema } from '@tm/shared';
import { z } from 'zod';
import { AppError } from '../../errors';
import { testOrigin } from '../../system/origin-test';
import type { AppContext } from '../context';

const idOf = (req: FastifyRequest) => {
  const r = uuidSchema.safeParse((req.params as { id: string }).id);
  if (!r.success) throw new AppError('VALIDATION_ERROR', 'invalid tunnel id', 400);
  return r.data.toLowerCase();
};
const limitSchema = z.coerce.number().int().min(1).max(1000);

export async function tunnelRoutes(app: FastifyInstance, ctx: AppContext) {
  const s = ctx.service;
  app.get('/tunnels', () => s.list());
  app.post('/tunnels', async (req, reply) => reply.code(201).send(await s.create(createTunnelSchema.parse(req.body).name)));
  app.get('/tunnels/:id', (req) => s.get(idOf(req)));
  app.patch('/tunnels/:id', (req) => s.update(idOf(req), updateTunnelSchema.parse(req.body)));
  app.delete('/tunnels/:id', async (req, reply) => { const id = idOf(req); await s.delete(id); ctx.sampler.forget(id); return reply.code(204).send(); });
  app.post('/tunnels/:id/adopt', (req) => s.adopt(idOf(req)));
  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post(`/tunnels/:id/${action}`, async (req, reply) => { await s[action](idOf(req)); return reply.code(204).send(); });
  }
  app.put('/tunnels/:id/routes', (req) => s.updateRoutes(idOf(req), routesUpdateSchema.parse(req.body)));
  app.get('/tunnels/:id/events', (req) => ctx.events.list({ tunnelId: idOf(req), limit: limitSchema.parse((req.query as { limit?: string }).limit ?? 100) }));
  app.get('/tunnels/:id/metrics', async (req) => ctx.sampler.snapshot(idOf(req)));
  app.get('/tunnels/:id/logs', (req) => ctx.backend.logs(idOf(req), limitSchema.parse((req.query as { lines?: string }).lines ?? 200)));
  app.get('/tunnels/:id/logs/stream', (req, reply) => {
    const id = idOf(req);
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const unsubscribe = ctx.backend.followLogs(id, (line) => reply.raw.write(`data: ${JSON.stringify(line)}\n\n`));
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => { clearInterval(ping); unsubscribe(); });
  });
  app.get('/events', (req) => ctx.events.list({ limit: limitSchema.parse((req.query as { limit?: string }).limit ?? 50) }));
  app.post('/tools/test-origin', (req) => testOrigin(testOriginSchema.parse(req.body).service));
}
```

`routes/system.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { CloudflaredVersionInfo } from '@tm/shared';
import { compareVersions } from '../../system/cloudflared-info';
import type { AppContext } from '../context';

export async function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  const info = async (): Promise<CloudflaredVersionInfo> => {
    const [installed, latest] = await Promise.all([ctx.backend.cloudflaredVersion(), ctx.latestVersion()]);
    return { installed, latest, updateAvailable: !!installed && !!latest && compareVersions(installed, latest) < 0 };
  };
  app.get('/system/cloudflared', info);
  app.post('/system/cloudflared/update', async () => {
    await ctx.backend.upgradeCloudflared();
    for (const row of ctx.tunnels.list()) {
      if ((await ctx.backend.status(row.id)).state === 'active') await ctx.backend.restart(row.id);
    }
    const result = await info();
    ctx.events.add(null, 'cloudflared-updated', `cloudflared is now ${result.installed}`);
    return result;
  });
}
```

`routes/backup.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { backupSchema, type Backup } from '@tm/shared';
import type { AppContext } from '../context';

export async function backupRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/backup', async (_req, reply) => {
    const body: Backup = {
      version: 1,
      tunnels: ctx.tunnels.list().map((t) => ({ id: t.id, keepAlive: t.keepAlive, toleranceMinutes: t.toleranceMinutes, logLevel: t.logLevel, protocol: t.protocol })),
      managedDns: ctx.dns.all(),
    };
    reply.header('content-disposition', `attachment; filename="cloudflared-manager-backup.json"`);
    return body;
  });
  app.post('/backup', async (req, reply) => {
    const b = backupSchema.parse(req.body);
    for (const t of b.tunnels) if (ctx.tunnels.get(t.id)) ctx.tunnels.update(t.id, { keepAlive: t.keepAlive, toleranceMinutes: t.toleranceMinutes, logLevel: t.logLevel, protocol: t.protocol });
    for (const m of b.managedDns) ctx.dns.upsert(m);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 6: Run** — `pnpm --filter @tm/server test` → PASS; `pnpm --filter @tm/server typecheck` → no errors.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(server): add HTTP API with session auth"`

---

### Task 11: Entry point, build and dev mode

**Files:**
- Create: `apps/server/src/main.ts`, `apps/server/build.mjs`
- Test: manual execution (smoke)

- [ ] **Step 1: `main.ts`**
```ts
import { loadConfig } from './config';
import { buildApp } from './http/app';
import { createContext } from './http/context';
import { Watchdog } from './watchdog/watchdog';
import { probeInternet, probeReady } from './watchdog/probes';

const config = loadConfig();
const ctx = createContext(config);
const app = await buildApp(ctx);
const watchdog = new Watchdog({ tunnels: ctx.tunnels, backend: ctx.backend, events: ctx.events, probeReady, probeInternet });
watchdog.start(30_000);
const metricsTimer = setInterval(() => {
  for (const t of ctx.tunnels.list()) void ctx.sampler.sample(t.id, t.metricsPort);
}, 60_000);

const shutdown = async () => { watchdog.stop(); clearInterval(metricsTimer); await app.close(); ctx.db.close(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
console.log(`cloudflared-manager listening on http://${config.host}:${config.port} (backend=${config.serviceBackend})`);
```

- [ ] **Step 2: `build.mjs`**
```js
import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['node:*'],
  logLevel: 'info',
});
```

- [ ] **Step 3: Smoke test**

Run: `pnpm --filter @tm/server build && NODE_ENV=production SERVICE_BACKEND=fake DATA_DIR=/tmp/tm-smoke ETC_DIR=/tmp/tm-smoke/etc WEB_DIST=/nonexistent PORT=18080 node --disable-warning=ExperimentalWarning apps/server/dist/server.mjs & sleep 2; curl -s localhost:18080/api/health; curl -s localhost:18080/api/setup/status; kill %1`
Expected: `{"ok":true}` and `{"adminCreated":false,"cloudflareConnected":false}`. (Use the scratchpad instead of `/tmp` during execution.)

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(server): add entrypoint, watchdog loop and esbuild bundle"`

---

### Task 12: Web — scaffold, Kumo, i18n, API client, layout

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,vitest.config.ts}`, `apps/web/src/{main.tsx,app.tsx,styles.css,test-setup.ts}`
- Create: `apps/web/src/i18n/{index.ts,en.json,pt-BR.json}`, `apps/web/src/api/{client.ts,hooks.ts}`, `apps/web/src/components/{app-shell.tsx,status-badge.tsx,error-banner.tsx,page-header.tsx}`, `apps/web/src/lib/format.ts`
- Test: `apps/web/src/i18n/i18n.test.ts`, `apps/web/src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { code: ErrorCode; status: number; details?: unknown }`
  - `api.get<T>(path)`, `api.post<T>(path, body?)`, `api.put<T>`, `api.patch<T>`, `api.del(path)` — `fetch('/api' + path, { credentials: 'same-origin' })`; 204 → `undefined`; error → `ApiError`; 401 fires `window.dispatchEvent(new Event('tm:unauthorized'))`.
  - Hooks (TanStack Query): `useSetupStatus`, `useMe`, `useCloudflareStatus`, `useTunnels` (refetch 10 s), `useTunnel(id)` (refetch 10 s), `useTunnelEvents(id)`, `useTunnelMetrics(id)` (refetch 60 s), `useRecentEvents`, `useCloudflaredInfo`, and mutations `useCreateTunnel`, `useUpdateTunnel(id)`, `useTunnelAction(id)` (`'start'|'stop'|'restart'|'adopt'`), `useDeleteTunnel`, `useSaveRoutes(id)`, `useTestOrigin`, `useLogin`, `useLogout`, `useSetupAdmin`, `useConnectCloudflare`, `useChangePassword`, `useUpdateCloudflared`.
  - `useErrorMessage(): (e: unknown) => string` — translates `ApiError.code` via `errors.<CODE>` (fallback `errors.INTERNAL`); for `CF_PERMISSION_MISSING` interpolates `details.permission`.
  - `<StatusBadge kind="local"|"edge"|"watchdog" value={...} />`
  - `<AppShell>` — Kumo sidebar (`Sidebar`) with Dashboard / Settings items, `CloudflareLogo` logo, language selector and logout button.
  - i18n keys: `nav.*`, `common.*`, `status.local.*`, `status.edge.*`, `status.watchdog.*`, `errors.<ErrorCode>`, `setup.*`, `login.*`, `dashboard.*`, `tunnel.*`, `routes.*`, `settings.*`, `events.<EventType>`.

- [ ] **Step 1: `apps/web/package.json`**
```json
{
  "name": "@tm/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc --noEmit && vite build", "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@tm/shared": "workspace:*",
    "@cloudflare/kumo": "2.14.0",
    "@phosphor-icons/react": "^2.1.10",
    "@tanstack/react-query": "^5.100.0",
    "echarts": "^6.0.0",
    "i18next": "^26.0.0",
    "i18next-browser-languagedetector": "^8.0.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-i18next": "^17.0.0",
    "react-router": "^7.14.0",
    "zod": "^4.3.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.0.0",
    "jsdom": "^27.0.0",
    "tailwindcss": "^4.3.0",
    "typescript": "^5.9.0",
    "vite": "^8.0.0",
    "vitest": "^4.1.0"
  }
}
```
(Exact versions: use whatever `pnpm add` resolves; confirm Kumo peer compatibility — React 19, zod 4, echarts 6, phosphor 2.1.)

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } } },
  build: { outDir: 'dist', emptyOutDir: true },
});
```
`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'] } });
```
`src/test-setup.ts`: `import './i18n';`

`tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": ["vite/client"] }, "include": ["src"] }
```

`src/styles.css`:
```css
@source "../node_modules/@cloudflare/kumo/dist/**/*.{js,jsx,ts,tsx}";
@import "@cloudflare/kumo/styles";
@import "tailwindcss";

html, body, #root { height: 100%; }
body { @apply bg-kumo-canvas text-kumo-default; }
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cloudflared Manager</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 2: Consult the Kumo documentation before writing components**

Run: `cd apps/web && npx @cloudflare/kumo doc Sidebar && npx @cloudflare/kumo doc Table && npx @cloudflare/kumo doc Dialog && npx @cloudflare/kumo doc Tabs && npx @cloudflare/kumo doc Toast && npx @cloudflare/kumo doc Chart && npx @cloudflare/kumo doc Select && npx @cloudflare/kumo doc Field`
Note the actual APIs (subcomponent names and props). Where the plan below diverges from the docs, **the docs win**.

- [ ] **Step 3: Open the Cloudflare dashboard in the user's Chrome (already logged in) for layout reference**

Use the `claude-in-chrome` skill: open `https://one.dash.cloudflare.com/` → Networks → Tunnels; take screenshots of the tunnel list, the detail view (Public Hostnames tab) and the hostname form. Record patterns: page header (title + description + primary action on the right), tables inside `LayerCard`, status badges, empty states. **Do not** click anything that changes the account.

- [ ] **Step 4: Failing tests**

`src/i18n/i18n.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import i18n from './index';
import en from './en.json';
import pt from './pt-BR.json';
import { ERROR_CODES } from '@tm/shared';

const flatten = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));

describe('i18n', () => {
  it('pt-BR and en have the same keys', () => { expect(flatten(pt).sort()).toEqual(flatten(en).sort()); });
  it('every error code is translated', () => {
    for (const c of ERROR_CODES) expect(flatten(en)).toContain(`errors.${c}`);
  });
  it('switches language', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(i18n.t('nav.dashboard')).toBe('Painel');
    await i18n.changeLanguage('en');
    expect(i18n.t('nav.dashboard')).toBe('Dashboard');
  });
});
```

`src/api/client.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

afterEach(() => vi.restoreAllMocks());
describe('api client', () => {
  it('parses JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await api.get('/health')).toEqual({ ok: true });
  });
  it('returns undefined on 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api.post('/auth/logout')).toBeUndefined();
  });
  it('throws ApiError with code and fires unauthorized event', async () => {
    const spy = vi.fn(); window.addEventListener('tm:unauthorized', spy);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'x' }), { status: 401 }));
    const e = await api.get('/tunnels').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError); expect(e.code).toBe('UNAUTHORIZED'); expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run** — `pnpm install && pnpm --filter @tm/web test` → FAIL.

- [ ] **Step 6: Implement `api/client.ts`**
```ts
import type { ApiErrorBody, ErrorCode } from '@tm/shared';

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number, public details?: unknown) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = (data ?? { code: 'INTERNAL', message: res.statusText }) as ApiErrorBody;
    if (res.status === 401 && e.code === 'UNAUTHORIZED') window.dispatchEvent(new Event('tm:unauthorized'));
    throw new ApiError(e.code, e.message, res.status, e.details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: (p: string) => request<void>('DELETE', p),
};
```

- [ ] **Step 7: Implement `api/hooks.ts`**
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CloudflareStatus, CloudflaredVersionInfo, MetricsSnapshot, OriginTestResult, Route, SetupStatus,
  TunnelDetail, TunnelEvent, TunnelSummary, UpdateTunnel,
} from '@tm/shared';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from './client';

export const qk = {
  setup: ['setup'] as const, me: ['me'] as const, cf: ['cf'] as const, tunnels: ['tunnels'] as const,
  tunnel: (id: string) => ['tunnel', id] as const, events: (id?: string) => ['events', id ?? 'all'] as const,
  metrics: (id: string) => ['metrics', id] as const, cloudflared: ['cloudflared'] as const,
};

export const useSetupStatus = () => useQuery({ queryKey: qk.setup, queryFn: () => api.get<SetupStatus>('/setup/status') });
export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api.get<{ username: string }>('/auth/me'), retry: false });
export const useCloudflareStatus = () => useQuery({ queryKey: qk.cf, queryFn: () => api.get<CloudflareStatus>('/cloudflare/status') });
export const useTunnels = () => useQuery({ queryKey: qk.tunnels, queryFn: () => api.get<TunnelSummary[]>('/tunnels'), refetchInterval: 10_000 });
export const useTunnel = (id: string) => useQuery({ queryKey: qk.tunnel(id), queryFn: () => api.get<TunnelDetail>(`/tunnels/${id}`), refetchInterval: 10_000 });
export const useTunnelEvents = (id: string) => useQuery({ queryKey: qk.events(id), queryFn: () => api.get<TunnelEvent[]>(`/tunnels/${id}/events`), refetchInterval: 15_000 });
export const useRecentEvents = () => useQuery({ queryKey: qk.events(), queryFn: () => api.get<TunnelEvent[]>('/events?limit=10'), refetchInterval: 15_000 });
export const useTunnelMetrics = (id: string) => useQuery({ queryKey: qk.metrics(id), queryFn: () => api.get<MetricsSnapshot>(`/tunnels/${id}/metrics`), refetchInterval: 60_000 });
export const useCloudflaredInfo = () => useQuery({ queryKey: qk.cloudflared, queryFn: () => api.get<CloudflaredVersionInfo>('/system/cloudflared') });

function useInvalidating<V, R>(fn: (v: V) => Promise<R>, keys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))) });
}

export const useSetupAdmin = () => useInvalidating((b: { username: string; password: string }) => api.post('/setup/admin', b), [qk.setup, qk.me]);
export const useLogin = () => useInvalidating((b: { username: string; password: string }) => api.post('/auth/login', b), [qk.me]);
export const useLogout = () => useInvalidating(() => api.post('/auth/logout'), [qk.me]);
export const useChangePassword = () => useMutation({ mutationFn: (b: { currentPassword: string; newPassword: string }) => api.post('/auth/password', b) });
export const useConnectCloudflare = () => useInvalidating((b: { token: string; accountId?: string }) => api.post<CloudflareStatus>('/cloudflare/token', b), [qk.cf, qk.setup, qk.tunnels]);
export const useCreateTunnel = () => useInvalidating((name: string) => api.post<TunnelSummary>('/tunnels', { name }), [qk.tunnels]);
export const useUpdateTunnel = (id: string) => useInvalidating((b: UpdateTunnel) => api.patch<TunnelSummary>(`/tunnels/${id}`, b), [qk.tunnels, qk.tunnel(id)]);
export const useTunnelAction = (id: string) =>
  useInvalidating((a: 'start' | 'stop' | 'restart' | 'adopt') => api.post(`/tunnels/${id}/${a}`), [qk.tunnels, qk.tunnel(id), qk.events(id)]);
export const useDeleteTunnel = () => useInvalidating((id: string) => api.del(`/tunnels/${id}`), [qk.tunnels]);
export const useSaveRoutes = (id: string) =>
  useInvalidating((b: { version: number; routes: Route[]; overwriteDns?: string[]; keepDns?: string[] }) => api.put<TunnelDetail>(`/tunnels/${id}/routes`, b), [qk.tunnel(id), qk.tunnels]);
export const useTestOrigin = () => useMutation({ mutationFn: (service: string) => api.post<OriginTestResult>('/tools/test-origin', { service }) });
export const useUpdateCloudflared = () => useInvalidating(() => api.post<CloudflaredVersionInfo>('/system/cloudflared/update'), [qk.cloudflared, qk.tunnels]);

export function useErrorMessage() {
  const { t } = useTranslation();
  return (e: unknown) => {
    if (e instanceof ApiError) {
      const permission = (e.details as { permission?: string } | undefined)?.permission;
      return t(`errors.${e.code}`, { permission, defaultValue: e.message });
    }
    return t('errors.INTERNAL');
  };
}
```

- [ ] **Step 8: i18n** — `src/i18n/index.ts`:
```ts
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ptBR from './pt-BR.json';

void i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
  fallbackLng: 'en',
  supportedLngs: ['en', 'pt-BR'],
  nonExplicitSupportedLngs: true,
  load: 'currentOnly',
  detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'tm.lang', caches: ['localStorage'] },
  interpolation: { escapeValue: false },
});
export default i18n;
```
(`nonExplicitSupportedLngs` makes `pt` and `pt-PT` fall back to `pt-BR`; if that doesn't resolve it, map it in `convertDetectedLanguage: (l) => l.startsWith('pt') ? 'pt-BR' : l`.)

`src/i18n/en.json` (full content; `pt-BR.json` has **the same keys**, translated):
```json
{
  "app": { "name": "Cloudflared Manager" },
  "nav": { "dashboard": "Dashboard", "settings": "Settings", "logout": "Log out", "language": "Language" },
  "common": {
    "save": "Save", "cancel": "Cancel", "delete": "Delete", "edit": "Edit", "add": "Add", "close": "Close", "confirm": "Confirm",
    "loading": "Loading…", "retry": "Try again", "copy": "Copy", "copied": "Copied", "yes": "Yes", "no": "No", "back": "Back", "next": "Next",
    "never": "never", "unknown": "unknown", "optional": "optional", "advanced": "Advanced options"
  },
  "status": {
    "local": { "active": "Running", "inactive": "Stopped", "failed": "Failed", "activating": "Starting", "not-installed": "Not on this host" },
    "edge": { "healthy": "Healthy", "degraded": "Degraded", "down": "Down", "inactive": "Inactive" },
    "watchdog": { "healthy": "Keep-alive OK", "degraded": "Degraded", "restarting": "Restarting", "failing": "Gave up", "disabled": "Keep-alive off" }
  },
  "errors": {
    "CF_UNREACHABLE": "Cloudflare is unreachable. Check this host's internet connection.",
    "CF_TOKEN_INVALID": "The Cloudflare token is invalid or was revoked. Connect again in Settings.",
    "CF_PERMISSION_MISSING": "The token is missing a permission: {{permission}}. Create a new token with the required permissions.",
    "CF_RATE_LIMITED": "Cloudflare rate limit reached. Wait a minute and try again.",
    "CF_API_ERROR": "Cloudflare returned an error.",
    "CF_NOT_CONNECTED": "Connect your Cloudflare account first.",
    "ACCOUNT_SELECTION_REQUIRED": "This token has access to several accounts. Choose one.",
    "DNS_CONFLICT": "A DNS record already exists for this hostname.",
    "ZONE_NOT_FOUND": "This hostname does not belong to any domain in your Cloudflare account.",
    "CONFIG_VERSION_CONFLICT": "The routes were changed elsewhere (e.g. in the Cloudflare dashboard). Reload and try again.",
    "TUNNEL_NOT_FOUND": "Tunnel not found.",
    "TUNNEL_NOT_MANAGED": "This tunnel does not run on this host. Adopt it first.",
    "TUNNEL_NOT_REMOTE": "This tunnel uses a local config file and cannot be managed here.",
    "SERVICE_COMMAND_FAILED": "A system command failed. Check the logs.",
    "VALIDATION_ERROR": "Some fields are invalid.",
    "UNAUTHORIZED": "Your session expired. Log in again.",
    "SETUP_ALREADY_DONE": "Setup was already completed.",
    "INVALID_CREDENTIALS": "Wrong username or password.",
    "RATE_LIMITED": "Too many attempts. Wait a minute.",
    "INTERNAL": "Unexpected error."
  },
  "setup": {
    "title": "Welcome", "subtitle": "Two quick steps and your tunnels will manage themselves.",
    "step1": "Create admin", "step2": "Connect Cloudflare",
    "username": "Username", "password": "Password", "passwordHint": "At least 12 characters", "confirmPassword": "Confirm password",
    "passwordMismatch": "Passwords do not match", "createAdmin": "Create admin",
    "tokenIntro": "Create an API token in Cloudflare with the permissions below, then paste it here. You only do this once.",
    "createToken": "Create token in Cloudflare", "permissions": "Required permissions",
    "permTunnel": "Account → Cloudflare Tunnel → Edit", "permDns": "Zone → DNS → Edit", "permZone": "Zone → Zone → Read",
    "allZones": "Zone resources: All zones", "token": "API token", "connect": "Connect", "chooseAccount": "Account",
    "connected": "Connected to {{account}}", "zonesFound": "{{count}} domains found", "finish": "Go to dashboard"
  },
  "login": { "title": "Log in", "submit": "Log in" },
  "dashboard": {
    "title": "Tunnels", "subtitle": "Tunnels running on this host keep themselves connected.",
    "create": "Create tunnel", "healthy": "Healthy", "degraded": "Degraded", "stopped": "Stopped", "failing": "Need attention",
    "routes": "Routes", "recentEvents": "Recent events", "noEvents": "No events yet",
    "emptyTitle": "No tunnels yet", "emptyDescription": "Create your first tunnel to expose a service from your homelab.",
    "name": "Name", "status": "Status", "connections": "Connections", "uptime": "Uptime", "keepAlive": "Keep-alive",
    "notHere": "Not on this host", "adopt": "Run here", "createTitle": "Create tunnel", "createName": "Tunnel name",
    "createNameHint": "Letters, numbers, dots, dashes and underscores."
  },
  "tunnel": {
    "tabs": { "routes": "Public hostnames", "status": "Status", "logs": "Logs", "events": "Events", "settings": "Settings" },
    "start": "Start", "stop": "Stop", "restart": "Restart", "deleteTitle": "Delete tunnel",
    "deleteDescription": "This removes the tunnel from Cloudflare, its routes, the DNS records created here and the local service.",
    "deleteConfirm": "Type {{name}} to confirm", "connectionsTitle": "Edge connections", "noConnections": "No active connections",
    "version": "cloudflared version", "requests": "Requests / min", "errors": "Errors / min", "metricsEmpty": "Metrics appear after a couple of minutes.",
    "logsPaused": "Paused", "pause": "Pause", "resume": "Resume", "level": "Level", "allLevels": "All levels",
    "keepAlive": "Keep-alive", "keepAliveHint": "Restart the tunnel automatically when it stays unhealthy.",
    "tolerance": "Tolerance (minutes)", "toleranceHint": "How long the tunnel may stay unhealthy before a restart.",
    "logLevel": "Log level", "protocol": "Protocol", "rename": "Name", "dangerZone": "Danger zone",
    "failingBanner": "The watchdog gave up after several restarts. Check the logs, then start the tunnel again.",
    "ghost": "This tunnel was deleted in Cloudflare. Delete it here to clean up.",
    "notHereBanner": "This tunnel exists in your account but does not run on this host."
  },
  "routes": {
    "empty": "No public hostnames yet", "add": "Add public hostname", "editTitle": "Edit public hostname", "addTitle": "Add public hostname",
    "subdomain": "Subdomain", "domain": "Domain", "path": "Path", "service": "Service", "type": "Type", "url": "URL",
    "hostname": "Hostname", "catchAll": "Everything else returns 404", "moveUp": "Move up", "moveDown": "Move down",
    "testOrigin": "Test origin", "reachable": "Reachable in {{ms}} ms", "unreachable": "Unreachable: {{error}}",
    "noTLSVerify": "Skip TLS verification", "httpHostHeader": "HTTP Host header", "originServerName": "Origin server name",
    "connectTimeout": "Connect timeout", "keepAliveTimeout": "Keep-alive timeout",
    "conflictTitle": "DNS record already exists", "conflictDescription": "{{hostnames}} already point somewhere else. Replace with a record pointing to this tunnel?",
    "overwrite": "Replace DNS record", "removeTitle": "Remove public hostname", "removeDns": "Also delete the DNS record",
    "saved": "Routes saved", "reload": "Reload"
  },
  "settings": {
    "title": "Settings", "account": "Cloudflare account", "tokenEnding": "Token ending in {{suffix}}", "replaceToken": "Replace token",
    "password": "Admin password", "currentPassword": "Current password", "newPassword": "New password", "changePassword": "Change password",
    "passwordChanged": "Password changed", "appearance": "Appearance", "theme": "Theme", "themeLight": "Light", "themeDark": "Dark", "themeSystem": "System",
    "cloudflared": "cloudflared", "installed": "Installed", "latest": "Latest", "update": "Update", "upToDate": "Up to date",
    "updated": "cloudflared updated", "backup": "Backup", "export": "Export", "import": "Import", "imported": "Backup imported",
    "backupHint": "Contains tunnel settings and DNS ownership. The Cloudflare token is never exported."
  },
  "events": {
    "created": "Created", "deleted": "Deleted", "adopted": "Adopted", "started": "Started", "stopped": "Stopped", "restarted": "Restarted",
    "config-changed": "Configuration changed", "watchdog-degraded": "Unhealthy", "watchdog-restart": "Automatic restart",
    "watchdog-recovered": "Recovered", "watchdog-failing": "Watchdog gave up", "no-connectivity": "No internet", "cloudflared-updated": "cloudflared updated"
  }
}
```
Write `pt-BR.json` with the same keys (e.g. `nav.dashboard` = "Painel", `nav.settings` = "Configurações", `dashboard.title` = "Túneis", `tunnel.tabs.routes` = "Hostnames públicos", `errors.DNS_CONFLICT` = "Já existe um registro DNS para este hostname.", etc.). The Step 4 test ensures key parity.

- [ ] **Step 9: `lib/format.ts`, base components, `app.tsx`, `main.tsx`**

`lib/format.ts`:
```ts
export function formatDuration(fromIso: string | null, now = Date.now()): string | null {
  if (!fromIso) return null;
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export const formatDateTime = (iso: string, lng: string) => new Date(iso).toLocaleString(lng);
```

`components/status-badge.tsx`:
```tsx
import { Badge } from '@cloudflare/kumo';
import type { EdgeStatus, LocalState, WatchdogState } from '@tm/shared';
import { useTranslation } from 'react-i18next';

type Props = { kind: 'local'; value: LocalState } | { kind: 'edge'; value: EdgeStatus } | { kind: 'watchdog'; value: WatchdogState };
const TONE: Record<string, 'primary' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'primary', healthy: 'primary', inactive: 'secondary', 'not-installed': 'outline', disabled: 'outline',
  activating: 'secondary', degraded: 'secondary', restarting: 'secondary', failed: 'destructive', down: 'destructive', failing: 'destructive',
};
export function StatusBadge(p: Props) {
  const { t } = useTranslation();
  return <Badge variant={TONE[p.value] ?? 'secondary'}>{t(`status.${p.kind}.${p.value}`)}</Badge>;
}
```
(If Kumo offers success/warning variants on `Badge` in the installed version — check in Step 2 —, use `success` for `active/healthy` and `warning` for `degraded/restarting`.)

`components/error-banner.tsx`:
```tsx
import { Banner } from '@cloudflare/kumo';
import { useErrorMessage } from '../api/hooks';
export function ErrorBanner({ error }: { error: unknown }) {
  const msg = useErrorMessage();
  if (!error) return null;
  return <Banner variant="error">{msg(error)}</Banner>;
}
```

`components/page-header.tsx`:
```tsx
import { Text } from '@cloudflare/kumo';
import type { ReactNode } from 'react';
export function PageHeader({ title, description, actions, breadcrumb }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Text variant="heading1" as="h1">{title}</Text>
          {description && <Text variant="secondary">{description}</Text>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
    </header>
  );
}
```

`components/app-shell.tsx` — sidebar using Kumo's `Sidebar` component (API per the Step 2 docs); items `nav.dashboard` (`/`, `CloudIcon` icon) and `nav.settings` (`/settings`, `GearIcon` icon); in the footer, a language `Select` (`en` → "English", `pt-BR` → "Português (Brasil)") calling `i18n.changeLanguage` and a ghost `nav.logout` button (`SignOutIcon`) that calls `useLogout` and navigates to `/login`. The content sits in `<main className="mx-auto w-full max-w-6xl p-6">`. Structure:
```tsx
import { Button, CloudflareLogo, Select, Sidebar } from '@cloudflare/kumo';
import { CloudIcon, GearIcon, SignOutIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router';
import { useLogout } from '../api/hooks';

export function AppShell() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate(); const loc = useLocation();
  const logout = useLogout();
  const items = [{ to: '/', label: t('nav.dashboard'), icon: CloudIcon }, { to: '/settings', label: t('nav.settings'), icon: GearIcon }];
  return (
    <div className="flex min-h-full">
      <Sidebar /* props conforme doc: header com <CloudflareLogo />, itens com isActive={loc.pathname === to || (to === '/' && loc.pathname.startsWith('/tunnels'))} e onClick/render NavLink */>
        {/* itens */}
      </Sidebar>
      <main className="mx-auto w-full max-w-6xl p-6"><Outlet /></main>
      {/* Sidebar footer: <Select value={i18n.resolvedLanguage} onValueChange={(v) => i18n.changeLanguage(v as string)}> ... ; <Button variant="ghost" icon={SignOutIcon} onClick={async () => { await logout.mutateAsync(); nav('/login'); }}>{t('nav.logout')}</Button> */}
    </div>
  );
}
```
The implementer replaces the comments with the actual `Sidebar` API read in Step 2 — the required behavior is described above.

`app.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader, Toasty } from '@cloudflare/kumo';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { useMe, useSetupStatus } from './api/hooks';
import { AppShell } from './components/app-shell';
import { DashboardPage } from './pages/dashboard';
import { LoginPage } from './pages/login';
import { SettingsPage } from './pages/settings';
import { SetupPage } from './pages/setup';
import { TunnelPage } from './pages/tunnel';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

function Gate() {
  const setup = useSetupStatus(); const me = useMe(); const nav = useNavigate();
  useEffect(() => {
    const h = () => { queryClient.clear(); nav('/login'); };
    window.addEventListener('tm:unauthorized', h); return () => window.removeEventListener('tm:unauthorized', h);
  }, [nav]);
  if (setup.isLoading || (setup.data?.adminCreated && me.isLoading)) return <div className="grid h-full place-items-center"><Loader size={32} /></div>;
  if (!setup.data?.adminCreated) return <Navigate to="/setup" replace />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!setup.data.cloudflareConnected) return <Navigate to="/setup" replace />;
  return <AppShell />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toasty>
        <BrowserRouter>
          <Routes>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Gate />}>
              <Route index element={<DashboardPage />} />
              <Route path="/tunnels/:id" element={<TunnelPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </Toasty>
    </QueryClientProvider>
  );
}
```

`main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import { App } from './app';
import { applyTheme, getStoredTheme } from './lib/theme';

applyTheme(getStoredTheme());
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

`lib/theme.ts` (Kumo uses `data-mode="dark"` on the root element; confirm in Step 2):
```ts
export type Theme = 'light' | 'dark' | 'system';
export const getStoredTheme = (): Theme => (localStorage.getItem('tm.theme') as Theme | null) ?? 'system';
export function applyTheme(theme: Theme) {
  localStorage.setItem('tm.theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-mode', dark ? 'dark' : 'light');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
```

The pages (`pages/*.tsx`) are created as one-line stubs (`export function DashboardPage() { return null; }`) in this task and filled in during Tasks 13–16.

- [ ] **Step 10: Run** — `pnpm --filter @tm/web test` → PASS; `pnpm --filter @tm/web build` → no errors.
- [ ] **Step 11: Commit** — `git add -A && git commit -m "feat(web): scaffold SPA with Kumo, i18n and API client"`

---

### Task 13: Web — Setup wizard and Login

**Files:**
- Create: `apps/web/src/pages/{setup.tsx,login.tsx}`, `apps/web/src/lib/token-link.ts`
- Test: `apps/web/src/pages/setup.test.tsx`, `apps/web/src/lib/token-link.test.ts`

**Interfaces:**
- Produces: `buildTokenTemplateUrl(name?: string): string`.

`SetupPage` behavior:
- Centered layout (`Surface` / `LayerCard`, max width 520 px) with `CloudflareLogo`, `setup.title` title, step indicator (1 `setup.step1`, 2 `setup.step2`).
- Step 1 (when `!adminCreated`): username `Input`, password `SensitiveInput` + confirmation; local validation (12+ chars, matching) shown via `Field error`; submit → `useSetupAdmin`.
- Step 2 (when `adminCreated && !cloudflareConnected`; if not logged in, redirects to `/login`): `setup.tokenIntro` text; permission list (`permTunnel`, `permDns`, `permZone`, `allZones`); primary `Button` with `ArrowSquareOutIcon` icon that opens `buildTokenTemplateUrl()` in a new tab; `SensitiveInput` for the token; `Connect` → `useConnectCloudflare`. On `ACCOUNT_SELECTION_REQUIRED`, shows a `Select` with `details.accounts` and resubmits with `accountId`. Errors via `ErrorBanner`. On success, shows `setup.connected` + `setup.zonesFound` and a `setup.finish` button → `/`.
- If everything is already configured, redirects to `/`.

`LoginPage`: same layout; username `Input` + password `SensitiveInput`; `useLogin`; error via `ErrorBanner`; success → `/`. If `!adminCreated` → `/setup`.

- [ ] **Step 1: Failing tests**

`src/lib/token-link.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildTokenTemplateUrl } from './token-link';

describe('buildTokenTemplateUrl', () => {
  it('prefills permissions for all zones', () => {
    const u = new URL(buildTokenTemplateUrl('cloudflared-manager'));
    expect(u.origin + u.pathname).toBe('https://dash.cloudflare.com/profile/api-tokens');
    expect(JSON.parse(u.searchParams.get('permissionGroupKeys')!)).toEqual([
      { key: 'argotunnel', type: 'edit' }, { key: 'dns', type: 'edit' }, { key: 'zone', type: 'read' },
    ]);
    expect(u.searchParams.get('accountId')).toBe('*');
    expect(u.searchParams.get('zoneId')).toBe('all');
    expect(u.searchParams.get('name')).toBe('cloudflared-manager');
  });
});
```

`src/pages/setup.test.tsx`:
```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18n from '../i18n';
import { SetupPage } from './setup';

function mockFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const h = routes[key]; if (!h) throw new Error(`unmocked ${key}`);
    return h(init);
  });
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const renderPage = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><SetupPage /></MemoryRouter></QueryClientProvider>,
);

beforeEach(async () => { vi.restoreAllMocks(); await i18n.changeLanguage('en'); });

describe('SetupPage', () => {
  it('blocks short or mismatched passwords', async () => {
    mockFetch({ 'GET /api/setup/status': () => json({ adminCreated: false, cloudflareConnected: false }) });
    renderPage();
    await userEvent.type(await screen.findByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create admin' }));
    expect(await screen.findByText('At least 12 characters')).toBeTruthy();
  });
  it('asks to choose an account when the token has several', async () => {
    let connected = false;
    mockFetch({
      'GET /api/setup/status': () => json({ adminCreated: true, cloudflareConnected: connected }),
      'GET /api/auth/me': () => json({ username: 'admin' }),
      'POST /api/cloudflare/token': (init) => {
        const b = JSON.parse(String(init!.body));
        if (!b.accountId) return json({ code: 'ACCOUNT_SELECTION_REQUIRED', message: 'x', details: { accounts: [{ id: 'a'.repeat(32), name: 'Home' }, { id: 'b'.repeat(32), name: 'Work' }] } }, 409);
        connected = true;
        return json({ connected: true, accountId: b.accountId, accountName: 'Work', tokenSuffix: 'abcd', zones: [{ id: '1', name: 'example.com' }] });
      },
    });
    renderPage();
    await userEvent.type(await screen.findByLabelText('API token'), 'x'.repeat(40));
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('This token has access to several accounts. Choose one.')).toBeTruthy();
    // Select interaction depends on Kumo's Select markup; the implementer adapts the selector after reading its doc.
  });
});
```
(If Kumo's `SensitiveInput`/`Select` doesn't associate `label` accessibly, pass `aria-label` explicitly; the tests use accessible labels.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `token-link.ts`**
```ts
export function buildTokenTemplateUrl(name = 'cloudflared-manager') {
  const perms = [{ key: 'argotunnel', type: 'edit' }, { key: 'dns', type: 'edit' }, { key: 'zone', type: 'read' }];
  const q = new URLSearchParams({ permissionGroupKeys: JSON.stringify(perms), accountId: '*', zoneId: 'all', name });
  return `https://dash.cloudflare.com/profile/api-tokens?${q.toString()}`;
}
```

- [ ] **Step 4: Implement `setup.tsx` and `login.tsx`** following the behavior described above, using Kumo's `Input`, `SensitiveInput`, `Field`, `Button`, `Select`, `Banner`, `LayerCard`, `Text`, `CloudflareLogo`.

- [ ] **Step 5: Verify the pre-filled link in the user's Chrome**

Using the `claude-in-chrome` skill, open the URL generated by `buildTokenTemplateUrl()` (the user is logged in). Check that all three permissions appear pre-selected. **Do not** click "Continue to summary"/"Create Token". If the tunnel permission doesn't show up, try the `cloudflare_tunnel` and `cfd_tunnel` keys and adjust the test + implementation to whichever works. If neither works, keep the two that do and leave the textual permission list visible (it's already in the layout).

- [ ] **Step 6: Run** — PASS.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(web): add setup wizard and login"`

---

### Task 14: Web — Dashboard and tunnel creation

**Files:**
- Create: `apps/web/src/pages/dashboard.tsx`, `apps/web/src/components/{create-tunnel-dialog.tsx,tunnel-table.tsx,summary-cards.tsx,event-list.tsx}`
- Test: `apps/web/src/components/tunnel-table.test.tsx`

**Interfaces:**
- Produces: `<EventList events={TunnelEvent[]} compact? />` (reused in Task 16), `summarize(tunnels: TunnelSummary[]): { healthy: number; degraded: number; stopped: number; failing: number; routes: number }`.

`summarize` rules (only `managedHere` tunnels):
- `failing` if `watchdog === 'failing'` or `local === 'failed'`;
- otherwise `stopped` if `local === 'inactive'`;
- otherwise `healthy` if `edgeStatus === 'healthy'` and `local === 'active'`;
- otherwise `degraded`.
- `routes` = sum of `routeCount`.

Dashboard layout:
- `PageHeader` with `dashboard.title`, `dashboard.subtitle` and a primary `dashboard.create` button (`PlusIcon`) that opens `CreateTunnelDialog`.
- `Grid variant="4up"` with 4 summary cards (`LayerCard`) (healthy, degraded, stopped, failing), each with a large number and a colored dot (`bg-kumo-success`, `bg-kumo-warning`, `bg-kumo-inactive`/`text-kumo-subtle`, `bg-kumo-danger`).
- `LayerCard` with `TunnelTable`: columns Name (link to `/tunnels/:id`), Status (`StatusBadge edge` + `StatusBadge local`), Connections (colos in `Text variant="mono"`, e.g. `GRU · EZE`), Routes, Uptime (`formatDuration(activeSince)`), Keep-alive (`StatusBadge watchdog`). `!managedHere` tunnels appear last, dimmed, with a `dashboard.adopt` button (only if `remote`) → `useTunnelAction(id).mutate('adopt')`.
- Empty state: Kumo's `Empty` component with `dashboard.emptyTitle`/`emptyDescription` and a create button.
- `LayerCard` "Recent events" with `EventList` (`useRecentEvents`).
- `CreateTunnelDialog`: `Dialog` with a name `Input` (validated with `createTunnelSchema`), `useCreateTunnel`; on success it closes, shows a toast and navigates to `/tunnels/:id?tab=routes`.

- [ ] **Step 1: Failing test** — `tunnel-table.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { TunnelSummary } from '@tm/shared';
import '../i18n';
import { summarize } from './summary-cards';
import { TunnelTable } from './tunnel-table';

const base: TunnelSummary = {
  id: '6ff42ae2-765d-4adf-8112-31c55c1551ef', name: 'home', createdAt: '', remote: true, managedHere: true, edgeStatus: 'healthy',
  connections: [{ coloName: 'gru01', openedAt: '', originIp: '', clientVersion: '' }, { coloName: 'eze01', openedAt: '', originIp: '', clientVersion: '' }],
  local: 'active', activeSince: new Date(Date.now() - 3_600_000).toISOString(), watchdog: 'healthy', routeCount: 3,
  settings: { keepAlive: true, toleranceMinutes: 2, logLevel: 'info', protocol: 'auto', metricsPort: 20241 },
};

describe('summarize', () => {
  it('buckets managed tunnels', () => {
    const s = summarize([base, { ...base, local: 'inactive' }, { ...base, watchdog: 'failing' }, { ...base, edgeStatus: 'degraded' }, { ...base, managedHere: false }]);
    expect(s).toEqual({ healthy: 1, degraded: 1, stopped: 1, failing: 1, routes: 12 });
  });
});

describe('TunnelTable', () => {
  it('renders name, colos and adopt action for foreign tunnels', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <TunnelTable tunnels={[base, { ...base, id: '7ff42ae2-765d-4adf-8112-31c55c1551ef', name: 'other', managedHere: false, local: 'not-installed', settings: null }]} />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.getByText(/GRU/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run here' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3:** implement. **Step 4:** Run — PASS.

`summarize` implementation (in `summary-cards.tsx`):
```ts
import type { TunnelSummary } from '@tm/shared';
export function summarize(tunnels: TunnelSummary[]) {
  const out = { healthy: 0, degraded: 0, stopped: 0, failing: 0, routes: 0 };
  for (const t of tunnels) {
    if (!t.managedHere) continue;
    out.routes += t.routeCount;
    if (t.watchdog === 'failing' || t.local === 'failed') out.failing++;
    else if (t.local === 'inactive') out.stopped++;
    else if (t.edgeStatus === 'healthy' && t.local === 'active') out.healthy++;
    else out.degraded++;
  }
  return out;
}
```
Colos: `connections.map((c) => c.coloName.replace(/\d+$/, '').toUpperCase())` without duplicates, joined by ` · `.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(web): add dashboard and create tunnel dialog"`

---

### Task 15: Web — Tunnel detail, routes tab

**Files:**
- Create: `apps/web/src/pages/tunnel.tsx`, `apps/web/src/components/routes/{routes-tab.tsx,route-form-dialog.tsx,route-model.ts}`
- Test: `apps/web/src/components/routes/route-model.test.ts`, `apps/web/src/components/routes/routes-tab.test.tsx`

**Interfaces:**
- Produces:
```ts
// route-model.ts
export type ServiceType = 'http' | 'https' | 'tcp' | 'ssh' | 'rdp' | 'unix' | 'http_status';
export interface RouteFormValues { subdomain: string; zone: string; path: string; type: ServiceType; target: string;
  noTLSVerify: boolean; httpHostHeader: string; originServerName: string; connectTimeout: string; keepAliveTimeout: string }
export function routeToForm(r: Route, zones: Zone[]): RouteFormValues;
export function formToRoute(v: RouteFormValues): Route;          // validates with routeSchema; throws ZodError
export function moveRoute(routes: Route[], index: number, dir: -1 | 1): Route[];
```
- `TunnelPage`: `PageHeader` with a breadcrumb (`Breadcrumbs`: Tunnels › name), name, `StatusBadge`s and actions (`Start`/`Stop` depending on `local`, `Restart`); error `Banner` for `watchdog === 'failing'` (`tunnel.failingBanner`), ghost (`tunnel.ghost`) and `!managedHere` (`tunnel.notHereBanner` + adopt button). `Tabs` (underline variant) with `routes | status | logs | events | settings`, tab synced with `?tab=`.

Routes tab rules:
- `LayerCard` with `Table`: Hostname (`hostname` + `path` in mono), Service (mono), actions (move up/down, edit, remove via `DropdownMenu`). Fixed last row, dimmed: `*` → `http_status:404` with `routes.catchAll`.
- Add/edit opens `RouteFormDialog`: subdomain `Input` + domain `Select` (zones from `useCloudflareStatus().data.zones`) side by side (with a `sub.domain` preview below), path `Input` (optional), type `Select` + URL `Input` (placeholder `192.168.1.10:8123`), `Collapsible` "Advanced options" with `Switch noTLSVerify` and inputs; `routes.testOrigin` button → `useTestOrigin` showing `routes.reachable`/`routes.unreachable`.
- Saving builds the new list and calls `useSaveRoutes(id).mutateAsync({ version: detail.configVersion, routes })`:
  - `DNS_CONFLICT` → confirmation `Dialog` (`routes.conflictTitle`/`conflictDescription` with `details.hostnames`) → resubmits with `overwriteDns: hostnames`.
  - `CONFIG_VERSION_CONFLICT` → `Banner` with a `routes.reload` button (refetch).
  - success → `routes.saved` toast.
- Remove opens a `Dialog` with a `routes.removeDns` `Checkbox` checked by default; unchecked → `keepDns: [hostname]`. If another rule uses the same host, the checkbox doesn't appear.
- Reordering saves immediately.
- `!managedHere` or `!remote` tunnel: read-only table.

- [ ] **Step 1: Failing tests** — `route-model.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formToRoute, moveRoute, routeToForm } from './route-model';

const zones = [{ id: '1', name: 'example.com' }, { id: '2', name: 'sub.example.com' }];
describe('route model', () => {
  it('round-trips http route with advanced options', () => {
    const r = { hostname: 'ha.example.com', service: 'https://10.0.0.5:8123', originRequest: { noTLSVerify: true } };
    const f = routeToForm(r, zones);
    expect(f).toMatchObject({ subdomain: 'ha', zone: 'example.com', type: 'https', target: '10.0.0.5:8123', noTLSVerify: true });
    expect(formToRoute(f)).toEqual(r);
  });
  it('uses longest zone and supports apex', () => {
    expect(routeToForm({ hostname: 'x.sub.example.com', service: 'http://a:1' }, zones)).toMatchObject({ subdomain: 'x', zone: 'sub.example.com' });
    expect(routeToForm({ hostname: 'example.com', service: 'http://a:1' }, zones)).toMatchObject({ subdomain: '', zone: 'example.com' });
  });
  it('builds unix and http_status services', () => {
    const base = { subdomain: 'a', zone: 'example.com', path: '', noTLSVerify: false, httpHostHeader: '', originServerName: '', connectTimeout: '', keepAliveTimeout: '' };
    expect(formToRoute({ ...base, type: 'unix', target: '/run/x.sock' }).service).toBe('unix:/run/x.sock');
    expect(formToRoute({ ...base, type: 'http_status', target: '404' }).service).toBe('http_status:404');
  });
  it('rejects invalid input', () => {
    expect(() => formToRoute({ subdomain: 'bad host', zone: 'example.com', path: '', type: 'http', target: 'x:1', noTLSVerify: false, httpHostHeader: '', originServerName: '', connectTimeout: '', keepAliveTimeout: '' })).toThrow();
  });
  it('moves routes within bounds', () => {
    const rs = [{ hostname: 'a.example.com', service: 'http://a:1' }, { hostname: 'b.example.com', service: 'http://b:1' }];
    expect(moveRoute(rs, 1, -1).map((r) => r.hostname)).toEqual(['b.example.com', 'a.example.com']);
    expect(moveRoute(rs, 0, -1)).toEqual(rs);
  });
});
```

`routes-tab.test.tsx` — with a mocked `fetch`: renders `RoutesTab` with a `TunnelDetail` with 1 route; click "Add public hostname", fill in `sub=git`, choose a domain, URL `10.0.0.9:3000`, save; the `PUT /api/tunnels/:id/routes` mock responds 409 `DNS_CONFLICT` with `details.hostnames: ['git.example.com']` the first time and 200 the second time. Assertions: the "DNS record already exists" dialog appears; after "Replace DNS record", the second PUT has `overwriteDns: ['git.example.com']` and the submitted route list has 2 items with the new one last.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement `route-model.ts`**
```ts
import { routeSchema, type Route, type Zone } from '@tm/shared';

export type ServiceType = 'http' | 'https' | 'tcp' | 'ssh' | 'rdp' | 'unix' | 'http_status';
export interface RouteFormValues {
  subdomain: string; zone: string; path: string; type: ServiceType; target: string;
  noTLSVerify: boolean; httpHostHeader: string; originServerName: string; connectTimeout: string; keepAliveTimeout: string;
}

export function routeToForm(r: Route, zones: Zone[]): RouteFormValues {
  const zone = zones.filter((z) => r.hostname === z.name || r.hostname.endsWith(`.${z.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
  const subdomain = zone ? r.hostname.slice(0, Math.max(0, r.hostname.length - zone.name.length - 1)) : r.hostname;
  const m = /^([a-z_]+):(?:\/\/)?(.*)$/.exec(r.service);
  const type = (m?.[1] ?? 'http') as ServiceType;
  const o = r.originRequest ?? {};
  return {
    subdomain, zone: zone?.name ?? '', path: r.path ?? '', type, target: m?.[2] ?? r.service,
    noTLSVerify: !!o.noTLSVerify, httpHostHeader: o.httpHostHeader ?? '', originServerName: o.originServerName ?? '',
    connectTimeout: o.connectTimeout ?? '', keepAliveTimeout: o.keepAliveTimeout ?? '',
  };
}

export function formToRoute(v: RouteFormValues): Route {
  const hostname = v.subdomain.trim() ? `${v.subdomain.trim()}.${v.zone}` : v.zone;
  const service = v.type === 'unix' ? `unix:${v.target.trim()}` : v.type === 'http_status' ? `http_status:${v.target.trim()}` : `${v.type}://${v.target.trim()}`;
  const originRequest = Object.fromEntries(Object.entries({
    noTLSVerify: v.noTLSVerify || undefined, httpHostHeader: v.httpHostHeader || undefined, originServerName: v.originServerName || undefined,
    connectTimeout: v.connectTimeout || undefined, keepAliveTimeout: v.keepAliveTimeout || undefined,
  }).filter(([, x]) => x !== undefined));
  return routeSchema.parse({ hostname, ...(v.path ? { path: v.path } : {}), service, ...(Object.keys(originRequest).length ? { originRequest } : {}) });
}

export function moveRoute(routes: Route[], index: number, dir: -1 | 1): Route[] {
  const j = index + dir;
  if (j < 0 || j >= routes.length) return routes;
  const out = [...routes]; [out[index], out[j]] = [out[j]!, out[index]!]; return out;
}
```

- [ ] **Step 4: Implement `tunnel.tsx`, `routes-tab.tsx`, `route-form-dialog.tsx`** following the rules above. The other tabs render `null` until Task 16.
- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(web): add tunnel page and public hostnames editor"`

---

### Task 16: Web — Status, Logs, Events, Settings tabs

**Files:**
- Create: `apps/web/src/components/tunnel/{status-tab.tsx,logs-tab.tsx,events-tab.tsx,settings-tab.tsx,log-stream.ts}`
- Test: `apps/web/src/components/tunnel/log-stream.test.ts`, `apps/web/src/components/tunnel/settings-tab.test.tsx`

**Interfaces:**
- Produces: `useLogStream(id: string, opts: { paused: boolean }): { lines: LogLine[]; connected: boolean }` — loads `GET /tunnels/:id/logs?lines=200` and opens `EventSource('/api/tunnels/:id/logs/stream')`; accumulates at most 1000 lines; while `paused`, buffers and applies on resume; closes the `EventSource` on unmount. Local `LogLine` type identical to the server's (`{ time, level, message }`).
- Pure function `appendCapped(lines: LogLine[], incoming: LogLine[], cap = 1000): LogLine[]`.

Status: `LayerCard` "Edge connections" (table with colo/opened at/origin IP/client version; empty → `tunnel.noConnections`); `LayerCard` with a Kumo chart (`Chart`, ECharts) of `requests`/`errors` lines per minute from `useTunnelMetrics` (empty → `tunnel.metricsEmpty`); a line with `tunnel.version` (first `clientVersion`).

Logs: toolbar with a level `Select` (all/info/warn/error), pause/resume `Button`, clear view `Button`; `font-mono text-xs` area with `bg-kumo-recessed` background, auto-scroll to the bottom when not paused, `warn` lines in `text-kumo-warning` and `error/fatal` in `text-kumo-danger`.

Events: `EventList` (from Task 14) with all of the tunnel's events and a relative timestamp.

Settings: form with a name `Input`, keep-alive `Switch`, tolerance `Input type=number` (1–60), log level `Select`, protocol `Select`; `Save` sends **only the changed fields** via `useUpdateTunnel`. "Danger zone" (`LayerCard` with a `ring-kumo-danger` border): `Button variant="destructive"` "Delete" opens a `Dialog` that requires typing the exact name (`tunnel.deleteConfirm`) → `useDeleteTunnel` → navigates to `/`.

- [ ] **Step 1: Failing tests**

`log-stream.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { appendCapped } from './log-stream';
const l = (n: number) => ({ time: String(n), level: 'info' as const, message: `m${n}` });
describe('appendCapped', () => {
  it('keeps the newest lines up to cap', () => {
    const out = appendCapped([l(1), l(2)], [l(3), l(4)], 3);
    expect(out.map((x) => x.message)).toEqual(['m2', 'm3', 'm4']);
  });
});
```

`settings-tab.test.tsx`: renders `SettingsTab` with a `TunnelDetail`; changes only the tolerance to 5 and saves; asserts that the PATCH received exactly `{ toleranceMinutes: 5 }`. Second case: in the delete dialog, the confirm button stays disabled until `home` is typed.

- [ ] **Step 2: Run** — FAIL. **Step 3:** implement. **Step 4:** Run — PASS.

`log-stream.ts`:
```ts
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
export interface LogLine { time: string; level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'; message: string }
export const appendCapped = (lines: LogLine[], incoming: LogLine[], cap = 1000) => [...lines, ...incoming].slice(-cap);

export function useLogStream(id: string, { paused }: { paused: boolean }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const buffer = useRef<LogLine[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let alive = true;
    void api.get<LogLine[]>(`/tunnels/${id}/logs?lines=200`).then((l) => alive && setLines(l)).catch(() => undefined);
    const es = new EventSource(`/api/tunnels/${id}/logs/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const line = JSON.parse(e.data) as LogLine;
      if (pausedRef.current) buffer.current.push(line); else setLines((prev) => appendCapped(prev, [line]));
    };
    return () => { alive = false; es.close(); };
  }, [id]);

  useEffect(() => {
    if (!paused && buffer.current.length) { const b = buffer.current; buffer.current = []; setLines((prev) => appendCapped(prev, b)); }
  }, [paused]);

  return { lines, connected };
}
```

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(web): add status, logs, events and settings tabs"`

---

### Task 17: Web — general Settings page

**Files:**
- Create: `apps/web/src/pages/settings.tsx`
- Test: `apps/web/src/pages/settings.test.tsx`

Sections (each a `LayerCard`):
1. **Cloudflare account**: account name, `settings.tokenEnding`, domain list (`Badge` per zone), `settings.replaceToken` button that opens a `Dialog` with the same flow as setup step 2 (reuse a `ConnectCloudflareForm` component extracted from `setup.tsx` in this task).
2. **Admin password**: current + new `SensitiveInput` (12+) → `useChangePassword`; `settings.passwordChanged` toast.
3. **Appearance**: language `Select` and theme `Select` (`applyTheme`).
4. **cloudflared**: installed vs. latest, `settings.upToDate` `Badge` or `settings.update` button (`useUpdateCloudflared`, with `loading`).
5. **Backup**: export `Button` (downloads `GET /api/backup` as a file via `a[download]` + blob) and import (`input type=file` → `POST /api/backup`); `Text variant="secondary"` with `settings.backupHint`.

- [ ] **Step 1: Failing test** — `settings.test.tsx`: with a mocked `fetch`, renders; asserts that "Token ending in abcd" and the `example.com` domain appear; that, with `updateAvailable: true`, the "Update" button appears and clicking it calls `POST /api/system/cloudflared/update`; and that switching the language to Portuguese changes the title to "Configurações".
- [ ] **Step 2: Run** — FAIL. **Step 3:** implement (extracting `ConnectCloudflareForm` into `components/connect-cloudflare-form.tsx` and using it in `setup.tsx`). **Step 4:** Run — PASS, including the Task 13 tests.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(web): add settings page"`

---

### Task 18: Deploy files and Proxmox scripts

**Files:**
- Create: `deploy/cloudflared@.service`, `deploy/tunnel-manager.service`, `deploy/sudoers`, `ct/cloudflared-manager.sh`, `install/cloudflared-manager-install.sh`, `ct/headers/cloudflared-manager`, `scripts/package-release.sh`
- Test: `shellcheck` + `visudo -cf` (if available) + package test

- [ ] **Step 1: `deploy/cloudflared@.service`**
```ini
[Unit]
Description=Cloudflare Tunnel %i (managed by cloudflared-manager)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=notify
EnvironmentFile=/etc/tunnel-manager/tunnels/%i.env
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=always
RestartSec=5
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```
(`Type=notify`: `cloudflared` sends `sd_notify` when it connects. `StartLimitIntervalSec=0` keeps systemd from giving up during long internet outages. If `Type=notify` causes a start timeout when there's no internet, switch to `Type=simple` — validate in the manual test.)

- [ ] **Step 2: `deploy/tunnel-manager.service`**
```ini
[Unit]
Description=Cloudflared Manager web UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tunnelmgr
Group=tunnelmgr
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=DATA_DIR=/var/lib/tunnel-manager
Environment=ETC_DIR=/etc/tunnel-manager
Environment=WEB_DIST=/opt/tunnel-manager/web
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning /opt/tunnel-manager/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: `deploy/sudoers`**
```
# Installed as /etc/sudoers.d/tunnel-manager (mode 0440)
Cmnd_Alias TM_UNITS = /usr/bin/systemctl start cloudflared@*.service, \
                      /usr/bin/systemctl stop cloudflared@*.service, \
                      /usr/bin/systemctl restart cloudflared@*.service, \
                      /usr/bin/systemctl enable cloudflared@*.service, \
                      /usr/bin/systemctl disable --now cloudflared@*.service, \
                      /usr/bin/journalctl -u cloudflared@*.service *
Cmnd_Alias TM_APT = /usr/bin/apt-get update -qq, \
                    /usr/bin/apt-get install --only-upgrade -y cloudflared
tunnelmgr ALL=(root) NOPASSWD: TM_UNITS, TM_APT
```
`SystemdBackend` calls `sudo -n systemctl …` and `sudo -n journalctl …` by name; `sudo` resolves through `secure_path` (`/usr/bin`), matching the absolute paths above.

- [ ] **Step 4: `install/cloudflared-manager-install.sh`**
```bash
#!/usr/bin/env bash
# Copyright (c) 2026 cesar
# License: MIT
# Source: https://github.com/__GH_REPO__

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

GH_REPO="${TM_GH_REPO:-__GH_REPO__}"

msg_info "Installing Dependencies"
$STD apt-get install -y curl ca-certificates gnupg sudo jq
msg_ok "Installed Dependencies"

msg_info "Installing Cloudflared"
setup_deb822_repo \
  "cloudflared" \
  "https://pkg.cloudflare.com/cloudflare-main.gpg" \
  "https://pkg.cloudflare.com/cloudflared/" \
  "any" \
  "main"
$STD apt-get install -y cloudflared
msg_ok "Installed Cloudflared $(cloudflared --version | awk '{print $3}')"

msg_info "Installing Node.js"
NODE_VERSION="24" setup_nodejs
msg_ok "Installed Node.js $(node -v)"

msg_info "Installing Cloudflared Manager"
useradd --system --home-dir /var/lib/tunnel-manager --shell /usr/sbin/nologin tunnelmgr 2>/dev/null || true
install -d -o tunnelmgr -g tunnelmgr -m 0750 /var/lib/tunnel-manager
install -d -o tunnelmgr -g tunnelmgr -m 0700 /etc/tunnel-manager /etc/tunnel-manager/tunnels
head -c 32 /dev/urandom >/etc/tunnel-manager/secret.key
chown tunnelmgr:tunnelmgr /etc/tunnel-manager/secret.key
chmod 0600 /etc/tunnel-manager/secret.key

RELEASE=$(curl -fsSL "https://api.github.com/repos/${GH_REPO}/releases/latest" | jq -r '.tag_name')
TMP=$(mktemp -d)
curl -fsSL "https://github.com/${GH_REPO}/releases/download/${RELEASE}/cloudflared-manager-${RELEASE}.tar.gz" -o "$TMP/app.tar.gz"
mkdir -p /opt/tunnel-manager
tar -xzf "$TMP/app.tar.gz" -C /opt/tunnel-manager --strip-components=1
echo "$RELEASE" >/opt/tunnel-manager/VERSION
install -m 0644 /opt/tunnel-manager/deploy/cloudflared@.service /etc/systemd/system/cloudflared@.service
install -m 0644 /opt/tunnel-manager/deploy/tunnel-manager.service /etc/systemd/system/tunnel-manager.service
install -m 0440 /opt/tunnel-manager/deploy/sudoers /etc/sudoers.d/tunnel-manager
visudo -cf /etc/sudoers.d/tunnel-manager >/dev/null
rm -rf "$TMP"
systemctl daemon-reload
systemctl enable -q --now tunnel-manager
msg_ok "Installed Cloudflared Manager ${RELEASE}"

motd_ssh
customize
cleanup_lxc
```
(`setup_nodejs` and `setup_deb822_repo` come from community-scripts' `tools.func`, loaded via `FUNCTIONS_FILE_PATH`; confirm the names by reading `install.func`/`tools.func` at the pinned commit. If `setup_nodejs` doesn't exist, install via the NodeSource repository with `setup_deb822_repo "nodesource" "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" "https://deb.nodesource.com/node_24.x" "nodistro" "main"`.)

- [ ] **Step 5: `ct/cloudflared-manager.sh`**
```bash
#!/usr/bin/env bash
# Copyright (c) 2026 cesar
# License: MIT
# Source: https://github.com/__GH_REPO__

GH_REPO="__GH_REPO__"
CORE_COMMIT="__CORE_COMMIT__"
export _CS_DEFAULT_URL="https://raw.githubusercontent.com/${GH_REPO}/main"
export COMMUNITY_SCRIPTS_URL="${_CS_DEFAULT_URL}"
export COMMUNITY_SCRIPTS_CORE_URL="https://raw.githubusercontent.com/community-scripts/core/${CORE_COMMIT}"
source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL}/core/build.func")

APP="Cloudflared-Manager"
var_tags="${var_tags:-network;cloudflare}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-1024}"
var_disk="${var_disk:-4}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -f /etc/systemd/system/tunnel-manager.service ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi
  msg_info "Updating OS and cloudflared"
  $STD apt-get update
  $STD apt-get -y upgrade
  msg_ok "Updated OS and cloudflared"

  RELEASE=$(curl -fsSL "https://api.github.com/repos/${GH_REPO}/releases/latest" | jq -r '.tag_name')
  if [[ "$RELEASE" != "$(cat /opt/tunnel-manager/VERSION 2>/dev/null)" ]]; then
    msg_info "Updating ${APP} to ${RELEASE}"
    TMP=$(mktemp -d)
    curl -fsSL "https://github.com/${GH_REPO}/releases/download/${RELEASE}/cloudflared-manager-${RELEASE}.tar.gz" -o "$TMP/app.tar.gz"
    mkdir -p "$TMP/new"
    tar -xzf "$TMP/app.tar.gz" -C "$TMP/new" --strip-components=1
    echo "$RELEASE" >"$TMP/new/VERSION"
    rm -rf /opt/tunnel-manager.old
    mv /opt/tunnel-manager /opt/tunnel-manager.old
    mv "$TMP/new" /opt/tunnel-manager
    install -m 0644 /opt/tunnel-manager/deploy/cloudflared@.service /etc/systemd/system/cloudflared@.service
    install -m 0644 /opt/tunnel-manager/deploy/tunnel-manager.service /etc/systemd/system/tunnel-manager.service
    install -m 0440 /opt/tunnel-manager/deploy/sudoers /etc/sudoers.d/tunnel-manager
    systemctl daemon-reload
    systemctl restart tunnel-manager
    rm -rf "$TMP"
    msg_ok "Updated ${APP} to ${RELEASE} (previous version kept in /opt/tunnel-manager.old)"
  else
    msg_ok "${APP} is already at ${RELEASE}"
  fi
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:8080${CL}"
```
Note: `update_script` does not restart the tunnels (only the manager), and migrations run when the server starts.

`__GH_REPO__` and `__CORE_COMMIT__` are **configuration** placeholders (not plan placeholders): before the first release, the executor asks the user for the GitHub `owner/repo` and pins `__CORE_COMMIT__` with `git ls-remote https://github.com/community-scripts/core main | cut -f1`, substituting it in the three files with `sed`.

Check whether `build.func` requires `ct/headers/<app>` (ASCII header art): if so, create `ct/headers/cloudflared-manager` with the text generated by `figlet -f slant "Cloudflared-Manager"` (or a simple line if `figlet` isn't available).

- [ ] **Step 6: `scripts/package-release.sh`**
```bash
#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?usage: package-release.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release"
STAGE="$OUT/cloudflared-manager-${VERSION}"
rm -rf "$STAGE" && mkdir -p "$STAGE/deploy"
pnpm -C "$ROOT" build
cp "$ROOT/apps/server/dist/server.mjs" "$STAGE/server.mjs"
cp -r "$ROOT/apps/web/dist" "$STAGE/web"
cp "$ROOT"/deploy/* "$STAGE/deploy/"
tar -czf "$OUT/cloudflared-manager-${VERSION}.tar.gz" -C "$OUT" "cloudflared-manager-${VERSION}"
echo "$OUT/cloudflared-manager-${VERSION}.tar.gz"
```

- [ ] **Step 7: Verify**

Run: `shellcheck -x -e SC1090,SC1091,SC2034,SC2154 ct/cloudflared-manager.sh install/cloudflared-manager-install.sh scripts/package-release.sh` (install with `brew install shellcheck` if needed)
Expected: no warnings.
Run: `bash scripts/package-release.sh v0.0.0-test && tar -tzf release/cloudflared-manager-v0.0.0-test.tar.gz | head`
Expected: contains `server.mjs`, `web/index.html`, `deploy/cloudflared@.service`, `deploy/sudoers`.
Run (package works standalone): extract into a scratchpad directory and run `NODE_ENV=production SERVICE_BACKEND=fake DATA_DIR=<tmp> ETC_DIR=<tmp>/etc WEB_DIST=<dir>/web PORT=18081 node --disable-warning=ExperimentalWarning <dir>/server.mjs`; `curl -s localhost:18081/ | grep -q '<div id="root">'` and `curl -s localhost:18081/api/health`.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: add Proxmox ct/install scripts, systemd units and release packaging"`

---

### Task 19: E2E with Playwright

**Files:**
- Create: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/fake-cf-server.ts`, `e2e/flow.spec.ts`

**Interfaces:**
- Consumes: `startFakeCloudflare` (Task 4), the server bundle (Task 11) and the web build (Task 12).

`e2e/fake-cf-server.ts`: executable script (via `tsx`) that calls `startFakeCloudflare()` on a fixed port (`FAKE_CF_PORT=18787`) — adapt `startFakeCloudflare` to accept an optional `{ port }` — and prints the token.

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:18090', locale: 'en-US' },
  webServer: [
    { command: 'FAKE_CF_PORT=18787 node --import tsx e2e/fake-cf-server.ts', port: 18787, reuseExistingServer: false },
    {
      command: 'rm -rf .e2e-data && pnpm build && NODE_ENV=production SERVICE_BACKEND=fake DATA_DIR=.e2e-data ETC_DIR=.e2e-data/etc WEB_DIST=apps/web/dist CF_API_BASE=http://127.0.0.1:18787 PORT=18090 node --disable-warning=ExperimentalWarning apps/server/dist/server.mjs',
      port: 18090, timeout: 180_000, reuseExistingServer: false,
    },
  ],
});
```
(Add `.e2e-data/` to `.gitignore`.)

`e2e/flow.spec.ts` — a sequential test:
1. `/` redirects to `/setup`; creates admin `admin` / `a-very-long-password`.
2. Pastes the `FAKE_TOKEN` (imported from `apps/server/test/fake-cloudflare.ts`) → sees "Connected to Home Lab" and "2 domains found" → "Go to dashboard".
3. Empty state visible → "Create tunnel" → name `home` → lands on `/tunnels/<id>?tab=routes`.
4. "Add public hostname" → sub `ha`, domain `example.com`, URL `10.0.0.5:8123` → save → the `ha.example.com` row appears above the catch-all row.
5. "Settings" tab → turns off keep-alive → save → "Keep-alive off" badge.
6. "Delete" → types `home` → confirms → returns to the empty dashboard.
7. Switches the language to Portuguese → title "Túneis".

- [ ] **Step 1:** write the files. **Step 2:** `pnpm exec playwright install chromium && pnpm e2e` → PASS (iterate on selectors until it passes; never relax the behavior assertions). **Step 3:** Commit — `git add -A && git commit -m "test: add end-to-end flow with fake Cloudflare"`

---

### Task 20: CI, release and documentation

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `docs/manual-test-checklist.md`

- [ ] **Step 1: `ci.yml`**
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: pnpm exec playwright install --with-deps chromium && pnpm e2e
      - run: sudo apt-get install -y shellcheck && shellcheck -x -e SC1090,SC1091,SC2034,SC2154 ct/*.sh install/*.sh scripts/*.sh
```

- [ ] **Step 2: `release.yml`** (triggers on tag `v*`)
```yaml
name: release
on: { push: { tags: ['v*'] } }
permissions: { contents: write }
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile && pnpm test
      - run: bash scripts/package-release.sh "${GITHUB_REF_NAME}"
      - run: gh release create "${GITHUB_REF_NAME}" "release/cloudflared-manager-${GITHUB_REF_NAME}.tar.gz" --generate-notes
        env: { GH_TOKEN: '${{ github.token }}' }
```

- [ ] **Step 3: `README.md` (pt-BR)** — what it is; install command; first access (admin + token, with the permission list); how keep-alive works (3 layers); multiple domains; updating (run the same command inside the LXC / `update`); local development (`pnpm dev` with `SERVICE_BACKEND=fake` + `CF_API_BASE` pointing at the fake or the real API); repo structure; known limitations (QUIC UDP buffer warnings and `ping_group_range` in an unprivileged LXC).

- [ ] **Step 4: `docs/manual-test-checklist.md` (pt-BR)** — checklist on real Proxmox:
  - install with the command; LXC created with 1 vCPU / 1 GB / 4 GB; `http://<ip>:8080` opens;
  - complete setup with a real token; correct zones;
  - create a tunnel; `systemctl status cloudflared@<id>` active; Zero Trust dashboard shows "Healthy";
  - route to a real service on each domain; external access works; CNAME created in DNS;
  - `pct reboot <ctid>` → tunnel comes back on its own;
  - `systemctl kill -s KILL cloudflared@<id>` → systemd restarts it;
  - disconnect the host's internet for 5 min → no restart loop; recovers on its own; "No internet" event;
  - `Type=notify` without internet doesn't hang the start (otherwise switch to `simple`);
  - remove a route → CNAME disappears; delete the tunnel → it disappears from Cloudflare;
  - update cloudflared through the UI; run the script's `update`;
  - login with the wrong password 6× → rate limit.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "ci: add CI and release workflows; docs: add README and manual checklist"`

---

### Task 21: Visual verification and final review

- [ ] **Step 1:** bring up `pnpm dev` with the server in fake mode pointing at the Cloudflare fake (`CF_API_BASE=http://127.0.0.1:18787`) and open `http://localhost:5173` with Playwright/Chrome. Walk through setup → dashboard → tunnel → each tab → settings, in **en** and **pt-BR**, **light** and **dark** theme, desktop width and 390 px. Take screenshots and compare them with the Cloudflare dashboard ones collected in Task 12. Fix any layout deviations (spacing, title hierarchy, colors only via `kumo-*` tokens).
- [ ] **Step 2:** `pnpm typecheck && pnpm test && pnpm e2e` — everything green; paste the output in the final summary.
- [ ] **Step 3:** review of the entire branch by a fresh reviewer (`superpowers:requesting-code-review` skill), focused on this plan's "Review Focus" section, on security (sudoers, UUID validation, cookie, token never exposed) and on route rollback.
- [ ] **Step 4:** apply fixes and commit (`fix: …`).
