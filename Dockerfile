# Nakama — one container: API, web dashboard, automation + task workers
# Build & run: ./scripts/docker-build-run.sh

# Keep image references literal so Dependabot can update all three pins.
# Use patch-version tags so new Bun patches produce version updates.
# Verify each proposed multi-arch digest with: docker buildx imagetools inspect <image>

# --- Build architecture-independent web and JavaScript bundles once ---
FROM --platform=$BUILDPLATFORM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS web-builder
WORKDIR /app

COPY package.json bun.lock ./
# The frozen install needs every patch package.json lists.
COPY patches patches
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

# Production runtime dependencies are installed from a committed manifest and
# lockfile. Re-resolving version ranges at image build time let two builds of
# the same commit ship different transitive bytes, so the lockfile is the input.
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS runtime-deps
WORKDIR /runtime-deps

# The Codex and Claude Code binaries are about 670 MB, half the image. The
# default image drops them; the -full tag keeps them. Without them, the ACP
# agents use CODEX_PATH / CLAUDE_CODE_EXECUTABLE.
ARG INSTALL_CODING_AGENTS=false
COPY .docker/runtime-deps/package.json .docker/runtime-deps/bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts \
  # The runtime is Debian (glibc); the SDK never picks its musl binary here.
  && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl \
  && if [ "$INSTALL_CODING_AGENTS" != "true" ]; then \
       rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-* node_modules/@openai/codex-linux-*; \
     fi

# Keep FFmpeg's video libraries out of the runtime image. These pinned static
# binaries cover both published architectures without Debian's GUI dependencies.
FROM --platform=$BUILDPLATFORM alpine:3.22 AS ffmpeg-binaries
ARG TARGETARCH
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) arch=x64; ffmpeg_sha=9eac5b2b5076db5ff853a6fa0dcd6b8de7d0cac8481eadda6c47cd935825f1ee; ffprobe_sha=065d3c56926052a76e884c4e4b51b7d95248da9391ab7effdcca6b94ceab98cf ;; \
    arm64) arch=arm64; ffmpeg_sha=6e7b1d7d1aa8c35e3fedd78a140aa0968717aeb7386ecfb0ee00773d9f0a4503; ffprobe_sha=fd2aca1456f0261cabef4514b6d97a70fa342003347f51b39c473dd364328089 ;; \
    *) echo "no FFmpeg build for $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  base=https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1; \
  wget -q -O /ffmpeg "$base/ffmpeg-linux-$arch"; \
  wget -q -O /ffprobe "$base/ffprobe-linux-$arch"; \
  echo "$ffmpeg_sha  /ffmpeg" | sha256sum -c -; \
  echo "$ffprobe_sha  /ffprobe" | sha256sum -c -; \
  chmod +x /ffmpeg /ffprobe

# --- Production runtime (server + workspace packages + built static assets) ---
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS runtime
WORKDIR /app

# HTML artifact → PDF export (services/html-pdf.ts). WeasyPrint comes from pip:
# Debian's 62.x drops clamp()/vw sizes, so decks print with default text.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl sudo python3 python3-venv \
    python3-pip libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-dejavu-core \
  && pip3 install --no-cache-dir --break-system-packages weasyprint==70.0 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg-binaries /ffmpeg /ffprobe /usr/local/bin/

# Optional Google Meet audio-capture runtime. Chromium remains sandboxed and
# runs as the existing non-root Nakama user. The manifest and lockfile are
# copied unconditionally (two small files) so the install below can be
# frozen; the packages themselves only land when the build arg is true.
ARG INSTALL_MEET_DEPS=false
COPY .docker/meet-deps/package.json .docker/meet-deps/bun.lock /opt/nakama-meet/
RUN if [ "$INSTALL_MEET_DEPS" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        chromium pulseaudio pulseaudio-utils fonts-liberation xvfb \
      && rm -rf /var/lib/apt/lists/* \
      && cd /opt/nakama-meet \
      && bun install --frozen-lockfile --production --ignore-scripts; \
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
