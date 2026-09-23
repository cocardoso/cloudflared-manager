# Cloudflared Manager

A web UI to create and run **Cloudflare Tunnels** in your homelab. Deploy it as a **Proxmox LXC** (one command, [community-scripts](https://community-scripts.org/scripts/cloudflared) style) or as a **Docker container**. Configure everything from the browser, close the page, and your tunnels stay connected — nothing runs on your desktop.

- Create, stop, restart, edit and delete tunnels (remotely managed through the Cloudflare API).
- Publish services from your network under **any domain in your account** (`app.domain-a.com`, `git.domain-b.dev`…), with automatic CNAME creation and removal and DNS-conflict protection.
- Per-tunnel **keep-alive**: tunnels recover on their own from crashes, hangs, internet outages and reboots.
- Live logs, event history, edge connections and a traffic chart.
- UI in **English and Portuguese (Brazil)**, light and dark themes, built with the Cloudflare dashboard design system ([Kumo](https://www.npmjs.com/package/@cloudflare/kumo)).

## Choose how to run it

| | Proxmox LXC | Docker |
|---|---|---|
| Install | One command on the Proxmox host | `docker compose up -d` |
| Tunnels run as | systemd units (`cloudflared@<id>.service`) | supervised child processes inside the container |
| Updating cloudflared | From the Settings page (apt) | Pull a newer image |
| Privileges | Unprivileged LXC; the UI runs as `tunnelmgr` with a narrow sudoers policy | Non-root user (uid 10001), no `--privileged` |

### Proxmox LXC

In the Proxmox **host** shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/cocardoso/cloudflared-manager/main/proxmox/ct/cloudflared-manager.sh)"
```

Container defaults (adjustable in the installer menus): Debian 13, 1 vCPU, 1 GB RAM, 4 GB disk, unprivileged, x86-64 and ARM64. When it finishes, the installer prints the UI address: `http://<lxc-ip>:8080`.

**Update:** run the same command **inside the LXC** (or `update`, if the shortcut was installed). It updates the OS, `cloudflared` and the UI; tunnels keep running while the UI restarts.

### Docker

With Compose (see [`docker-compose.yml`](docker-compose.yml)):

```bash
curl -fsSLO https://raw.githubusercontent.com/cocardoso/cloudflared-manager/main/docker-compose.yml
docker compose up -d
```

Or directly:

```bash
docker run -d --name cloudflared-manager --restart unless-stopped \
  -p 8080:8080 -v cloudflared-manager-data:/data \
  ghcr.io/cocardoso/cloudflared-manager:latest
```

The UI is at `http://<docker-host>:8080`. All state (database, encryption key, tunnel credentials) lives in the `/data` volume — back it up and keep it private.

The container runs as uid `10001`. Named volumes (as above) get the right owner automatically; for a bind mount, create the directory first and hand it over: `mkdir -p ./data && sudo chown 10001:10001 ./data`, then use `-v ./data:/data`.

**Networking:** inside the container `127.0.0.1` is the container itself. Point routes at LAN addresses (`http://192.168.1.10:8123`), at another Compose service by name (`http://homeassistant:8123`), or at the Docker host (`http://host.docker.internal:8080` on Docker Desktop, the host's LAN IP on Linux). On Linux you can also use `network_mode: host` (commented out in the compose file) so `127.0.0.1` means the host.

**Update:** `docker compose pull && docker compose up -d`. Tunnels are restarted with the new image and come back automatically; tunnels you stopped stay stopped. `cloudflared` is bundled in the image: a scheduled workflow opens a pull request whenever Cloudflare ships a new version, and the next release carries it.

Images are multi-arch (`linux/amd64`, `linux/arm64`) and tagged `latest`, `<major>.<minor>` and `<version>`.

## First access

1. **Create the admin** (password with at least 12 characters).
2. **Connect Cloudflare**: click **Create token in Cloudflare**. The dashboard opens with the permissions already filled in; confirm, copy the token and paste it. You only do this once. Permissions used:
   - Account → Cloudflare Tunnel → Edit
   - Zone → DNS → Edit
   - Zone → Zone → Read
   - Account and zone resources: all

   If the token can access several accounts, the UI asks you to pick one.

The token is stored encrypted (AES-256-GCM) and is never sent back to the browser. Each tunnel's own token is kept in a `0600` file and passed to `cloudflared` through its environment, never on the command line.

## How keep-alive works

1. `cloudflared` keeps 4 connections to the Cloudflare edge and reconnects by itself when the network drops.
2. The process is supervised: by systemd (`Restart=always`) on Proxmox, by the app itself in Docker (restart 5 s after any exit). Both start tunnels at boot, except the ones you stopped.
3. A **watchdog** checks each tunnel's `/ready` endpoint every 30 s. If a tunnel stays unhealthy longer than its tolerance (default 2 min) — for example a hung process — it restarts it with exponential backoff (30 s → 10 min). After 5 failed attempts it gives up and shows an alert, and it clears on its own when the tunnel recovers. Without internet access it restarts **nothing** and waits for the network to return.

## Configuration

Environment variables (the Proxmox unit and the Docker image already set sensible values):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port of the UI/API |
| `HOST` | `0.0.0.0` | Listen address |
| `DATA_DIR` | `/var/lib/tunnel-manager` (Docker: `/data`) | SQLite database |
| `ETC_DIR` | `/etc/tunnel-manager` (Docker: `/data/etc`) | Encryption key and per-tunnel env files |
| `SERVICE_BACKEND` | `systemd` (Docker: `process`) | `systemd`, `process` or `fake` (development) |
| `CLOUDFLARED_BIN` | `cloudflared` | Binary used by the `process` backend |
| `COOKIE_SECURE` | `false` | Set `true` when the UI is served over HTTPS |
| `WEB_DIST` | bundled | Directory of the built web UI |
| `CF_API_BASE` | Cloudflare API | Override for testing against a fake API |

## Development

Requirements: Node 22.13+ (production uses Node 24) and pnpm 9.

```bash
pnpm install
pnpm dev:fake-cf                              # fake Cloudflare API at http://127.0.0.1:18787 (token: fake-token-0123456789abcdefghij)
CF_API_BASE=http://127.0.0.1:18787 pnpm dev   # server (simulated backend) + web at http://localhost:5173
```

Omit `CF_API_BASE` to use the real API. The `fake` backend (the `pnpm dev` default) simulates systemd, so it runs on macOS.

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (server, web, shared) |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm e2e` | Full browser flow (Playwright) against the fake Cloudflare API |
| `docker build -t cloudflared-manager:dev .` | Builds the Docker image locally |
| `bash scripts/package-release.sh v0.2.0` | Builds the Proxmox release tarball into `release/` |
| `bash scripts/set-repo.sh owner/repo` | Points the scripts, compose file and README at a fork |

### Releasing

`git tag vX.Y.Z && git push --tags` runs the `release` workflow: after the tests pass it publishes the Proxmox tarball as a GitHub Release (downloaded by the installer) and pushes the multi-arch image to `ghcr.io/cocardoso/cloudflared-manager`.

The first time an image is pushed, GitHub creates the package as **private**; make it public once under *Package settings → Change visibility* so anonymous `docker pull` works.

## Layout

```
proxmox/ct/         script that runs on the Proxmox host (creates the LXC)
proxmox/install/    script that runs inside the LXC
deploy/             systemd units and sudoers shipped in the release tarball
Dockerfile          Docker image (process backend)
docker-compose.yml  Compose example
packages/shared/    zod schemas and API types
apps/server/        Fastify: Cloudflare API, service backends, watchdog, SQLite
apps/web/           React + Kumo + i18n (en, pt-BR)
e2e/                Playwright tests
docs/               designs, plans and the manual test checklist
```

## Known limitations

- In an unprivileged LXC or a container, `cloudflared` may log warnings about QUIC UDP buffers and `ping_group_range` (ICMP proxy). They do not affect operation; you can force the `http2` protocol in the tunnel settings.
- Tunnels configured with a local `config.yml` are shown read-only.
- A single admin user.
