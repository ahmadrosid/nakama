# syntax=docker/dockerfile:1
# TinyClaw — one container: API, web dashboard, automation + task workers
# Build: docker build -t tinyclaw .
# Run:   docker run -d -p 4310:4310 -v tinyclaw-config:/root/.tinyclaw tinyclaw

# --- Build web dashboard (devDependencies stay in this stage only) ---
FROM --platform=linux/amd64 oven/bun:1.3-slim AS web-builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps apps
COPY packages packages

RUN bun install --frozen-lockfile --ignore-scripts \
  && bun run --filter @tinyclaw/web build

# --- Production runtime (server + workspace packages + built static assets) ---
FROM --platform=linux/amd64 oven/bun:1.3-slim AS runtime
WORKDIR /app

# Install runtime interpreters only. PM2 comes from production dependencies.
RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs procps python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
COPY apps/server apps/server
COPY apps/platform/automation apps/platform/automation
COPY apps/platform/telegram apps/platform/telegram
COPY apps/platform/whatsapp apps/platform/whatsapp
COPY packages packages
# Workspace stubs keep the lockfile valid without pulling web/cli sources.
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY --from=web-builder /app/apps/web/dist apps/web/dist

RUN bun install --frozen-lockfile --production --ignore-scripts \
      --filter '@tinyclaw/server' \
      --filter '@tinyclaw/automation' \
      --filter '@tinyclaw/telegram' \
      --filter '@tinyclaw/whatsapp' \
  && bun run --filter @tinyclaw/automation build \
  && bun run --filter @tinyclaw/telegram build \
  && bun run --filter @tinyclaw/whatsapp build \
  && ln -s "/app/$(find node_modules/.bun -path '*/node_modules/pm2/bin/pm2-runtime' -type f -print -quit)" /usr/local/bin/pm2-runtime

ENV NODE_ENV=production \
    TINYCLAW_HOST=0.0.0.0 \
    TINYCLAW_PORT=4310 \
    DATABASE_URL=file:data/sqlite/tinyclaw.sqlite

EXPOSE 4310

VOLUME ["/root/.tinyclaw"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:4310/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["pm2-runtime", "start", "apps/server/ecosystem.config.cjs"]
