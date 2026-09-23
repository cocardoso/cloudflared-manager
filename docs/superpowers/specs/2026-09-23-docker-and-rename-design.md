# Docker distribution, repository rename and light theme — Design

- **Date:** 2026-09-23
- **Status:** approved
- **Builds on:** `2026-09-22-cloudflared-manager-design.md`

## 1. Goal

Make the repository the single home for running Cloudflared Manager either as a **Proxmox LXC** (existing path) or as a **Docker container** (new path), rename it to reflect that, refresh all documentation, and make the light theme the default.

## 2. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Name | Repository `cocardoso/cloudflared-manager` (renamed from `cloudflared-proxmox`) | The app is already called Cloudflared Manager; the old name only described one of two targets. GitHub redirects the old URL. |
| Docker runtime | New `process` service backend: the app spawns and supervises each `cloudflared` as a child process | Plain container: no systemd, no sudo, no `--privileged`, runs as a non-root user and on NAS devices. |
| cloudflared updates in Docker | Delivered by a new image; the UI explains this instead of offering the in-place update | A container should be immutable; `apt` is not available to a non-root user. |
| Image registry | `ghcr.io/cocardoso/cloudflared-manager`, multi-arch (amd64, arm64), published on every `v*` tag | Same release cadence as the Proxmox tarball. |
| Default theme | Light; dark and system remain selectable | User request. |

## 3. `ProcessBackend` (`SERVICE_BACKEND=process`)

Implements the existing `ServiceBackend` interface.

- **Files:** reuses `${ETC_DIR}/tunnels/<uuid>.env` (0600) written by `writeEnvFile`. `isInstalled(id)` means the env file exists. A marker `${ETC_DIR}/tunnels/<uuid>.stopped` records that the user stopped the tunnel.
- **start(id):** removes the `.stopped` marker, spawns `cloudflared --no-autoupdate tunnel run` (binary from `CLOUDFLARED_BIN`, default `cloudflared`) with the env file's variables merged into the child environment. The token is never passed on the command line.
- **Supervision:** when a child exits and the tunnel was not stopped on purpose, it is restarted after `RESTART_DELAY_MS` (5 s), and the restart counter increments. While waiting, state is `activating`; if spawning fails (e.g. binary missing), state is `failed`.
- **stop(id):** writes the `.stopped` marker, sends SIGTERM, then SIGKILL after 10 s; state `inactive`.
- **restart(id):** stop without writing the marker, then start.
- **install(id, env):** writes the env file (no process started — the service layer calls `start`). **updateEnv** rewrites it. **uninstall(id):** stop, remove env file and marker. Idempotent.
- **status(id):** `not-installed` without env file; `active` with `activeSince` while the child runs; `activating` during the restart delay; `failed` after a spawn error; otherwise `inactive`.
- **logs / followLogs:** stdout and stderr are split into lines, parsed into `LogLine` (level from the `DBG/INF/WRN/ERR/FTL` tag, time = now) and kept in a 1,000-line ring buffer per tunnel; listeners receive new lines.
- **Boot:** `startAll()` (called from `main.ts` for this backend) starts every installed tunnel without a `.stopped` marker.
- **Shutdown:** `shutdownAll()` stops children without writing markers so they come back on the next boot.
- **cloudflaredVersion():** runs `<bin> --version`. **upgradeCloudflared():** throws `CLOUDFLARED_UPDATE_UNSUPPORTED` (new error code).
- **Capabilities:** `ServiceBackend.canSelfUpdate: boolean` (`systemd: true`, `process: false`, `fake: true`). `GET /api/system/cloudflared` adds `canSelfUpdate`; the Settings page shows an "update the container image" hint when it is false, and the dashboard banner links to the same hint.

The watchdog is unchanged: it probes `127.0.0.1:<metricsPort>/ready`, which works inside the container.

## 4. Docker image

- `Dockerfile` (repository root), multi-stage:
  - **build:** `node:24-bookworm-slim` + pnpm → `pnpm build`, then copy `apps/server/dist/server.mjs` and `apps/web/dist`.
  - **runtime:** `node:24-bookworm-slim`, `cloudflared` downloaded from the official GitHub release for `TARGETARCH` at a pinned `CLOUDFLARED_VERSION` build arg, non-root user `tunnelmgr` (uid 10001), `ca-certificates` + `tini` as init.
  - Env: `NODE_ENV=production`, `SERVICE_BACKEND=process`, `DATA_DIR=/data`, `ETC_DIR=/data/etc`, `WEB_DIST=/app/web`, `PORT=8080`.
  - `VOLUME /data`, `EXPOSE 8080`, `HEALTHCHECK` on `/api/health`.
- `docker-compose.yml` example: image from GHCR, `restart: unless-stopped`, port `8080:8080`, named volume `cloudflared-manager-data:/data`.
- Networking note (README): inside the container `127.0.0.1` is the container itself; point routes at LAN IPs, the Docker host (`host.docker.internal` / host IP) or Compose service names. `network_mode: host` is documented as an option on Linux.

## 5. Repository layout and rename

```
proxmox/ct/cloudflared-manager.sh          # runs on the Proxmox host
proxmox/install/cloudflared-manager-install.sh
deploy/                                    # systemd units + sudoers (shipped in the release tarball)
Dockerfile, docker-compose.yml, .dockerignore
apps/ packages/ e2e/ docs/ scripts/
```

- `proxmox/ct/cloudflared-manager.sh` sets `COMMUNITY_SCRIPTS_URL` to `https://raw.githubusercontent.com/<repo>/main/proxmox`, so the engine resolves `install/cloudflared-manager-install.sh` under `proxmox/`.
- `gh repo rename cloudflared-manager`, update the git remote, the repository description and topics, `scripts/set-repo.sh` targets, and every URL in docs and scripts.

## 6. Light theme default

`getStoredTheme()` returns `light` when nothing is stored.

## 7. Documentation

- `README.md`: overview, feature list, **Proxmox LXC** quick start, **Docker / Compose** quick start, configuration (environment variables), how keep-alive works per target, updating per target, architecture, development, known limitations.
- `docs/manual-test-checklist.md`: add a Docker section.
- GitHub: description and topics mention Proxmox, LXC, Docker, Cloudflare Tunnel.

## 8. Testing

- Unit tests for `ProcessBackend` with a fake `cloudflared` script: start/status, env reaches the child and token is not in argv, automatic restart after crash with counter, intentional stop is not restarted, `startAll` skips stopped tunnels, log parsing and streaming, uninstall idempotence, update unsupported.
- API test: `canSelfUpdate` exposed; update endpoint returns `CLOUDFLARED_UPDATE_UNSUPPORTED` for the process backend.
- Web test: Settings shows the image-update hint when `canSelfUpdate` is false; theme defaults to light.
- CI builds the Docker image (no push) on every push.
- Manual end-to-end with the real Cloudflare account on the Docker image (and a regression pass on the simulated LXC), cleaning up every test resource afterwards.
