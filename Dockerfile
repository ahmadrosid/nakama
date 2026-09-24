# Nakama — one container: API, web dashboard, automation + task workers
# Build & run: ./scripts/docker-build-run.sh

# --- Build architecture-independent web and JavaScript bundles once ---
FROM --platform=$BUILDPLATFORM oven/bun:1.4-slim AS web-builder
WORKDIR /app

COPY package.json bun.lock ./
COPY patches/@electron%2Fosx-sign@1.3.3.patch patches/
COPY apps apps
COPY packages packages

RUN bun install --frozen-lockfile --ignore-scripts \
  && bun run --filter @nakama/web build \
  && bun run --filter @nakama/server build \
  && bun run --filter @nakama/automation build \
  && bun run --filter @nakama/telegram build \
  && bun run --filter @nakama/whatsapp build \
  && bun run --filter @nakama/discord build \
  && bun run --filter @nakama/slack build

FROM scratch AS build-assets
COPY --from=web-builder /app/apps/web/dist /app/apps/web/dist
COPY --from=web-builder /app/apps/server/dist /app/apps/server/dist
COPY --from=web-builder /app/apps/platform/automation/dist /app/apps/platform/automation/dist
COPY --from=web-builder /app/apps/platform/telegram/dist /app/apps/platform/telegram/dist
COPY --from=web-builder /app/apps/platform/whatsapp/dist /app/apps/platform/whatsapp/dist
COPY --from=web-builder /app/apps/platform/discord/dist /app/apps/platform/discord/dist
COPY --from=web-builder /app/apps/platform/slack/dist /app/apps/platform/slack/dist

FROM oven/bun:1.4-slim AS runtime-deps
RUN mkdir -p /runtime-deps \
  && printf '{"private":true}\n' > /runtime-deps/package.json \
  && cd /runtime-deps \
  && bun add --exact --production --ignore-scripts \
    pm2@7.0.4 microsandbox@0.6.17 sharp@0.35.4 \
    @vscode/ripgrep@1.18.0 @firecrawl/anydoc@0.1.3

# --- Production runtime (server + workspace packages + built static assets) ---
FROM oven/bun:1.4-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates sudo python3 \
  && rm -rf /var/lib/apt/lists/*

# Optional Google Meet audio-capture runtime. Chromium remains sandboxed and
# runs as the existing non-root Nakama user.
ARG INSTALL_MEET_DEPS=false
RUN if [ "$INSTALL_MEET_DEPS" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        chromium ffmpeg pulseaudio pulseaudio-utils fonts-liberation xvfb \
      && rm -rf /var/lib/apt/lists/* \
      && mkdir -p /opt/nakama-meet \
      && cd /opt/nakama-meet \
      && bun add --exact --production --ignore-scripts betterwright@2.8.1; \
    fi

# Tool-output optimiser, on by default so the dashboard toggle works on a fresh
# image without a rebuild. Just under 10 MB unpacked. Build with
# --build-arg OMNI_VERSION= to leave it out; the server then fetches it on demand
# when the toggle is switched on, unless NAKAMA_OMNI_AUTO_INSTALL=0.
# The release is a static musl build, which runs on this glibc base, and the
# published checksum is verified rather than the download trusted.
ARG OMNI_VERSION="0.7.9"
RUN if [ -n "$OMNI_VERSION" ]; then \
      set -eu; \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; \
      case "$(dpkg --print-architecture)" in \
        amd64) target=x86_64-unknown-linux-musl ;; \
        arm64) target=aarch64-unknown-linux-musl ;; \
        *) echo "no omni build for $(dpkg --print-architecture)" >&2; exit 1 ;; \
      esac; \
      base="https://github.com/fajarhide/omni/releases/download/v${OMNI_VERSION}"; \
      archive="omni-v${OMNI_VERSION}-${target}.tar.gz"; \
      curl -fsSL -o "/tmp/${archive}" "${base}/${archive}"; \
      curl -fsSL -o /tmp/SHA256SUMS "${base}/SHA256SUMS"; \
      (cd /tmp && grep " ${archive}\$" SHA256SUMS | sha256sum -c -); \
      tar -xzf "/tmp/${archive}" -C /usr/local/bin omni; \
      rm -rf "/tmp/${archive}" /tmp/SHA256SUMS /var/lib/apt/lists/*; \
      omni --version; \
    fi

RUN mkdir -p /nakama/data \
  && if getent group 1000 >/dev/null; then \
       G=$(getent group 1000 | cut -d: -f1); \
       [ "$G" = nakama ] || groupmod -n nakama "$G"; \
     else groupadd --system --gid 1000 nakama; fi \
  && if getent passwd nakama >/dev/null; then \
       usermod -d /nakama/data nakama; \
     elif getent passwd 1000 >/dev/null; then \
       U=$(getent passwd 1000 | cut -d: -f1); \
       usermod -l nakama -g nakama -d /nakama/data "$U"; \
     else useradd --system --uid 1000 --gid nakama --home-dir /nakama/data --create-home nakama; fi \
  && chown nakama:nakama /nakama/data

COPY --chown=1000:1000 package.json ./
COPY --chown=1000:1000 apps/server apps/server
COPY --chown=1000:1000 packages packages
COPY --chown=1000:1000 --from=build-assets /app/apps/web/dist apps/web/dist
COPY --chown=1000:1000 --from=build-assets /app/apps/server/dist apps/server/dist
COPY --chown=1000:1000 --from=build-assets /app/apps/platform/automation/dist apps/platform/automation/dist
COPY --chown=1000:1000 --from=build-assets /app/apps/platform/telegram/dist apps/platform/telegram/dist
COPY --chown=1000:1000 --from=build-assets /app/apps/platform/whatsapp/dist apps/platform/whatsapp/dist
COPY --chown=1000:1000 --from=build-assets /app/apps/platform/discord/dist apps/platform/discord/dist
COPY --chown=1000:1000 --from=build-assets /app/apps/platform/slack/dist apps/platform/slack/dist
COPY --chown=1000:1000 --from=runtime-deps /runtime-deps/node_modules node_modules

RUN test -f apps/server/src/services/javascript-tool-runner.js \
  && test -f apps/server/src/services/plugin-runner.js \
  && test -f node_modules/pm2/bin/pm2-runtime

ENV NODE_ENV=production \
    NAKAMA_HOST=0.0.0.0 \
    NAKAMA_PORT=4310 \
    NAKAMA_CONFIG_DIR=/nakama/data \
    DATABASE_URL=file:/nakama/data/sqlite/nakama.sqlite \
    BUN_INSTALL_BIN=/nakama/data/.bun/bin \
    BUN_INSTALL_GLOBAL_DIR=/nakama/data/.bun/install/global

EXPOSE 4310

VOLUME ["/nakama/data"]

USER 1000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:4310/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "apps/server/dist/index.js"]
