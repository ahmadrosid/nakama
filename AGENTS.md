# tinyclaw — Agent Context

A multi-tenant, multi-agent platform (monorepo). Each **organization** is a flat tenant boundary. Within an org, each profile has a **soul** — files that define the agent's identity, style, operating instructions, and continuity memory.

## Dev commands

- **Runtime:** Bun 1.3+. Use `bun install`, `bun run`, `bun test`.
- **Dev servers:** `bun run dev:server` (HTTP API), `bun run dev:web` (dashboard), `bun run dev:cli` (CLI).

There's an `apps/` directory for server, web UI, CLI, telegram, and whatsapp apps.

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

Every authenticated API call (except `/v1/auth/*` and `/v1/platform/*`) requires org context:

1. `X-Org-Id` request header (set by `@tinyclaw/client` and tests), or
2. `active_org_id` on the browser session cookie (set via `POST /v1/auth/active-org`).

Org middleware (`apps/server/src/http/org-middleware.ts`) verifies membership and attaches `orgRole` to the request auth context. Role guards live in `apps/server/src/http/org-guards.ts`.

**Onboarding flow**

- Fresh install: `POST /v1/auth/setup` creates the first org, admin user, and browser session.
- Additional orgs: platform admin creates via `POST /v1/platform/orgs`.
- New members: org admin invites via `/v1/orgs/{orgId}/invites`; invitee accepts via `POST /v1/auth/accept-invite`.
- Multi-org users: web org switcher (`apps/web/src/components/OrgSwitcher.tsx`) or `client.setActiveOrg()`.

**Where to make org-related changes**

| What you want to change | File |
|---|---|
| Org context resolution, header name | `apps/server/src/http/org-middleware.ts` |
| Org CRUD, invites, member management | `apps/server/src/services/org-service.ts` |
| Platform org routes | `apps/server/src/http/routes/platform-orgs.ts` |
| Org member routes | `apps/server/src/http/routes/org-members.ts` |
| Auth setup, login, active-org switching | `apps/server/src/http/routes/auth.ts` |
| Role guard helpers | `apps/server/src/http/org-guards.ts` |
| Org types and DB adapter methods | `packages/db/src/types.ts`, `packages/db/src/adapters/sqlite.ts` |
| API contract types | `packages/core/src/contract.ts` |
| Client org header injection | `packages/client/src/client.ts` (`setOrgId`, `X-Org-Id`) |
| Web auth state and org switcher | `apps/web/src/context/auth-context.tsx`, `OrgSwitcher.tsx` |

## System prompt — where to make changes

The system prompt is built in three layers. Know which one to edit:

| What you want to change | File | Function |
|---|---|---|
| Static chat structure (identity, USER.md, tools, timezone, channel rules) | `packages/agent/src/chat-prompt.ts` | `buildChatSystemPrompt` |
| Soul/identity content (SOUL.md, STYLE.md, SKILL.md, MEMORY.md) | `packages/core/src/soul/compose.ts` | `composeSoulSystemPrompt` |
| Dynamic per-turn context (current date, etc.) | `packages/agent/src/chat.ts` | `generateReply` |

`generateReply` is the final dispatch point — it calls `provider.generateChat()` / `provider.streamChat()` with the assembled system prompt string.

## Soul System (`packages/core/src/soul/`)

Each profile's soul lives at `~/.tinyclaw/profiles/{profileId}/`:

| File | Purpose |
|---|---|
| `SOUL.md` | Identity |
| `STYLE.md` | Voice and writing style |
| `SKILL.md` | Operating instructions |
| `MEMORY.md` | Cross-session continuity (facts/preferences) |
| `examples/*.md` | Calibration examples |

Soul files are read by `loadSoulStack()` (`load.ts`) and injected by `composeSoulSystemPrompt()` (`compose.ts`).

## Tools (`packages/core/src/tools/`)

- `update_profile_memory` — writes to MEMORY.md
- `knowledge_base_search` — search uploaded documents
- `web_search` — web search
- `email` — list, read, search, and send mail via deployment mailbox settings
- `search_files` / `ripgrep` — file/content search

## Key packages

- `packages/core` — soul system, tools, contracts, types
- `packages/agent` — chat loop, prompt composition, history compaction
- `packages/db` — database layer
- `packages/client` — API client
- `packages/skills` — skill definitions

## Server notes

- HTTP runtime lives in `apps/server/src/http/app.ts` and uses Hono.
- Middleware order: auth (`auth-middleware.ts`) → org context (`org-middleware.ts`) → routes.
- Routes live in `apps/server/src/http/routes/*`.
- Auth and CSRF checks live in `apps/server/src/http/auth-middleware.ts` with helpers in `shared.ts`.
- OpenAPI is generated from the Hono route registration in `apps/server/src/http/openapi.ts`.
- `/openapi.json` is served dynamically from the Hono app; route registration is the source of truth.
- **Platform-admin-only routes:** profiles, tools, MCP servers, skills (mutations). Org admins cannot create profiles — they use profiles provisioned by the platform admin.
- **Org-admin routes:** member list, invite, add, remove, role change under `/v1/orgs/{orgId}/…`.
- **Viewer restrictions:** `requireNotViewer` on worker control and agent-invocation paths.
