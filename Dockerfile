# syntax=docker/dockerfile:1
# Cloudflared Manager — Docker image (process backend: cloudflared runs as supervised child processes).

FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim
ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.9.1
# SHA-256 of the release binaries, as published by Cloudflare (kept in sync by the cloudflared-bump workflow).
ARG CLOUDFLARED_SHA256_AMD64=03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc
ARG CLOUDFLARED_SHA256_ARM64=3d97437c71848bd8df68041e12436b484a661d95073ea1937f01a845ce88faa3
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
