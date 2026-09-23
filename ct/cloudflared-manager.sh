#!/usr/bin/env bash
# Compatibility entry point: LXCs installed from v0.1.0 run `update`, which fetches
# <repo>/main/ct/cloudflared-manager.sh. The real script now lives under proxmox/.
exec bash -c "$(curl -fsSL "https://raw.githubusercontent.com/${TM_GH_REPO:-cocardoso/cloudflared-manager}/main/proxmox/ct/cloudflared-manager.sh")"
