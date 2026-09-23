# Docker Distribution, Rename and Light Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Cloudflared Manager as both a Proxmox LXC and a Docker image from one repository renamed to `cloudflared-manager`, with a light default theme.

**Architecture:** Add a `ProcessBackend` implementing the existing `ServiceBackend` interface that supervises `cloudflared` child processes (no systemd/sudo). A multi-stage `Dockerfile` runs it as a non-root user with a `/data` volume; releases publish a multi-arch image to GHCR. Proxmox scripts move under `proxmox/`.

**Tech Stack:** existing stack (Node 24, Fastify, React/Kumo, Vitest, Playwright) + Docker Buildx, GHCR, tini.

**Spec:** `docs/superpowers/specs/2026-09-23-docker-and-rename-design.md`

## Global Constraints

- Everything in the repository is written in English (code, comments, Markdown, commits); only the pt-BR UI bundle and its tests contain Portuguese.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tunnel tokens never appear in argv, logs or API responses.
- Container runs as non-root uid 10001 without `--privileged`.
- `cloudflared` version pinned via `CLOUDFLARED_VERSION` build arg (default `2026.9.1`).
- Restart delay after a crash: 5 s; stop grace period: 10 s; log ring buffer: 1,000 lines per tunnel.

## Review Focus

1. A tunnel stopped by the user must stay stopped across container restarts (marker file honored by `startAll`).
2. Container shutdown must not mark tunnels as stopped (they must come back on the next boot).
3. `cloudflared` binary missing or crashing instantly must not create a tight restart loop (fixed delay, `failed` visible).
4. Token must not leak into `ps` output (argv) inside the container.
5. Old Proxmox install URL/paths and the renamed repo must not leave dangling references in scripts or docs.

---

### Task 1: Light theme by default

**Files:** Modify `apps/web/src/lib/theme.ts`; Test `apps/web/src/lib/theme.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredTheme } from './theme';

describe('theme', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to light', () => expect(getStoredTheme()).toBe('light'));
  it('keeps a stored choice', () => {
    localStorage.setItem('tm.theme', 'dark');
    expect(getStoredTheme()).toBe('dark');
  });
});
```
- [ ] **Step 2:** Run `pnpm --filter @tm/web vitest run src/lib/theme.test.ts` → FAIL (`system`).
- [ ] **Step 3:** In `getStoredTheme`, return `'light'` instead of `'system'` when nothing is stored.
- [ ] **Step 4:** Run → PASS. Commit `feat(web): default to the light theme`.

---

### Task 2: `canSelfUpdate` capability and `CLOUDFLARED_UPDATE_UNSUPPORTED`

**Files:** `packages/shared/src/{errors.ts,types.ts}`, `apps/server/src/services/{backend.ts,systemd-backend.ts,fake-backend.ts}`, `apps/server/src/http/routes/system.ts`, `apps/web/src/pages/settings.tsx`, `apps/web/src/pages/dashboard.tsx`, i18n bundles; tests in `apps/server/src/http/http.test.ts`, `apps/web/src/pages/settings.test.tsx`.

**Interfaces:**
- `ServiceBackend.canSelfUpdate: boolean`
- `CloudflaredVersionInfo.canSelfUpdate: boolean`
- `ErrorCode` += `'CLOUDFLARED_UPDATE_UNSUPPORTED'`
- i18n: `errors.CLOUDFLARED_UPDATE_UNSUPPORTED`, `settings.imageUpdateHint` ("cloudflared is bundled in the Docker image. Pull the latest image and recreate the container to update it."), `dashboard.updateActionImage`.

- [ ] **Step 1: Failing tests**
  - server: `GET /api/system/cloudflared` includes `canSelfUpdate: true` for the fake backend; with a backend override whose `canSelfUpdate` is false, `POST /api/system/cloudflared/update` returns 409 `CLOUDFLARED_UPDATE_UNSUPPORTED` without calling `upgradeCloudflared`.
  - web: Settings with `{ installed: '2026.9.1', latest: '2026.10.0', updateAvailable: true, canSelfUpdate: false }` shows the image hint and no "Update" button.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: add the field to both backends (`systemd` and `fake` true); `info()` returns it; update route throws `new AppError('CLOUDFLARED_UPDATE_UNSUPPORTED', …, 409)` when false; Settings/Dashboard branch on `canSelfUpdate`; add i18n keys to both bundles.
- [ ] **Step 4:** Run server + web suites → PASS. Commit `feat: expose whether cloudflared can be updated in place`.

---

### Task 3: `ProcessBackend`

**Files:** Create `apps/server/src/services/process-backend.ts`, `apps/server/test/fake-cloudflared.mjs`; Test `apps/server/src/services/process-backend.test.ts`.

