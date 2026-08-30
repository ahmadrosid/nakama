# nakama — Agent Context

Agent platform built to work with your team — not replace them. Multi-tenant monorepo; orgs are flat tenants, each profile has a **soul** (identity, style, instructions, memory).

**Constraints:**
- Prefer edit over extract; no new package/file unless an existing module cannot hold the change
- No new abstractions for a single call site
- ADHD-shaped replies (lead with the action; numbered steps; no preamble/recap)
- Human voice — short, concrete, no corporate filler
- If ambiguous, give 3 options numbered — the user will reply with a number

## Dev

- Bun 1.3+: `bun install`, `bun run`, `bun test`
- Servers: `bun run dev:server` | `dev:web` | `dev:cli`
- Layout: `apps/{server,web,cli}`, channel workers in `apps/platform/{telegram,whatsapp,discord,automation}`
- Tests: assert behavior (status, data, side effects), not prompt/description/error copy
- React UI: one self-explanatory heading/label; no subtitles or helper copy unless the user asks or misunderstanding would cause errors
- Format / lint: `bun x ultracite fix` | `check` | `doctor`; unused exports: `bun run knip` (CI fails on findings)

### Platform worker env (actual keys)

No `.env` is shipped. Keys are case-sensitive. Prefer Integrations UI + `~/.nakama/{telegram,whatsapp,discord}/config.ini` when possible; env overrides below.

| Worker | Env keys |
|---|---|
| Shared (all four) | `nakama_SERVER_URL` via `ensureServerRunning` / `resolveServerUrl` (fallback: `~/.nakama/runtime/server-url.txt`, else `http://127.0.0.1:4310`) |
| automation | `NAKAMA_AUTOMATION_HEARTBEAT_INTERVAL_MS` (default `15000`) |
| telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `nakama_TELEGRAM_PROFILE_ID` |
| whatsapp | `WHATSAPP_PHONE_NUMBER`, `nakama_WHATSAPP_PROFILE_ID` |
| discord | `DISCORD_BOT_TOKEN`, `DISCORD_ALLOWED_USER_IDS`, `nakama_DISCORD_PROFILE_ID` |

Related: `NAKAMA_WEB_PUBLIC_URL` / `NAKAMA_PUBLIC_URL` (`resolveWebPublicUrl`). Sources: `apps/platform/*/src/config.ts`, `packages/core/src/{telegram,whatsapp,discord}-config.ts`, `packages/core/src/runtime.ts`.

## LLM cassette tests (MSW)

For live provider tests: record one real HTTP call, commit the cassette, replay offline thereafter. Helper: `apps/server/src/testing/llm-msw-cassette.ts` (`withMswCassette`). Cassettes live in `apps/server/src/testing/cassettes/`. Name live tests `*.llm.test.ts`.

```bash
bun test path/to/foo.llm.test.ts                 # replay (default when cassette exists)
LLM_VCR_MODE=record bun test path/to/foo.llm.test.ts  # re-record (needs provider API key)
```

## GitHub

Use `gh` for issues, PRs, checks, reviews, releases, and any GitHub URL. Always run outside the sandbox (`required_permissions: ["all"]`) — sandbox returns `Forbidden`.

`gh issue` / `gh pr` / `--json` go through GraphQL and often time out here. Prefer REST: `gh api repos/{owner}/{repo}/issues` or `/pulls`, body in a JSON file, `POST --input`. On GraphQL timeout, retry REST once.

**PR descriptions:** use [`.agents/skills/adhd-pr-description/SKILL.md`](.agents/skills/adhd-pr-description/SKILL.md) (default body shape). GitHub fills the same shape via `.github/PULL_REQUEST_TEMPLATE.md`. Agents composing PR bodies (including `ce-commit-push-pr`) must follow that skill.

## Browser automation

Use `agent-browser` only for routine UI checks. Do not add Playwright for that path.

```bash
bun run agent:ui
# source the printed harness.env, then:
agent-browser open $BASE_URL/chat
bun run agent:ui:stop
```

The harness boots an isolated API + Vite stack under `/tmp`, seeds setup over HTTP, and never writes `~/.nakama` or steals `4310`. Run it outside a sandbox that blocks bind or detach. `/chat` is the only seeded-ready page. Other `apps/web` routes are navigation hints, not harness success signals.

Prefer role and text locators. Add `data-testid` only when labels collide.

