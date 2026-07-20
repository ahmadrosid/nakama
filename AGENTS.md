# nakama — Agent Context

A multi-tenant, multi-agent platform (monorepo). Each **organization** is a flat tenant boundary. Within an org, each profile has a **soul** — files that define the agent's identity, style, operating instructions, and continuity memory.

## Dev commands

- **Runtime:** Bun 1.3+. Use `bun install`, `bun run`, `bun test`.
- **Dev servers:** `bun run dev:server` (HTTP API), `bun run dev:web` (dashboard), `bun run dev:cli` (CLI).

`apps/` holds server, web UI, CLI, telegram, and whatsapp apps.

## Multi-tenancy

Organizations isolate tenant-owned data: profiles, sessions, automations, tasks, tools, MCP servers, skills, and usage stats. Each row carries an optional `org_id` column (see `packages/db/sql/schema.sql` and `migrateTenantOrgScope` in `packages/db/src/migrate.ts`).

**Actors and roles**

| Actor | Scope | Capabilities |
|---|---|---|
| Platform admin | Deployment | Create/list orgs (`/v1/platform/orgs`), manage profiles/tools/MCP/skills |
| Org admin | One org | Invite/remove members, change roles (`/v1/orgs/{orgId}/members`) |
| Org member | One org | Chat, run agents, manage automations/tasks |
| Org viewer | One org | Read chat history only — blocked from agent invocation and mutations |

**Org context on requests**

Every authenticated API call (except `/v1/auth/*` and `/v1/platform/*`) requires org context via `X-Org-Id` header (set by `@nakama/client` and tests) or `active_org_id` on the browser session cookie (set via `POST /v1/auth/active-org`). Org middleware (`apps/server/src/http/org-middleware.ts`) verifies membership and attaches `orgRole`; role guards live in `apps/server/src/http/org-guards.ts`.

**Onboarding flow**

- Fresh install: `POST /v1/auth/setup` creates the first org, admin user, and browser session.
- Additional orgs: platform admin creates via `POST /v1/platform/orgs`.
- New members: org admin invites via `/v1/orgs/{orgId}/invites`; invitee accepts via `POST /v1/auth/accept-invite`.
- Multi-org users: web org switcher (`apps/web/src/components/OrgSwitcher.tsx`) or `client.setActiveOrg()`.

**Where to make org-related changes**

| What | File |
|---|---|
| Org CRUD, invites, member management | `apps/server/src/services/org-service.ts` |
| Platform org routes | `apps/server/src/http/routes/platform-orgs.ts` |
| Org member routes | `apps/server/src/http/routes/org-members.ts` |
| Auth setup, login, active-org switching | `apps/server/src/http/routes/auth.ts` |
| Org types and DB adapter methods | `packages/db/src/types.ts`, `packages/db/src/adapters/sqlite.ts` |
| API contract types | `packages/core/src/contract.ts` |
| Client org header injection | `packages/client/src/client.ts` (`setOrgId`, `X-Org-Id`) |
| Web auth state and org switcher | `apps/web/src/context/auth-context.tsx`, `OrgSwitcher.tsx` |

## System prompt — where to make changes

The system prompt is built in three layers:

| What you want to change | File | Function |
|---|---|---|
| Static chat structure (identity, USER.md, tools, timezone, channel rules) | `packages/agent/src/chat-prompt.ts` | `buildChatSystemPrompt` |
| Soul/identity content (SOUL.md, STYLE.md, INSTRUCTIONS.md, MEMORY.md) | `packages/core/src/soul/compose.ts` | `composeSoulSystemPrompt` |
| Dynamic per-turn context (current date, etc.) | `packages/agent/src/chat.ts` | `generateReply` |

`generateReply` is the final dispatch point — it calls `provider.generateChat()` / `provider.streamChat()` with the assembled system prompt string.

## Soul System (`packages/core/src/soul/`)

Each profile's soul lives at `~/.nakama/orgs/{orgId}/profiles/{profileId}/` (`getProfileSoulDir` in `packages/core/src/soul/resolve.ts`):

| File | Purpose |
|---|---|
| `SOUL.md` | Identity |
| `STYLE.md` | Voice and writing style |
| `INSTRUCTIONS.md` | Operating instructions |
| `MEMORY.md` | Cross-session continuity (facts/preferences) |

Loaded by `loadSoulStack()` (`load.ts`); injected by `composeSoulSystemPrompt()` (`compose.ts`).

## Tools (`packages/core/src/tools/`)