**Interfaces:**
```ts
export class ProcessBackend implements ServiceBackend {
  constructor(opts: { etcDir: string; bin?: string; restartDelayMs?: number; stopGraceMs?: number });
  readonly canSelfUpdate = false;
  startAll(): Promise<void>;      // starts installed tunnels without a .stopped marker
  shutdownAll(): Promise<void>;   // stops children without writing markers
  // + every ServiceBackend method
}
```

`test/fake-cloudflared.mjs` (executable via `node`): prints `--version` output; for `tunnel run` prints `INF Starting tunnel`, the value of `TUNNEL_METRICS`, `INF argv=<JSON argv>` and `INF token-present=<bool>`, then stays alive; exits with code 1 after 50 ms when `FAKE_CF_CRASH=1` is in its environment file; ignores SIGTERM when `FAKE_CF_IGNORE_TERM=1`.

Tests (each with its own temp `etcDir`, `restartDelayMs: 50`, `stopGraceMs: 200`, bin = the fake script run through a small shell wrapper `#!/bin/sh\nexec node <path> "$@"` written to the temp dir):
1. install + start → `status().state === 'active'`, `activeSince` set; logs contain `Starting tunnel`.
2. token is passed through env only: logs contain `token-present=true` and the argv line does not contain the token.
3. crash → restarts after delay, `restarts` increments, state returns to `active`/`activating`.
4. stop → `inactive`, `.stopped` marker exists, no restart after 3× delay.
5. `startAll` starts only tunnels without marker.
6. `shutdownAll` leaves no marker; a new backend's `startAll` starts the tunnel again.
7. SIGKILL after grace period when the child ignores SIGTERM.
8. missing binary → `failed`, retried after delay (no tight loop: at most 3 spawn attempts in 150 ms).
9. `followLogs` receives new lines; unsubscribe stops delivery; buffer capped at 1,000.
10. `uninstall` twice is fine; `upgradeCloudflared` rejects with `CLOUDFLARED_UPDATE_UNSUPPORTED`; `cloudflaredVersion()` parses the fake version.

- [ ] **Step 1:** Write fixture + failing tests; run → FAIL (module missing).
- [ ] **Step 2:** Implement (core shape):
```ts
interface Child { proc: ChildProcess | null; state: LocalState; since: string | null; restarts: number;
  wanted: boolean; timer: NodeJS.Timeout | null; lines: LogLine[]; listeners: Set<(l: LogLine) => void> }
// start(): wanted = true; rm marker; spawn(bin, ['--no-autoupdate','tunnel','run'], { env: { ...process.env, ...parseEnvFile(file) } })
// on 'exit'/'error': proc = null; if wanted → state 'activating' (or 'failed' on spawn error), schedule spawn after restartDelayMs, restarts++
// stop(): wanted = false; write marker; clear timer; SIGTERM then SIGKILL after stopGraceMs; await exit
```
  Env passed to the child uses the variable names from `renderEnvFile` (`TUNNEL_TOKEN`, `TUNNEL_METRICS`, `TUNNEL_LOGLEVEL`, `TUNNEL_TRANSPORT_PROTOCOL`), read with a raw key/value parse of the env file.
- [ ] **Step 3:** Run → PASS; `pnpm --filter @tm/server typecheck`. Commit `feat(server): add a process backend that supervises cloudflared without systemd`.

---

### Task 4: Wiring

**Files:** `apps/server/src/config.ts`, `apps/server/src/http/context.ts`, `apps/server/src/main.ts`; tests in `apps/server/src/config.test.ts`.

- [ ] **Step 1: Failing test:** `loadConfig({ SERVICE_BACKEND: 'process', CLOUDFLARED_BIN: '/usr/local/bin/cloudflared' })` → `serviceBackend: 'process'`, `cloudflaredBin: '/usr/local/bin/cloudflared'`; default `cloudflaredBin` is `cloudflared`.
- [ ] **Step 2:** Implement: `serviceBackend: 'systemd' | 'fake' | 'process'`; `cloudflaredBin`; `createContext` builds `ProcessBackend` for `process`; `main.ts` calls `startAll()` after listen and `shutdownAll()` on SIGTERM/SIGINT when the backend is a `ProcessBackend`.
- [ ] **Step 3:** Run server suite → PASS. Commit `feat(server): select the process backend with SERVICE_BACKEND=process`.

---

### Task 5: Docker image, compose and CI

**Files:** Create `Dockerfile`, `.dockerignore`, `docker-compose.yml`; modify `.github/workflows/ci.yml`, `.github/workflows/release.yml`.

