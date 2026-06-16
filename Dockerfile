# syntax=docker/dockerfile:1
# TinyClaw — one container: API, web dashboard, automation + task workers
# Build: docker build -t tinyclaw .
# Run:   docker run -d -p 4310:4310 -v tinyclaw-config:/root/.tinyclaw tinyclaw

# --- Build web dashboard (devDependencies stay in this stage only) ---
FROM oven/bun:1.3-debian AS web-builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps apps
COPY packages packages

RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile \
  && bun run --filter @tinyclaw/web build

# --- Production runtime (server + workspace packages + built static assets) ---
FROM oven/bun:1.3-debian AS runtime
WORKDIR /app

# Install python3 for custom agent tools (minimal footprint)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
COPY apps/server apps/server
COPY packages packages
# Workspace stubs keep the lockfile valid without pulling web/cli/telegram sources.
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY apps/platform/telegram/package.json apps/platform/telegram/
COPY apps/platform/whatsapp/package.json apps/platform/whatsapp/
COPY --from=web-builder /app/apps/web/dist apps/web/dist

RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --production --filter '@tinyclaw/server'

ENV NODE_ENV=production \
    TINYCLAW_HOST=0.0.0.0 \
    TINYCLAW_PORT=4310 \
    DATABASE_URL=file:data/sqlite/tinyclaw.sqlite

EXPOSE 4310

VOLUME ["/root/.tinyclaw"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:4310/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "apps/server/src/index.ts"]