Operator Docker / `dev:web` on `4310` stays valid for humans. For PR motion video, use `.agents/skills/browser-video-proof/SKILL.md`.

## Documentation (`docs/website`)

User-facing docs: `docs/website/content/docs/` (MDX). Audience = org admins, operators, chat users — not contributors.

When writing docs: **Why** → **Value** → **How** (UI paths, roles, screenshots). Prefer **System → Organization** over route paths. Keep schema, services, file paths, and HTTP API tables out of product docs (put them here or in code). Screenshots: `docs/website/public/screenshots/`; capture scripts: `docs/website/scripts/capture-*.sh`.

## Docker

One container: API + web + platform workers. Data at `/nakama/data` (`NAKAMA_CONFIG_DIR`). Dashboard: http://localhost:4310

```bash
# Prebuilt
docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama ghcr.io/ahmadrosid/nakama:latest

# Build from source and run (uses buildx; default linux/amd64 -t nakama)
./scripts/docker-build-run.sh

# Fresh start (removes container, volume, image)
./scripts/docker-destroy.sh
./scripts/docker-build-run.sh
```

## Multi-tenancy

Orgs isolate profiles, sessions, automations, tasks, tools, MCP, skills, usage (`org_id` — see `packages/db/sql/schema.sql`, `migrateTenantOrgScope`).

| Role | Can |
|---|---|
| Platform admin | Orgs (`/v1/platform/orgs`), profiles/tools/MCP/skills |
| Org admin | Members/invites (`/v1/orgs/{orgId}/members`); profile pack export/import for the active org (create/clone profiles → platform admin or Super Bot `create-profile`) |
| Org member | Chat, agents, automations/tasks |
| Org viewer | Read chat only — no agent invoke / mutations |

**Org context:** every authed call except `/v1/auth/*` and `/v1/platform/*` needs `X-Org-Id` (`@nakama/client`) or `active_org_id` cookie (`POST /v1/auth/active-org`). Middleware: `org-middleware.ts`; guards: `org-guards.ts`.

**Onboard:** setup → `POST /v1/auth/setup`; more orgs → platform admin; invite → `/v1/orgs/{orgId}/invites` + `POST /v1/auth/accept-invite`; switch → `OrgSwitcher.tsx` / `client.setActiveOrg()`.

| Change | Where |
|---|---|
| Org CRUD / invites / members | `apps/server/src/services/org-service.ts` |
| Platform org routes | `apps/server/src/http/routes/platform-orgs.ts` |
| Member routes | `…/routes/org-members.ts` |
| Auth / active-org | `…/routes/auth.ts` |
| DB types / SQLite | `packages/db/src/{types.ts,adapters/sqlite.ts}` |
| Contracts | `packages/core/src/contract.ts` |
| Client `X-Org-Id` | `packages/client/src/client.ts` |
| Web auth / switcher | `apps/web/src/context/auth-context.tsx`, `OrgSwitcher.tsx` |

## System prompt

Merged in `agent-service` `resolveProfileSystemPrompt` → `generateReply` (`provider.generateChat` / `streamChat`):

| Change | File | Fn |
|---|---|---|
| Chat structure (USER.md, tools, timezone, channels) | `packages/agent/src/chat-prompt.ts` | `buildChatSystemPrompt` |
| Soul content | `packages/core/src/soul/compose.ts` | `composeSoulSystemPrompt` |
| Skills catalog / matched / agent-browser | `packages/core/src/skills/compose.ts` | `composeSkillsCatalog`, `composeMatchedSkillsPrompt`, `composeAgentBrowserCapabilityPrompt` |
| Per-turn context (date, etc.) | `packages/agent/src/chat.ts` | `generateReply` |

## Soul (`packages/core/src/soul/`)

Profile workspace / soul dir: `~/.nakama/orgs/{orgId}/profiles/{profileId}/` (`getProfileSoulDir`). Override root: `NAKAMA_CONFIG_DIR`. Load: `loadSoulStack()`; inject: `composeSoulSystemPrompt()`.

| File | Role |
|---|---|
| `SOUL.md` | Identity |
| `STYLE.md` | Voice |
| `INSTRUCTIONS.md` | Operating rules |
| `MEMORY.md` | Cross-session facts |

## Tools (`packages/core/src/tools/`)