- [ ] **Step 1:** `Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim
ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.9.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini \
 && curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${TARGETARCH}" \
 && chmod 0755 /usr/local/bin/cloudflared && /usr/local/bin/cloudflared --version \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin tunnelmgr \
 && mkdir -p /data && chown tunnelmgr:tunnelmgr /data
COPY --from=build /src/apps/server/dist/server.mjs /app/server.mjs
COPY --from=build /src/apps/web/dist /app/web
ENV NODE_ENV=production SERVICE_BACKEND=process CLOUDFLARED_BIN=/usr/local/bin/cloudflared \
    DATA_DIR=/data ETC_DIR=/data/etc WEB_DIST=/app/web PORT=8080
USER tunnelmgr
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server.mjs"]
```
- [ ] **Step 2:** `.dockerignore` (node_modules, dist, release, .git, .superpowers, test-results, .e2e-data, .data). `docker-compose.yml` with `image: ghcr.io/cocardoso/cloudflared-manager:latest`, `restart: unless-stopped`, `ports: ["8080:8080"]`, `volumes: [cloudflared-manager-data:/data]`.
- [ ] **Step 3: Verify:** `docker build -t cloudflared-manager:dev .` succeeds; `docker run -d -p 18082:8080 cloudflared-manager:dev`; `curl /api/health` → `{"ok":true}`; `docker inspect` health becomes `healthy`; `docker exec … id -u` → `10001`.
- [ ] **Step 4:** CI: add a job step `docker build .` (no push). Release: after the tarball, `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` (GHCR, `${{ github.token }}`, `permissions: packages: write`), `docker/build-push-action` with `platforms: linux/amd64,linux/arm64`, tags `ghcr.io/<owner>/cloudflared-manager:${version without v}` and `:latest`.
- [ ] **Step 5:** Commit `feat: add Docker image, compose example and image publishing`.

---

### Task 6: Proxmox layout under `proxmox/`

**Files:** move `ct/` → `proxmox/ct/`, `install/` → `proxmox/install/`; modify `proxmox/ct/cloudflared-manager.sh`, `scripts/set-repo.sh`, `.github/workflows/ci.yml`.

- [ ] **Step 1:** `git mv ct proxmox/ct && git mv install proxmox/install`.
- [ ] **Step 2:** In the ct script: `export COMMUNITY_SCRIPTS_URL="https://raw.githubusercontent.com/${GH_REPO}/main/proxmox"` and `_CS_DEFAULT_URL` the same.
- [ ] **Step 3:** Update `set-repo.sh` file list and CI shellcheck globs to `proxmox/**/*.sh`.
- [ ] **Step 4:** `shellcheck` clean. Commit `refactor: move Proxmox scripts under proxmox/`.

---

### Task 7: Rename the repository

- [ ] **Step 1:** `gh repo rename cloudflared-manager --repo cocardoso/cloudflared-proxmox --yes`; `git remote set-url origin git@github.com:cocardoso/cloudflared-manager.git`.
- [ ] **Step 2:** `bash scripts/set-repo.sh`-equivalent replacement of `cocardoso/cloudflared-proxmox` → `cocardoso/cloudflared-manager` in scripts and docs (excluding historical plan/spec files); `grep -rn cloudflared-proxmox` over tracked files returns only historical docs.
- [ ] **Step 3:** `gh repo edit --description "Manage Cloudflare Tunnels from a web UI — runs as a Proxmox LXC or a Docker container" --add-topic cloudflare,cloudflare-tunnel,cloudflared,proxmox,lxc,docker,homelab,self-hosted`.
- [ ] **Step 4:** Commit `chore: rename project to cloudflared-manager`.

---

### Task 8: Documentation

**Files:** `README.md`, `docs/manual-test-checklist.md`.

- [ ] README sections: overview + screenshot-free feature list; **Proxmox LXC** (one-liner with new path, defaults, update); **Docker** (`docker run` and Compose, volume, networking note about `127.0.0.1`, update by pulling the image); configuration table (`PORT`, `DATA_DIR`, `ETC_DIR`, `SERVICE_BACKEND`, `CLOUDFLARED_BIN`, `COOKIE_SECURE`, `CF_API_BASE`); keep-alive per target (systemd vs process supervisor, watchdog shared); first access and token permissions; architecture; development; publishing; known limitations.
- [ ] Checklist: add "Docker" section (compose up, health, non-root, token not in `ps`, restart/stop persistence across `docker restart`, image update flow).
- [ ] Commit `docs: document Proxmox and Docker deployments`.

---

### Task 9: Real end-to-end verification and cleanup

- [ ] Build the image locally and run it with Compose; the user connects with the existing token; drive the UI in Chrome: create tunnel, publish `tm-e2e-docker.cloudhub.com.br` → origin container in the same Compose project, check HTTP 200 from the internet, kill the `cloudflared` child (`docker exec … pkill -9 cloudflared`) → recovered, stop → stays stopped across `docker restart`, start, delete. Verify `ps` inside the container shows no token.
- [ ] Regression on the simulated LXC (systemd backend) with the new release tarball: create tunnel + route + public 200 + delete.
- [ ] Verify in the Cloudflare dashboard that no `tm-e2e` tunnels or DNS records remain; remove containers, images, volumes and artifacts.

### Task 10: Finish

- [ ] Full suite, e2e, shellcheck, final whole-branch review, merge to `main`, push, tag `v0.2.0` (publishes tarball and GHCR image), verify the image pulls and runs.
