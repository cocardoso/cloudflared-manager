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
tar -czf "$OUT/cloudflared-manager-${VERSION}.tar.gz" -C "$OUT" "cloudflared-manager-${VERSION}"
echo "$OUT/cloudflared-manager-${VERSION}.tar.gz"
