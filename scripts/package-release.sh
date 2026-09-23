#!/usr/bin/env bash
# Builds the single, architecture-independent release tarball.
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
# Files must belong to root once extracted, never to the build machine's uid.
if tar --version 2>/dev/null | grep -q "GNU tar"; then
  OWNER_FLAGS=(--owner=0 --group=0 --numeric-owner)
else
  OWNER_FLAGS=(--uid 0 --gid 0 --uname root --gname root)
fi
tar "${OWNER_FLAGS[@]}" -czf "$OUT/cloudflared-manager-${VERSION}.tar.gz" -C "$OUT" "cloudflared-manager-${VERSION}"
# Installers verify the tarball against this file before extracting it.
if command -v sha256sum >/dev/null; then SHA256=(sha256sum); else SHA256=(shasum -a 256); fi
(cd "$OUT" && "${SHA256[@]}" "cloudflared-manager-${VERSION}.tar.gz" >"cloudflared-manager-${VERSION}.tar.gz.sha256")
echo "$OUT/cloudflared-manager-${VERSION}.tar.gz"