| Tool / skill | Notes |
|---|---|
| `update-profile-memory` / `archive-profile-memory` | MEMORY.md ↔ memory-archive/ |
| `save-artifact` | Persist under `artifacts/` |
| `knowledge_base_search` / `web_search` / `email` | KB, web, mailbox |
| `search_files` / `ripgrep` | File/content search |
| `bash` | Profile workspace shell — assign per profile; Super Bot by default |
| `sub_agent` | Opt-in same-profile delegate (not repo coding) |
| `coding-agent` | Repo coding via Codex / Claude Code / OpenCode / pi / Cursor Agent (`agent`) through `bash` — use instead of `sub_agent` for coding |
| `agent-browser` | Opt-in browser CLI; needs host install — `docs/website/agent-browser.md` |
| `create-profile` | Super Bot only, confirm-first — `apps/server/src/tools/super-bot-tools.ts` |
| `skill_manage` | Web/cli skill CRUD + auto-assign — `apps/server/src/tools/skill-manage-tool.ts` (approval, curator, post-turn review live there) |
| Composio | Org toolkits + per-user OAuth — `docs/website/composio.md` |

**Channel artifacts (Telegram/Discord/WhatsApp):** `packages/core/src/channel-artifacts.ts`, `channel-artifact-delivery.ts`; handlers in `apps/platform/{telegram,discord,whatsapp}/src/channel-artifact-flow.ts`.

## Tool execution & workspace

Path bugs (tool resolves under repo instead of `~/.nakama`) → start here.

| Path | Purpose |
|---|---|
| `~/.nakama/orgs/{orgId}/profiles/{profileId}/` | Profile workspace / soul — `getProfileSoulDir()` |
| `~/.nakama/tools/*.js`, `*.py` | Custom JS / Python tools — `getCustomToolsDir()` |

Always build context with `buildToolExecutionContext()` (`packages/core/src/tools/context.ts`) so `workspaceRoot` = soul dir. Custom JS: `context.workspaceRoot`, **not** `process.cwd()`. Custom Python: `NAKAMA_WORKSPACE_ROOT` env.

| | Built-in | Custom JS | Custom Python |
|---|---|---|---|
| Code | `packages/core/src/tools/`, `apps/server/src/tools/` | `~/.nakama/tools/*.js` | `~/.nakama/tools/*.py` |
| Workspace | `getProfileSoulDir` inside handler | `context.workspaceRoot` | `NAKAMA_WORKSPACE_ROOT` env |
| Loader | builtins map | `javascript-tool-loader.ts` | `python-tool-loader.ts` |

| Flow | Entry |
|---|---|
| Chat | `agent-service` → `buildChatSession()` → `buildToolExecutionContext(...)` |
| Tool loop | `packages/agent/src/tool-loop.ts` → `executeToolCall()`; parallel batching in `packages/agent/src/chat.ts` when every call is `parallelSafe` |
| Playground | `POST /v1/tools/:toolId/run` → `runToolPlayground()` |
| Param suggest | `POST /v1/tools/:toolId/params/suggest` |

**Parallel tool calls:** `parallelSafe: true` on read/search/fetch builtins (`read_file`, `search_files`, `knowledge_base_search`, `web_search`, `web_fetch`). Mutating / shell / delegation stay sequential. Custom JS opts in via `handlerConfig.parallelSafe`; Python always sequential. Mixed turn → whole turn sequential.

**Debug:** (1) path under `~/.nakama/tools/`, (2) `buildToolExecutionContext` + real `profileId`, (3) monorepo-root paths ⇒ missing `workspaceRoot`, (4) test files in the assigned profile workspace. Super Bot rules: `SUPER_BOT_SYSTEM_PROMPT` in `packages/db/src/constants.ts`.

**Playground UI:** `/system/playground/:toolId` — `ToolPlaygroundPage.tsx`, `ToolPlaygroundPanel.tsx`; admin-only via `canUseToolPlayground()`.

## Packages & server

- `packages/core` — soul, tools, skills, contracts
- `packages/agent` — chat loop, prompts, compaction
- `packages/db` — DB
- `packages/client` — API client

Server: Hono in `apps/server/src/http/app.ts`. Middleware: auth → org → routes (`routes/*`). OpenAPI: `openapi.ts` (`/openapi.json`). Mutation authority matches the Multi-tenancy role table; viewers blocked by `requireNotViewer` on worker control and agent invoke.
