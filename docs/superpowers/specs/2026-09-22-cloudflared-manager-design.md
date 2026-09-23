# Cloudflared Manager for Proxmox — Design

- **Date:** 2026-09-22
- **Status:** awaiting review
- **Reference:** [community-scripts cloudflared](https://community-scripts.org/scripts/cloudflared) script (`ct/cloudflared.sh` + `install/cloudflared-install.sh`).

## 1. Goal

A community-scripts-style script that creates, on Proxmox, an LXC with `cloudflared` **and** a Cloudflare tunnel management web application. The user configures everything from the browser, closes the page, and the tunnels keep running, with nothing running on the desktop.

### User context and assumptions

- Use case: **personal homelab**, GUI access over the LAN, a single administrator.
- **100% web-based** management, built from scratch.
- Per-tunnel configurable **keep-alive**; the tunnel must recover on its own from a process crash, internet outage, or any other failure.
- Manage, stop, delete, and modify tunnels through the interface.
- Use **multiple domains** (zones) from the Cloudflare account: tunnel A on domain A, tunnel B on domain B (or one tunnel with routes on both).
- Cloudflare authentication with as little friction as possible.
- Interface in **English and Brazilian Portuguese (pt-BR)**.
- Visual identical to the Cloudflare dashboard.

### Decisions made

| Topic | Decision | Reason |
|---|---|---|
| Tunnel model | **Remotely managed** tunnels via the Cloudflare API (`config_src: cloudflare`) | Enables full CRUD for tunnels, routes, and DNS; the model recommended by Cloudflare; keeps the Zero Trust dashboard consistent. |
| Cloudflare authentication | **API Token** created via a link with pre-filled permissions, pasted once and stored encrypted | Cloudflare does not offer OAuth for third-party applications; `cloudflared tunnel login` is limited to a single zone and doesn't allow editing remote configuration; a Global API Key grants full access. |
| Stack | Node.js/TypeScript: **Fastify + React (Vite) + SQLite** | End-to-end TS with shared types; official `cloudflare` SDK for Node. |
| Design system | **Kumo** (`@cloudflare/kumo`), the Cloudflare dashboard's official design system | Same look as the dashboard without manual imitation. |
| GUI access | **Local admin password** (argon2 + session cookie) | Protects the token from other devices on the LAN. |
| i18n | `react-i18next` with `en` and `pt-BR` | User request. |
| Installation | Reuse of the community-scripts `build.func` engine, pointing to our `ct/` and `install/` | Same experience (menus, defaults, update) without maintaining our own engine. |

## 2. Architecture

```
┌──────────────── LXC Debian 13 (unprivileged) ─────────────────────┐
│                                                                   │
│  tunnel-manager.service (Node, user "tunnelmgr", port 8080)       │
│   ├─ HTTP API (Fastify) + statically served React frontend        │
│   ├─ cloudflare/  ────────────────────────► api.cloudflare.com    │
│   ├─ services/    ── restricted sudo ─────► systemctl/journalctl  │
│   ├─ watchdog/    ── every 30s ───────────► 127.0.0.1:<port>/ready│
│   └─ store/       ── SQLite /var/lib/tunnel-manager/data.db       │
│                                                                   │
│  cloudflared@<tunnel-id>.service   (1 unit per tunnel)            │
│   └─ cloudflared tunnel --metrics 127.0.0.1:<port> run            │
│        TUNNEL_TOKEN via /etc/tunnel-manager/tunnels/<id>.env      │
└───────────────────────────────────────────────────────────────────┘
```

### 2.1 Units

- **`cloudflare/`**: thin wrapper over the official `cloudflare` SDK. Responsibilities:
  - verify the token (`/user/tokens/verify`), list accounts and zones;
  - CRUD of `cfd_tunnel` tunnels with `config_src: cloudflare`;
  - read and write the remote configuration (`GET/PUT /accounts/{account}/cfd_tunnel/{id}/configurations`);
  - fetch the tunnel token (`GET .../cfd_tunnel/{id}/token`);
  - CRUD of `<host> → <tunnel-id>.cfargotunnel.com` CNAME records (proxied);
  - read the tunnel's active connections (datacenters, connector version).
  - Translates API errors into domain error codes (section 4).
- **`services/`**: the only module that touches the operating system. Sits behind a `ServiceBackend` interface with two implementations: `systemd` (production) and `fake` (dev/testing, enabled with `SERVICE_BACKEND=fake`).
  - writes `/etc/tunnel-manager/tunnels/<id>.env` (mode 0600, owned by `tunnelmgr`) with `TUNNEL_TOKEN`, `TUNNEL_METRICS`, `TUNNEL_LOGLEVEL`, and `TUNNEL_TRANSPORT_PROTOCOL`;
  - `enable/start/stop/restart/disable` of `cloudflared@<id>` via `sudo systemctl`;
  - unit state (`systemctl show`) and logs (`journalctl -u cloudflared@<id> -o json`, with follow for streaming).
- **`watchdog/`**: a loop every 30 s for each tunnel with keep-alive enabled (see 4.2).
- **`store/`**: SQLite (`better-sqlite3`) with versioned migrations. Tables:
  - `admin` (username, argon2id hash);
  - `settings` (account id, encrypted Cloudflare token, token suffix, default language);
  - `tunnels` (Cloudflare id, metrics port, keep-alive, tolerance in minutes, loglevel, protocol, watchdog state, failure counters);
  - `managed_dns` (DNS record id, zone, hostname, tunnel), used to know which records the application created and can remove;
  - `events` (tunnel, type, message, timestamp), with 30-day retention.
  - The Cloudflare token is encrypted with AES-256-GCM using the key at `/etc/tunnel-manager/secret.key` (generated during installation, mode 0600).
- **`web/`**: React SPA + Kumo + TanStack Query + react-router + react-i18next. Talks only to the HTTP API.
- **`packages/shared/`**: zod schemas and API contract types, used by the server (validation) and the web app (typing).

### 2.2 Source of truth

- **Cloudflare** is the source of truth for tunnels, routes (ingress), and DNS. The GUI always reads from the API; edits made in the Zero Trust dashboard appear in the GUI.
- **SQLite** stores only what is local: admin, token, runtime parameters of the tunnels running on this LXC, managed DNS, and events.
- An account tunnel that isn't yet running on this LXC appears as **"not running here"** and can be **adopted** (the application fetches the tunnel token and creates the unit). Locally-managed tunnels (`config_src: local`) are listed as read-only, with a warning.
- Changing routes **does not restart** `cloudflared`: the remote configuration reaches the connector within a few seconds.

## 3. Screens and flows

### 3.1 Initial setup (wizard, first access only)

1. Create the admin username and password (password with a minimum of 12 characters).
2. Connect to Cloudflare: the **"Create token on Cloudflare"** button opens `https://dash.cloudflare.com/profile/api-tokens` with a pre-filled name and permissions:
   - Account → Cloudflare Tunnel → Edit
   - Zone → DNS → Edit
   - Zone → Zone → Read
   - Resources: all zones in the account.
   The user pastes the token; the application validates it, detects the account(s) (a selector if there's more than one), and lists the zones found. If a permission is missing, it shows which one.
3. Redirects to the Dashboard.

> The exact format of the pre-filled link (query parameters accepted by the dashboard) will be confirmed during implementation. If the dashboard doesn't support pre-filling, the screen shows the permissions with step-by-step instructions and a copy button.

### 3.2 Dashboard

- Summary cards: healthy / degraded / stopped / failing tunnels, total routes, latest watchdog events.
- Tunnel list showing:
  - **local** status (unit: active, stopped, failing);
  - **edge** status (number of connections and datacenters, e.g., GRU, EZE);
  - uptime and keep-alive on/off.
- Primary action: **Create tunnel**.

### 3.3 Create tunnel

Name → the application creates the remote tunnel, fetches the token, allocates the metrics port, writes the `.env`, and enables and starts the unit. The next step, optional, is adding the first route.

### 3.4 Tunnel detail (tabs)

- **Routes**: hostname → service table. Form with:
  - **domain** selector (account zones) + subdomain + optional path;
  - service: `http://`, `https://`, `tcp://`, `ssh://`, `rdp://`, `unix:`, `http_status:`;
  - advanced (`originRequest`): `noTLSVerify`, `httpHostHeader`, `originServerName`, `connectTimeout`, `keepAliveTimeout`;
  - **Test origin** button (TCP/HTTP connection made from the LXC).
  - Rule reordering (order matters in ingress); the `http_status:404` catch-all is always kept last and is not editable.
- **Status**: active connections per datacenter, `cloudflared` version, a chart (ECharts via Kumo) of requests and errors extracted from `/metrics` (sampling kept in memory, 1 h window).
- **Logs**: live stream of `journalctl` via SSE, with level filter and pause.
- **Events**: history of restarts, crashes, recoveries, and configuration changes.
- **Settings**: rename; keep-alive on/off; tolerance before restart (default 2 min); loglevel; protocol (`auto`/`quic`/`http2`).
- **Danger zone**: **Stop**, **Restart**, **Delete**. Delete removes the routes, the DNS entries in `managed_dns`, the tunnel on Cloudflare, the unit, and the `.env`; requires typing the tunnel name.

### 3.5 General settings

- Change the admin password.
- Change or revalidate the Cloudflare token (shown only as `••••abcd`).
- Language (en / pt-BR; the default comes from the browser) and theme (light / dark / system).
- Installed `cloudflared` version vs. the latest available, with an **Update** button (`apt-get install --only-upgrade cloudflared` via sudoers, followed by a restart of the tunnels).
- Export and import backup (JSON with local tunnel parameters and `managed_dns`; the token is not exported).

### 3.6 Out of scope (for now)

Multi-user support, Cloudflare Access, WARP/private networks, external notifications (Telegram, email), languages other than en/pt-BR. The architecture doesn't prevent adding them later.

## 4. Data flow, errors, and resilience

### 4.1 Adding or editing a route

1. UI: `POST /api/tunnels/:id/routes` (or `PUT .../routes/:index`).
2. The server reads the tunnel's current configuration on Cloudflare, applies the change while keeping the catch-all last, and does a `PUT` of the configuration.
3. Creates or updates the `host → <id>.cfargotunnel.com` CNAME (proxied) and records the entry in `managed_dns`.
   - If a record for the host already exists pointing to a **different destination**, the operation is aborted before step 2 with `DNS_CONFLICT`; the UI asks whether to overwrite it and resends with `overwrite: true`.
4. If step 3 fails, the server **rolls back** the ingress to the version read in step 2 and returns the error. The state is never left partially applied.

Removing a route: removes it from the ingress and, if the record is in `managed_dns`, removes the CNAME (with UI confirmation).

### 4.2 Watchdog and keep-alive

Three layers of recovery:

1. **cloudflared**: maintains 4 connections to the edge and reconnects on its own when the network drops.
2. **systemd**: `Restart=always`, `RestartSec=5`, units `enabled`, so they come up on boot.
3. **watchdog** (tunnels with keep-alive enabled only), per-tunnel state machine:
   - `healthy`: unit active and `/ready` returns 200.
   - `degraded`: the check failed; logs an event; waits for the configured tolerance.
   - `restarting`: tolerance exceeded → `systemctl restart`, with exponential backoff from 30 s up to 10 min between attempts.
   - `failing`: 5 consecutive restarts without returning to `healthy`; the watchdog stops restarting and the UI shows an alert with a "try again" action.
   - Returning to `healthy` resets the counters.
   - Without internet, `/ready` fails for all tunnels; if the `api.cloudflare.com` host is also unreachable, the watchdog logs "no connectivity" and **does not** count restarts (restarting won't help).

With keep-alive disabled, the tunnel still has layers 1 and 2; only the watchdog doesn't act.

### 4.3 Errors

- Single format: `{ code, message, details? }` with a consistent HTTP status.
- Domain error codes, for example: `CF_UNREACHABLE`, `CF_TOKEN_INVALID`, `CF_PERMISSION_MISSING` (with the missing permission in `details`), `CF_RATE_LIMITED`, `DNS_CONFLICT`, `TUNNEL_NOT_FOUND`, `SERVICE_COMMAND_FAILED`, `VALIDATION_ERROR`.
- The UI translates the `code` (en/pt-BR) and suggests the corresponding action.

### 4.4 Degraded situations

- **No internet**: local status, logs, and events keep working; actions that depend on the API show "Cloudflare unreachable".
- **Revoked or expired token**: the tunnels keep running (each uses its own tunnel token); the GUI enters "reconnect" mode and blocks only the API-dependent actions.
- **LXC reboot**: units and GUI come up on their own; the tunnels don't depend on the GUI.

### 4.5 Security

- Session in an `httpOnly` cookie, `SameSite=Strict`, 7-day expiration; rate limit on login (5 attempts/min per IP).
- Cloudflare token encrypted at rest; never returned to the UI (only the last 4 characters).
- `tunnelmgr` is a shell-less user; sudoers only allows:
  - `systemctl start|stop|restart|enable|disable|show cloudflared@*`
  - `journalctl -u cloudflared@*`
  - `apt-get install --only-upgrade -y cloudflared`
- zod validation on all API inputs; the tunnel id is validated as a UUID before becoming a unit or file name.

## 5. Installation on Proxmox

In the Proxmox host shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/<owner>/cloudflared-proxmox/main/ct/cloudflared-manager.sh)"
```

### 5.1 `ct/cloudflared-manager.sh` (runs on the host)

- Sets `_CS_DEFAULT_URL` pointing to our repository's raw content and `source`s the `build.func` from `community-scripts/core` **pinned to a commit** (via `COMMUNITY_SCRIPTS_CORE_URL`).
- Defaults: Debian 13, 1 vCPU, 1024 MB RAM, 4 GB disk, unprivileged, `var_arm64=yes`, tags `network;cloudflare`. All adjustable through the `build.func` menus.
- `update_script()`: `apt` upgrade (includes `cloudflared`) + download of the manager's latest release, atomic swap of the application directory, migrations, and restart of `tunnel-manager.service`. The tunnels are not restarted by the manager update.

### 5.2 `install/cloudflared-manager-install.sh` (runs on the LXC)

1. Cloudflare apt repository + `cloudflared` (same as the community script).
2. Node.js 22 LTS.
3. `tunnelmgr` user; directories `/opt/tunnel-manager`, `/var/lib/tunnel-manager`, `/etc/tunnel-manager/tunnels`.
4. Random `secret.key` (0600).
5. `/etc/sudoers.d/tunnel-manager`, `cloudflared@.service`, and `tunnel-manager.service` (copied from `deploy/`).
6. Download of the tarball from the latest GitHub Release **matching the container's architecture** (`linux-x64` or `linux-arm64`) into `/opt/tunnel-manager`. The tarball already includes production `node_modules` with the native modules (`better-sqlite3`, `argon2`) compiled in CI, so nothing is compiled inside the container.
7. `systemctl enable --now tunnel-manager`; final message with `http://<ip>:8080`.

### 5.3 Tunnel unit template

```ini
# /etc/systemd/system/cloudflared@.service
[Unit]
Description=Cloudflare Tunnel %i
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/tunnel-manager/tunnels/%i.env
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=always
RestartSec=5
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

(`cloudflared` reads `TUNNEL_TOKEN`, `TUNNEL_METRICS`, `TUNNEL_LOGLEVEL`, and `TUNNEL_TRANSPORT_PROTOCOL` from environment variables.)

## 6. Repository structure

```
ct/cloudflared-manager.sh
install/cloudflared-manager-install.sh
packages/shared/          # schemas zod + tipos do contrato da API
apps/server/              # Fastify: cloudflare/, services/, watchdog/, store/, routes/
apps/web/                 # React + Kumo + i18n (en, pt-BR)
deploy/                   # cloudflared@.service, tunnel-manager.service, sudoers
.github/workflows/        # CI (lint, testes, shellcheck) + release (tarballs linux-x64 e linux-arm64 no GitHub Release)
docs/
```

pnpm monorepo.

## 7. Tests

- **Server** (Vitest):
  - `cloudflare/` against an HTTP mock (`msw`): error translation, pagination, missing permissions.
  - Route flow: insertion before the catch-all, DNS conflict, ingress rollback when DNS fails.
  - Watchdog: state machine with a fake clock (backoff, limit of 5, no-connectivity doesn't count as a restart).
  - `services/` tested through the `fake` implementation; the `systemd` implementation has command-construction tests (without executing them).
  - Token encryption (round-trip, wrong key fails).
- **Web** (Vitest + Testing Library): route form, setup wizard, language switching.
- **E2E** (Playwright): setup → create tunnel → add route → delete tunnel, with the server in `SERVICE_BACKEND=fake` and Cloudflare mocked.
- **Scripts**: `shellcheck` in CI; real manual test on Proxmox following a checklist in `docs/`.
- **Local dev on macOS**: `SERVICE_BACKEND=fake` allows running the complete application without Linux/systemd.

## 8. Risks and points to confirm during implementation

- Pre-fill parameters for the token creation link on the Cloudflare dashboard (fallback described in 3.1).
- Exact endpoint and format of the tunnel's active connections in the API (`/cfd_tunnel/{id}/connections`).
- Compatibility of `DynamicUser=yes` with an `EnvironmentFile` owned by `tunnelmgr` on an unprivileged LXC (the `EnvironmentFile` is read by systemd as root, so it should work; validate during the manual test).
- `cloudflared` warnings on an unprivileged LXC (QUIC UDP buffers, `ping_group_range` for ICMP proxying): document them, they don't block functionality.
- Stability of the Kumo API (new library); pin the version.