- `update-profile-memory` skill — writes facts to MEMORY.md via file tools
- `archive-profile-memory` skill — archives bullets from MEMORY.md to memory-archive/ via file tools
- `save-artifact` skill — saves persistent text outputs under artifacts/ via write_file
- `knowledge_base_search` — search uploaded documents
- `web_search` — web search
- `email` — list, read, search, and send mail via deployment mailbox settings
- `search_files` / `ripgrep` — file/content search
- `bash` (Super Bot) — run shell commands in the profile workspace
- `sub_agent` (opt-in) — run a focused same-profile sub-agent for delegated research, review, or planning; returns a structured result (not for repo coding — use `coding-delegation` + `bash`)
- `coding-delegation` skill — invoke Codex / Claude Code / OpenCode for repo coding work via `bash` and harness CLI templates
- `agent-browser` skill (opt-in) — interactive browser automation via `bash` and the [agent-browser](https://github.com/vercel-labs/agent-browser) CLI (login walls, forms, snapshots with `@e` refs); requires host `agent-browser` + Chrome install; fresh session each run — see `docs/website/agent-browser.md`
- Composio — hybrid org toolkit catalog + per-user OAuth via Integrations (see `docs/website/composio.md`)

## Tool execution & workspace

**Start here for path/context bugs** (e.g. custom tool resolving files under the repo instead of `~/.nakama`).

| Path | Purpose |
|---|---|
| `~/.nakama/orgs/{orgId}/profiles/{profileId}/` | Profile workspace (soul files, KB, agent file I/O) — `getProfileSoulDir()` |
| `~/.nakama/tools/*.js` | Custom JavaScript tool modules — `getCustomToolsDir()` |

Override config root with `NAKAMA_CONFIG_DIR`.

### `ToolContext` (passed to every `tool.run(input, context)`)

Type: `packages/core/src/contract.ts` (`ToolContext`). Populated by the server, not by the web UI.

| Field | Set in chat | Set in playground |
|---|---|---|
| `orgId`, `profileId`, `sessionId` | Yes | `profileId` resolved server-side |
| `agentDepth` | When sub-agent nesting | No |
| `workspaceRoot` | Yes (via helper below) | Yes (via helper below) |
| `userId` | When known | Yes |

**Always use `buildToolExecutionContext()`** (`packages/core/src/tools/context.ts`) when constructing context. It sets `workspaceRoot` from `getProfileSoulDir(orgId, profileId)` unless already explicit.

Custom JS tools should resolve relative paths against `context.workspaceRoot` — **not** `process.cwd()` (dev server cwd is often the monorepo root).

### Built-in vs custom JavaScript tools

| | Built-in tools | Custom JS tools |
|---|---|---|
| Code | `packages/core/src/tools/`, `apps/server/src/tools/` | `~/.nakama/tools/*.js` |
| Workspace | Resolved inside each handler via `getProfileSoulDir(orgId, profileId)` | Must use `context.workspaceRoot` (or absolute paths) |
| Loader | Registered in tool resolver / builtins map | `apps/server/src/services/javascript-tool-loader.ts` |

### Execution paths (grep these first)

| Flow | Entry | Context built |
|---|---|---|
| Agent chat | `apps/server/src/services/agent-service.ts` → `buildChatSession()` | `buildToolExecutionContext({ orgId, profileId, sessionId, userId })` |
| Tool loop | `packages/agent/src/tool-loop.ts` → `executeToolCall()` | Passed through unchanged |
| Tools playground | `POST /v1/tools/:toolId/run` → `apps/server/src/http/routes/tools.ts` → `agent.runToolPlayground()` | Profile: first assignee of tool, else org default — `resolvePlaygroundProfileId()` in `agent-service.ts` |
| Param suggest | `POST /v1/tools/:toolId/params/suggest` | Same service, no execution |

### Tools playground (web)

| What | Where |
|---|---|
| Page route | `/system/playground/:toolId` — `apps/web/src/pages/ToolPlaygroundPage.tsx` |
| Run UI | `apps/web/src/components/tools/ToolPlaygroundPanel.tsx` |
| Tools list link | `apps/web/src/components/soul-tools/ToolsTab.tsx` |
| Path helpers | `toolPlaygroundPath()`, `toolsTabPath()` in `apps/web/src/lib/navigation.ts` |
| Access | Org admin or platform admin — `canUseToolPlayground()` in `navigation.ts` |

### Debugging checklist

1. Read the custom tool module in `~/.nakama/tools/` — check how it resolves paths.
2. Grep `runToolPlayground` and confirm `buildToolExecutionContext` is used with a real `profileId`.
3. If the error path is under the monorepo root, the tool likely fell back to `process.cwd()` because `workspaceRoot` was missing.
4. Put test files under the **assigned profile's** workspace dir, not the repo.

Super Bot tool-authoring rules (write modules to `~/.nakama/tools/`, export `run(input, context)`) live in `packages/db/src/constants.ts` (`SUPER_BOT_SYSTEM_PROMPT`).

## Key packages

- `packages/core` — soul system, tools, skills, contracts, types
- `packages/agent` — chat loop, prompt composition, history compaction
- `packages/db` — database layer
- `packages/client` — API client

## Server notes

- HTTP runtime lives in `apps/server/src/http/app.ts` and uses Hono.
- Middleware order: auth (`auth-middleware.ts`) → org context (`org-middleware.ts`) → routes.
- Routes live in `apps/server/src/http/routes/*`.
- Auth and CSRF checks live in `apps/server/src/http/auth-middleware.ts` with helpers in `shared.ts`.
- OpenAPI: `/openapi.json` is served dynamically from the Hono app; route registration (`apps/server/src/http/openapi.ts`) is the source of truth.
- **Platform-admin-only routes:** profiles, tools, MCP servers, skills (mutations). Org admins cannot create profiles — they use profiles provisioned by the platform admin.
- **Org-admin routes:** member list, invite, add, remove, role change under `/v1/orgs/{orgId}/…`.
- **Viewer restrictions:** `requireNotViewer` on worker control and agent-invocation paths.
