#!/usr/bin/env bash
# Points a fork's install scripts, compose file and README at another repository:
#   scripts/set-repo.sh owner/repo
set -euo pipefail
REPO="${1:?usage: set-repo.sh owner/repo}"
CURRENT="cocardoso/cloudflared-manager"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "invalid repo: $REPO" >&2; exit 1; }
OWNER="${REPO%%/*}"
for f in ct/cloudflared-manager.sh proxmox/ct/cloudflared-manager.sh proxmox/install/cloudflared-manager-install.sh README.md docker-compose.yml; do
  # Image references first, so the repository rename below does not touch them.
  sed -i.bak -e "s#ghcr.io/cocardoso/#ghcr.io/${OWNER}/#g" -e "s#${CURRENT}#${REPO}#g" "$ROOT/$f" && rm -f "$ROOT/$f.bak"
done
echo "Scripts now point to github.com/${REPO} (image ghcr.io/${OWNER}/cloudflared-manager)"
