# Cloudflared Manager for Proxmox

A [community-scripts](https://community-scripts.org/scripts/cloudflared)-style script that creates a Proxmox LXC with `cloudflared` **and** a web UI to manage Cloudflare Tunnels. Configure everything from the browser, close the page, and your tunnels stay connected — nothing runs on your desktop.

- Create, stop, restart, edit and delete tunnels (remotely managed through the Cloudflare API).
- Publish services from your network under **any domain in your account** (`app.domain-a.com`, `git.domain-b.dev`…), with automatic CNAME creation and removal.
- Per-tunnel **keep-alive**: a tunnel recovers on its own from process crashes, internet outages and reboots.
- Live logs, event history, edge connections and a traffic chart.
- UI in **English and Portuguese (Brazil)**, built with the Cloudflare dashboard design system ([Kumo](https://www.npmjs.com/package/@cloudflare/kumo)).

## Installation

In the Proxmox **host** shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/cocardoso/cloudflared-manager/main/ct/cloudflared-manager.sh)"
```

Container defaults (adjustable in the installer menus): Debian 13, 1 vCPU, 1 GB RAM, 4 GB disk, unprivileged, x86-64 and ARM64.

When it finishes, the installer prints the UI address: `http://<lxc-ip>:8080`.

## First access

1. **Create the admin** (password with at least 12 characters).
2. **Connect Cloudflare**: click **Create token in Cloudflare**. The dashboard opens with the permissions already filled in; confirm, copy the token and paste it. You only do this once. Permissions used:
   - Account → Cloudflare Tunnel → Edit
   - Zone → DNS → Edit
   - Zone → Zone → Read
   - Zone resources: all zones

   If the token can access several accounts, the UI asks you to pick one.

The token is stored encrypted (AES-256-GCM) inside the LXC and is never sent back to the browser.

## How keep-alive works

There are three layers:

1. `cloudflared` keeps 4 connections to the Cloudflare edge and reconnects by itself when the network drops.
2. Each tunnel is a systemd unit (`cloudflared@<id>.service`) with `Restart=always`, enabled at boot.
3. A **watchdog** checks each tunnel's `/ready` endpoint every 30 s. If a tunnel stays unhealthy longer than its tolerance (default 2 min), it restarts the unit with exponential backoff (30 s → 10 min). After 5 failed attempts it gives up and shows an alert, and it recovers automatically when the tunnel comes back. Without internet access it restarts **nothing** — it just waits for the network to return.

## Updating

Run the same installation command **inside the LXC** (or `update`, if community-scripts installed the shortcut). It updates the OS, `cloudflared` and the UI. Tunnels keep running while the UI is updated. `cloudflared` can also be updated from the Settings page.

## Development

Requirements: Node 22.13+ (production uses Node 24) and pnpm 9.

```bash
pnpm install
pnpm dev:fake-cf   # fake Cloudflare API at http://127.0.0.1:18787 (token: fake-token-0123456789abcdefghij)
CF_API_BASE=http://127.0.0.1:18787 pnpm dev   # server (simulated systemd backend) + web at http://localhost:5173
```

To use the real API, omit `CF_API_BASE`. The `SERVICE_BACKEND=fake` backend (the `pnpm dev` default) simulates systemd, so it runs on macOS.

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (server, web, shared) |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm e2e` | Full browser flow (Playwright) against the fake Cloudflare API |
| `bash scripts/package-release.sh v0.1.0` | Builds the release tarball into `release/` |
| `bash scripts/set-repo.sh owner/repo` | Points the Proxmox scripts at your GitHub repository |

### Publishing

1. `bash scripts/set-repo.sh <owner>/<repo>` and commit (already done for `cocardoso/cloudflared-manager`).
2. `git tag v0.1.0 && git push --tags`: the `release` workflow builds the tarball and creates the GitHub Release the installer downloads.

## Layout

```
ct/                 script that runs on the Proxmox host (creates the LXC)
install/            script that runs inside the LXC
deploy/             systemd units and sudoers
packages/shared/    zod schemas and API types
apps/server/        Fastify: Cloudflare API, systemd, watchdog, SQLite
apps/web/           React + Kumo + i18n (en, pt-BR)
e2e/                Playwright tests
docs/               spec, plan and manual test checklist
```

## Known limitations

- In an unprivileged LXC, `cloudflared` may log warnings about QUIC UDP buffers and `ping_group_range` (ICMP proxy). They do not affect operation; if you prefer, force the `http2` protocol in the tunnel settings.
- Tunnels configured with a local `config.yml` are shown read-only.
- A single admin user.
