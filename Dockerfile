# TinyClaw — server and CLI
# Build:  docker build -t tinyclaw .
# Server: docker run -d -p 4310:4310 -e OPENAI_API_KEY=sk-... tinyclaw
# CLI:    docker run -it --rm -e OPENAI_API_KEY=sk-... tinyclaw cli

FROM oven/bun:1.3-debian AS install
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/cli/package.json apps/cli/
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/
COPY packages/db/package.json packages/db/
COPY packages/client/package.json packages/client/

RUN bun install --frozen-lockfile

COPY apps/server apps/server
COPY apps/cli apps/cli
COPY packages packages
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p data/sqlite data/automations data/logs

ENV NODE_ENV=production \
    TINYCLAW_HOST=0.0.0.0 \
    TINYCLAW_PORT=4310 \
    DATABASE_URL=file:data/sqlite/tinyclaw.sqlite

EXPOSE 4310

VOLUME ["/app/data", "/root/.tinyclaw"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:4310/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["server"]
