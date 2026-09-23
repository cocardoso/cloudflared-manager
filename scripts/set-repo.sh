#!/usr/bin/env bash
# Points the Proxmox scripts at your GitHub repository: scripts/set-repo.sh owner/repo
set -euo pipefail
REPO="${1:?usage: set-repo.sh owner/repo}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "invalid repo: $REPO" >&2; exit 1; }
for f in "$ROOT/ct/cloudflared-manager.sh" "$ROOT/install/cloudflared-manager-install.sh" "$ROOT/README.md"; do
  [[ -f "$f" ]] && sed -i.bak "s#__GH_REPO__#${REPO}#g" "$f" && rm -f "$f.bak"
done
echo "Scripts now point to github.com/${REPO}"
