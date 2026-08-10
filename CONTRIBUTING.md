# Contributing to Nakama

Nakama is a multi-tenant Bun + TypeScript platform for running AI agent teams (orgs, profiles, tools, channels). This guide is for people changing the codebase.

- [README.md](./README.md) — product overview and quick start
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design
- [AGENTS.md](./AGENTS.md) — authoritative agent/dev notes (layout, tests, docs conventions)
- Discord: https://discord.gg/qhKbMFEUc

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- git
- [GitHub CLI](https://cli.github.com/) (`gh`) for opening PRs

## Setup

```bash
git clone https://github.com/ahmadrosid/nakama.git
cd nakama
bun install
```

Run the pieces you need:

```bash
bun run dev:server   # API
bun run dev:web      # web dashboard (starts the server if needed)
bun run dev:cli      # terminal client
```

- Local Bun web dashboard: http://localhost:3000
- Docker single-container dashboard (API + web + workers): http://localhost:4310

See [AGENTS.md](./AGENTS.md) for Docker run/build scripts and deeper layout notes.

## Repo layout

| Path | Purpose |
|---|---|
| `apps/server` | Hono HTTP API, agent service, tool playground, workers control |
| `apps/web` | React dashboard |
| `apps/cli` | Terminal chat client |
| `apps/platform/telegram` | Telegram channel worker |
| `apps/platform/whatsapp` | WhatsApp channel worker |
| `apps/platform/discord` | Discord channel worker |
| `apps/platform/automation` | Automation worker |
| `packages/core` | Soul, tools, skills, contracts |
| `packages/agent` | Chat loop, prompts, compaction |
| `packages/db` | SQLite schema and adapters |
| `packages/client` | HTTP + SSE client (`X-Org-Id`, auth) |
| `docs/website` | User-facing docs site (MDX) |

Workspaces: `apps/*`, `apps/platform/*`, `packages/*`.

## Code style and checks

Lint and format with Biome via [Ultracite](https://www.ultracite.ai/). Config: `biome.jsonc`.

```bash
bun run check   # ultracite check
bun run fix     # ultracite fix
```

Husky runs `bun x ultracite fix` on staged files in `.husky/pre-commit` and re-stages them. Fix issues locally before pushing; CI expects a clean check.

## Testing

```bash
bun test
```

Assert behavior (outputs, status codes, side effects), not prompt text, description strings, or exact error copy.

### LLM cassette tests (MSW)

Live provider tests record one real HTTP exchange, commit the cassette, then replay offline. Helper: `apps/server/src/testing/llm-msw-cassette.ts` (`withMswCassette`).

- Name live tests `*.llm.test.ts`
- Cassettes: `apps/server/src/testing/cassettes/`
- Default: replay when a cassette exists (`LLM_VCR_MODE` unset → `auto` locally, `replay` in CI)
- Re-record (needs a provider API key):

```bash
bun test path/to/foo.llm.test.ts
LLM_VCR_MODE=record bun test path/to/foo.llm.test.ts
```

## Docs contributions

User docs live in `docs/website/content/docs/` (MDX). Audience is operators and chat users — prefer why / value / how to use; keep contributor internals in this file or `AGENTS.md` unless the page is explicitly for integrators.

When adding or changing a page:

1. Edit or add MDX under `docs/website/content/docs/`
2. Register the page in `docs/website/content/docs/meta.json`
3. Cross-link from the hub `docs/website/content/docs/docs.mdx`
4. Screenshots go in `docs/website/public/screenshots/` (`![alt](/screenshots/foo.png)`); capture scripts in `docs/website/scripts/`
5. Verify: `bun run build:docs`

## Workflow

1. Branch from `main` (or fork, then branch)
2. One concern per PR
3. Push and open a PR:

```bash
git push -u origin HEAD
gh pr create
```

4. PR body should state what changed, what you verified, and remaining risks
5. CI must pass before merge

Do not rewrite `AGENTS.md`, `README.md`, or `ARCHITECTURE.md` unless the change is specifically about those files.
