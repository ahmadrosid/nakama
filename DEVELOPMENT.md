# Development

## Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| [Bun](https://bun.sh) | 1.3+ | Runtime, package manager, and local dev |
| [Docker](https://docs.docker.com/get-docker/) | 20+ (optional) | Run the server or CLI in a container |

For local development you only need Bun. The Docker image bundles Bun and supports both the HTTP server and the interactive CLI.

## Local setup

```bash
bun install
bun run dev:server   # server only
bun run dev:cli      # CLI (auto-starts server if needed)
```

See [README.md](./README.md) for first-run provider setup and CLI usage.

## Docker

The [Dockerfile](./Dockerfile) builds an image with the server and CLI. SQLite uses Bun’s built-in driver (`bun:sqlite`); no extra native database packages are required.

The [docker-entrypoint.sh](./docker-entrypoint.sh) accepts `server` (default) or `cli`.

### Build

```bash
docker build -t tinyclaw .
```

### Run the server

```bash
docker run -d --name tinyclaw \
  -p 4310:4310 \
  -e OPENAI_API_KEY=sk-... \
  -e TINYCLAW_MODEL=gpt-5.4 \
  -v tinyclaw-data:/app/data \
  tinyclaw
```

The server listens on `http://0.0.0.0:4310` inside the container. Map port `4310` to reach it from the host.

### Run the CLI

The CLI needs an interactive terminal (`-it`). It auto-starts the server in the same container when nothing is listening on `TINYCLAW_SERVER_URL` (default `http://127.0.0.1:4310`).

```bash
docker run -it --rm \
  -e OPENAI_API_KEY=sk-... \
  -e TINYCLAW_MODEL=gpt-5.4 \
  -v tinyclaw-data:/app/data \
  tinyclaw cli
```

To use a server that is already running (on the host or in another container), set `TINYCLAW_SERVER_URL`:

```bash
docker run -it --rm \
  -e TINYCLAW_SERVER_URL=http://host.docker.internal:4310 \
  tinyclaw cli
```

On Linux without `host.docker.internal`, use the host gateway IP or run both services via Compose (below).

### Docker Compose

[docker-compose.yml](./docker-compose.yml) runs the server in the background and attaches an interactive CLI that connects over the internal network:

```bash
export OPENAI_API_KEY=sk-...
docker compose run --rm cli
```

Start only the server:

```bash
docker compose up -d server
```

Provider credentials are read from environment variables in Docker (no interactive setup). The provider is chosen automatically: `OPENAI_API_KEY` takes precedence over `ANTHROPIC_API_KEY`. If neither is set, the server still starts and chat runs in offline mode.

### Volumes

| Mount | Purpose |
|-------|---------|
| `/app/data` | SQLite database (`data/sqlite/tinyclaw.sqlite`), automations, logs |
| `/root/.tinyclaw` | Optional user config (`config.ini`) if you prefer file-based settings over env vars |

Persist at least `/app/data` so profiles, tools, and sessions survive container restarts.

### Health check

The image defines a `HEALTHCHECK` against `GET /health`. Inspect status with:

```bash
docker inspect --format='{{.State.Health.Status}}' tinyclaw
```

### Useful commands

```bash
docker logs -f tinyclaw
docker stop tinyclaw && docker rm tinyclaw
curl http://127.0.0.1:4310/health
```

Point a local CLI at a containerized server with `TINYCLAW_SERVER_URL=http://127.0.0.1:4310` before `bun run dev:cli`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `TINYCLAW_HOST` | Server bind address (default `127.0.0.1`; Docker sets `0.0.0.0`) |
| `TINYCLAW_PORT` | Server port (default `4310`) |
| `TINYCLAW_SERVER_URL` | Client server URL override |
| `TINYCLAW_MODEL` | Model ID override |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `DATABASE_URL` | SQLite path (default `file:data/sqlite/tinyclaw.sqlite`) |

## Available models

| ID | Name | Provider |
|----|------|----------|
| `claude-sonnet-4-6` | Sonnet 4.6 | anthropic |
| `claude-opus-4-6` | Opus 4.6 | anthropic |
| `gpt-5.5` | GPT-5.5 | openai |
| `gpt-5.4` | GPT-5.4 | openai (default) |
| `gpt-5.3-codex` | GPT-5.3 Codex | openai |

## Dev scripts

| Script | Description |
|--------|-------------|
| `bun run dev:server` | Start the central server |
| `bun run dev:cli` | Start the CLI (auto-starts server if needed) |
| `bun run dev:docs` | Scalar API reference at `http://127.0.0.1:4320` |
| `bun run openapi:generate` | Regenerate `apps/server/openapi.json` from TypeScript |
| `bun run build` | Build all workspaces |

SQLite schema lives in `packages/db/sql/schema.sql` and is applied automatically on server startup (`CREATE TABLE IF NOT EXISTS`).
