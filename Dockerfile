# syntax=docker/dockerfile:1
# Cloudflared Manager — Docker image (process backend: cloudflared runs as supervised child processes).

# The build output is plain JavaScript, so it is produced once on the runner's own architecture
# instead of under emulation for every target platform.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim
ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.10.7
# SHA-256 of the release binaries, as published by Cloudflare (kept in sync by the cloudflared-bump workflow).
ARG CLOUDFLARED_SHA256_AMD64=1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872
ARG CLOUDFLARED_SHA256_ARM64=3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl procps tini \
 && curl -fsSL -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${TARGETARCH}" \
 && case "$TARGETARCH" in \
      amd64) sum="$CLOUDFLARED_SHA256_AMD64" ;; \
      arm64) sum="$CLOUDFLARED_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && echo "$sum  /usr/local/bin/cloudflared" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/cloudflared \
 && /usr/local/bin/cloudflared --version \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin tunnelmgr \
 && mkdir -p /data && chown tunnelmgr:tunnelmgr /data

COPY --from=build /src/apps/server/dist/server.mjs /app/server.mjs
COPY --from=build /src/apps/web/dist /app/web
COPY LICENSE /app/LICENSE

ENV NODE_ENV=production \
    SERVICE_BACKEND=process \
    CLOUDFLARED_BIN=/usr/local/bin/cloudflared \
    DATA_DIR=/data \
    ETC_DIR=/data/etc \
    WEB_DIST=/app/web \
    PORT=8080

USER tunnelmgr
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# tini forwards signals so cloudflared children are stopped cleanly on `docker stop`.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server.mjs"]
