# nakama — Agent Context

Agent platform built to work with your team — not replace them. Multi-tenant monorepo; orgs are flat tenants, each profile has a **soul** (identity, style, instructions, memory).

## Dev

- Bun 1.3+: `bun install`, `bun run`, `bun test`
- Servers: `bun run dev:server` | `dev:web` | `dev:cli`
- Layout: `apps/{server,web,cli}`, channel workers in `apps/platform/{telegram,whatsapp,discord,automation}`

## Docker

One container: API + web + platform workers. Data at `/nakama/data` (`NAKAMA_CONFIG_DIR`). Dashboard: http://localhost:4310

```bash
# Prebuilt
docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama ghcr.io/ahmadrosid/nakama:latest

# Build from source (uses buildx; default linux/amd64 -t nakama)
./scripts/docker-build.sh
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama nakama

# Fresh start (removes container, volume, image)
./scripts/docker-reset.sh
./scripts/docker-build.sh
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama nakama
```

## Multi-tenancy

Orgs isolate profiles, sessions, automations, tasks, tools, MCP, skills, usage (`org_id` — see `packages/db/sql/schema.sql`, `migrateTenantOrgScope`).

| Role | Can |
|---|---|
| Platform admin | Orgs (`/v1/platform/orgs`), profiles/tools/MCP/skills |
| Org admin | Members/invites (`/v1/orgs/{orgId}/members`) |
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

Path: `~/.nakama/orgs/{orgId}/profiles/{profileId}/` (`getProfileSoulDir`). Load: `loadSoulStack()`; inject: `composeSoulSystemPrompt()`.

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
| `bash` | Super Bot — profile workspace shell |
| `sub_agent` | Opt-in same-profile delegate (not repo coding) |
| `coding-delegation` | Codex / Claude Code / OpenCode via `bash` |
| `agent-browser` | Opt-in browser CLI; needs host install — `docs/website/agent-browser.md` |
| `create-profile` | Super Bot only, confirm-first — `apps/server/src/tools/super-bot-tools.ts` |
| Composio | Org toolkits + per-user OAuth — `docs/website/composio.md` |

**Channel artifacts (Telegram/Discord):** `packages/core/src/channel-artifacts.ts`, `channel-artifact-delivery.ts`; handlers in `apps/platform/{telegram,discord}/src/channel-artifact-flow.ts`.

## Tool execution & workspace

Path bugs (tool resolves under repo instead of `~/.nakama`) → start here. Override root: `NAKAMA_CONFIG_DIR`.

| Path | Purpose |
|---|---|
| `~/.nakama/orgs/{orgId}/profiles/{profileId}/` | Profile workspace — `getProfileSoulDir()` |
| `~/.nakama/tools/*.js` | Custom JS tools — `getCustomToolsDir()` |

Always build context with `buildToolExecutionContext()` (`packages/core/src/tools/context.ts`) so `workspaceRoot` = soul dir. Custom JS tools must use `context.workspaceRoot`, **not** `process.cwd()`.

| | Built-in | Custom JS |
|---|---|---|
| Code | `packages/core/src/tools/`, `apps/server/src/tools/` | `~/.nakama/tools/*.js` |
| Workspace | `getProfileSoulDir` inside handler | `context.workspaceRoot` |
| Loader | builtins map | `javascript-tool-loader.ts` |

| Flow | Entry |
|---|---|
| Chat | `agent-service` → `buildChatSession()` → `buildToolExecutionContext(...)` |
| Tool loop | `packages/agent/src/tool-loop.ts` → `executeToolCall()` |
| Playground | `POST /v1/tools/:toolId/run` → `runToolPlayground()` (`resolvePlaygroundProfileId`) |
| Param suggest | `POST /v1/tools/:toolId/params/suggest` |

**Debug:** (1) check path resolution in `~/.nakama/tools/`, (2) confirm `buildToolExecutionContext` + real `profileId`, (3) monorepo-root paths ⇒ missing `workspaceRoot`, (4) put test files in the assigned profile workspace. Super Bot authoring rules: `SUPER_BOT_SYSTEM_PROMPT` in `packages/db/src/constants.ts`.

**Playground UI:** `/system/playground/:toolId` — `ToolPlaygroundPage.tsx`, `ToolPlaygroundPanel.tsx`; admin-only via `canUseToolPlayground()`.

## Packages & server

- `packages/core` — soul, tools, skills, contracts
- `packages/agent` — chat loop, prompts, compaction
- `packages/db` — DB
- `packages/client` — API client

Server: Hono in `apps/server/src/http/app.ts`. Middleware: auth → org → routes (`routes/*`). OpenAPI from `openapi.ts` (`/openapi.json`). Platform-admin-only: profile/tool/MCP/skill mutations (org admins use provisioned profiles or Super Bot `create-profile`). Org-admin: `/v1/orgs/{orgId}/…` members. Viewers blocked by `requireNotViewer` on worker control and agent invoke.
