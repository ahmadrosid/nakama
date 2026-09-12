# Contributing to Nakama

Nakama is a multi-tenant Bun + TypeScript platform for running AI agent teams (orgs, profiles, tools, channels). This guide is for people changing the codebase.

- [README.md](./README.md): product overview and quick start
- [ARCHITECTURE.md](./ARCHITECTURE.md): system design
- [AGENTS.md](./AGENTS.md): authoritative agent/dev notes (layout, tests, docs conventions)
- Discord: https://discord.gg/Cwq3erYvh

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

- Local Bun web dashboard: http://localhost:3003
- Docker single-container dashboard (API + web + workers): http://localhost:4310

On a fresh machine the dashboard redirects to the setup wizard: admin account, organization, then an LLM provider key. The [first-time setup guide](https://ahmadrosid.github.io/nakama/first-time-setup) shows each step.

Local data (SQLite database, profile workspaces) lives in `~/.nakama`. Point `NAKAMA_CONFIG_DIR` somewhere else when you want a throwaway instance instead of your real one:

```bash
NAKAMA_CONFIG_DIR=/tmp/nakama-scratch bun run dev:server
```

See [AGENTS.md](./AGENTS.md) for Docker run/build scripts and deeper layout notes.

## Choosing an issue

Three searches, depending on what you are after:

| Search | What is in it |
|---|---|
| [`good first issue`](https://github.com/ahmadrosid/nakama/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) | small and self-contained |
| [`stage: now`](https://github.com/ahmadrosid/nakama/issues?q=is%3Aissue+is%3Aopen+label%3A%22stage%3A+now%22) | design settled, ready to build |
| [`help wanted`, unassigned](https://github.com/ahmadrosid/nakama/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee) | the team wants outside help, and it fits in one PR. Empty means everything labelled that way is already claimed |

A triaged issue carries four labels, and each answers a different question:

| Axis | Values | Question it answers |
|---|---|---|
| type | `bug`, `security`, `enhancement`, `new-feature`, `documentation` | what kind of change is it |
| `priority:` | `critical`, `high`, `medium`, `low` | how much does it hurt |
| `stage:` | `now`, `next`, `later` | is it ready to build |
| `role:` | `BE`, `FE`, `UI`, `UX`, `DevOps`, `QA` | which skills does it need |

Read `stage:` before you start. `stage: now` is ready. `stage: next` is sized but waits for a version cut. `stage: later` still has an open question in the thread, so ask there first, because a PR that guesses the answer usually gets closed.

Hit a bug that has no issue? Open one with the [issue templates](https://github.com/ahmadrosid/nakama/issues/new/choose). A repro someone else can run beats a description.

## Workflow

**Claim the issue before you build.** Comment on it and wait to be assigned. An
assignee is the only signal other contributors have: a branch on your fork is
invisible from this repo, so two people can spend a day on the same feature
without either one seeing the other. Before starting, check the open PRs for that
issue number too, not just the issue:

```bash
gh pr list --repo ahmadrosid/nakama --search "<issue-number>"
```

1. Branch from `main` (or fork, then branch). Without write access, fork first:

```bash
gh repo fork ahmadrosid/nakama --clone
git checkout -b fix/940-profile-tool-scope
```

Branch names here read `type/short-slug`, with the issue number when there is one.

2. One concern per PR. Match the code around you instead of introducing a new pattern, and add a test that fails without your change.

3. Run the checks before you push. All three are local, and none needs an account:

```bash
bun run check   # Biome via Ultracite; `bun run fix` applies what it can
bun run test    # every workspace, and what CI runs
bun run knip    # unused files, exports and dependencies
```

4. Push and open a PR:

```bash
git push -u origin HEAD
gh pr create
```

Put `Fixes #123` in the body so the issue closes on merge.

5. PR body uses the ADHD PR format in [`.agents/skills/adhd-pr-description/SKILL.md`](./.agents/skills/adhd-pr-description/SKILL.md): outcome lead, Before/After, Why safe (≤3), residual risk, tight test plan. Agents opening PRs via `ce-commit-push-pr` must follow that skill.

Show the evidence: numbers for a behavior change, a before and after screenshot for anything visual, a short GIF for a flow with several steps. Capture the "before" first, since it is gone once the fix lands.

6. CI must pass before merge, and green CI is not the same as reviewed. Reviews here arrive as plain comments rather than a formal approval, so read the thread instead of the badge. Answer every point, including the ones you disagree with, and push follow-up commits to the same branch rather than force-pushing, so the comments stay attached to the diff.

Do not rewrite `AGENTS.md`, `README.md`, or `ARCHITECTURE.md` unless the change is specifically about those files.

## Code style and checks

Lint and format with Biome via [Ultracite](https://www.ultracite.ai/). Config: `biome.jsonc`.

```bash
bun run check   # ultracite check
bun run fix     # ultracite fix
bun run knip    # unused files, dependencies, and exports
```

Husky runs `bun x ultracite fix` on staged files in `.husky/pre-commit` and re-stages them, so a commit can rewrite your files. Fix issues locally before pushing. CI fails on Knip findings (`bun run knip`).

## Testing

```bash
bun run test                      # every workspace, the same command CI runs
bun test path/to/file.test.ts     # one file, while you iterate
```

Assert behavior (outputs, status codes, side effects), not prompt text, description strings, or exact error copy.

### LLM cassette tests (MSW)

Live provider tests record one real HTTP exchange, commit the cassette, then replay offline. Helper: `apps/server/src/testing/llm-msw-cassette.ts` (`withMswCassette`).

- Name live tests `*.llm.test.ts`
- Cassettes: `apps/server/src/testing/cassettes/`
- Default: replay when a cassette exists (`LLM_VCR_MODE` unset means `auto` locally, `replay` in CI)
- Re-record (needs a provider API key):

```bash
bun test path/to/foo.llm.test.ts
LLM_VCR_MODE=record bun test path/to/foo.llm.test.ts
```

## Docs contributions

User docs live in `docs/website/content/docs/` (MDX). The audience is operators and chat users, so prefer why / value / how to use, and keep contributor internals in this file or `AGENTS.md` unless the page is explicitly for integrators.

When adding or changing a page:

1. Edit or add MDX under `docs/website/content/docs/`
2. Register the page in `docs/website/content/docs/meta.json`
3. Cross-link from the hub `docs/website/content/docs/docs.mdx`
4. Screenshots go in `docs/website/public/screenshots/` (`![alt](/screenshots/foo.png)`); capture scripts in `docs/website/scripts/`
5. Verify: `bun run build:docs`

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
