# TinyClaw Architecture

TinyClaw is a multi-tenant AI assistant platform: one agent runtime, multiple thin clients. Each **organization** is a flat tenant boundary — profiles, sessions, tools, and related data are scoped to an org. Users chat with configurable bots, draft automations, and (eventually) run them. Everything funnels through a single HTTP server; clients do not embed agent logic.

## System overview

```mermaid
flowchart TB
  subgraph clients ["Thin clients"]
    web["apps/web"]
    cli["apps/cli"]
    telegram["apps/platform/telegram"]
  end

  subgraph sdk ["@tinyclaw/client"]
    httpSdk["HTTP SDK"]
  end

  subgraph server ["apps/server — agent runtime"]
    app["http/app.ts — Hono HTTP / SSE"]
    auth["auth-middleware.ts"]
    orgCtx["org-middleware.ts"]
    agentSvc["AgentService"]
    resolver["tool-resolver"]
    handlers["Tool handlers<br/>builtin · bash · javascript · mcp"]
    providers["providers/<br/>OpenAI · Anthropic"]
    memory[("In-memory chat<br/>AgentChatSession")]
  end

  subgraph packages ["packages"]
    core["@tinyclaw/core<br/>config · contracts · builtin tools"]
    agent["@tinyclaw/agent<br/>harness · tool loop · automations"]
    dbPkg["@tinyclaw/db<br/>SQLite"]
  end

  subgraph external ["External"]
    llm["OpenAI / Anthropic"]
    sqlite[("SQLite<br/>orgs · profiles · tools · sessions")]
    config["~/.tinyclaw/config.ini"]
  end

  web --> httpSdk
  cli --> httpSdk
  telegram --> httpSdk
  httpSdk -->|"HTTP / SSE<br/>X-Org-Id"| app
  app --> auth
  app --> orgCtx
  app --> agentSvc
  agentSvc --> agent
  agentSvc --> resolver
  resolver --> handlers
  agentSvc --> providers
  agentSvc --> memory
  agent --> core
  handlers --> core
  dbPkg --> core
  httpSdk --> core
  providers --> llm
  dbPkg --> sqlite
  core --> config
```

**Dependency rule:** `packages/*` never import from `apps/*`. Shared code flows packages → apps only.

## Codemap

```text
tinyclaw/
├── apps/
│   ├── web/                 # Dashboard (primary UI); org switcher, setup wizard
│   ├── cli/                 # Terminal client; auto-starts server
│   ├── platform/
│   │   └── telegram/        # Telegram bot bridge; auto-starts server
│   │   └── whatsapp/        # WhatsApp bot bridge; auto-starts server
│   └── server/              # HTTP API, agent runtime, LLM providers
├── packages/
│   ├── core/                # Config, API types, provider interfaces, builtin tools
│   ├── agent/               # Chat harness, tool loop, automation engine
│   ├── db/                  # SQLite via bun:sqlite
│   └── client/              # HTTP SDK for apps
```

**Where is the thing that does X?**

| Question | Look in |
|----------|---------|
| HTTP routing | `apps/server/src/http/app.ts` and `apps/server/src/http/routes/*` |
| HTTP auth / CSRF | `apps/server/src/http/auth-middleware.ts`, `shared.ts`, `public-routes.ts` |
| Org context resolution (`X-Org-Id`, session `active_org_id`) | `apps/server/src/http/org-middleware.ts` |
| Org lifecycle, invites, members, roles | `apps/server/src/services/org-service.ts`, `routes/platform-orgs.ts`, `routes/org-members.ts` |
| Role guards (platform admin, org admin, viewer) | `apps/server/src/http/org-guards.ts` |
| Session lifecycle, model switching | `AgentService` |
| Profile CRUD, soul files, avatar, knowledge base | `apps/server/src/http/routes/profiles.ts`, `AgentService` |
| Resolving DB-backed tools a session may call | `tool-resolver.ts` |
| MCP server registry, connections, profile assignment | `mcp-service.ts`, `mcp-client-manager.ts` |
| Runtime MCP tool expansion for assigned servers | `mcp-tool-bridge.ts` in `AgentService.resolveProfileTools` |
| Super Bot meta-tools, bash | `super-bot-tools.ts`, `bash.ts` |
| LLM vendor calls | `providers/` in `apps/server` |
| Chat, streaming, tool loop | `AgentHarness`, `AgentChatSession` in `@tinyclaw/agent` |
| SQLite schema (`packages/db/sql/schema.sql`) | `@tinyclaw/db` |
| CLI server discovery / spawn | `ensure-server.ts` in `apps/cli` |
| Shared request/response types | `@tinyclaw/core` (`contract.ts`) |
| OpenAPI generation | `apps/server/src/http/openapi.ts` plus route-owned registration in `apps/server/src/http/routes/*` |

Use symbol search for exact paths — names are stable; line numbers are not.

## Architectural invariants

**One agent runtime.** Chat and automation drafting run only in `apps/server`. No client talks to OpenAI or Anthropic directly.

**Hub and spoke.** New channels are thin apps on `@tinyclaw/client`. There is no second agent implementation per channel.

**Packages do not depend on apps.** `packages/*` must not import from `apps/*`. Shared code flows packages → apps, never the reverse.

**Hono owns the HTTP surface.** The server entrypoint builds a single `OpenAPIHono` app in `apps/server/src/http/app.ts`. Runtime, tests, auth, and OpenAPI all go through that same app.

**Providers are server-only.** OpenAI and Anthropic adapters live under `apps/server/src/providers/`, not in `@tinyclaw/core` or `@tinyclaw/agent`.

**Organizations gate tenancy.** Each deployment hosts many orgs. Authenticated requests (except `/v1/auth/*` and `/v1/platform/*`) must carry org context via the `X-Org-Id` header or the browser session's `active_org_id`. Middleware verifies org membership and attaches `orgRole` before route handlers run.

**Profiles gate behavior.** A session binds to a profile (`default` when omitted). The profile supplies the system prompt and tool allowlist before any message is handled. Profile, tool, MCP, and skill admin routes require **platform admin**; org admins manage members only.

**Org roles.** Three org roles: `admin`, `member`, `viewer`. Viewers may read chat history but cannot invoke agents or mutate state (`requireNotViewer`). Platform admins manage org lifecycle but do not access org data unless they are also org members.

**Chat history is in-memory.** `AgentChatSession` holds `ChatMessage[]` in the server process. SQLite stores orgs, profiles, tools, session metadata — not message bodies. Tenant-owned tables carry an `org_id` column for per-org isolation.

**Tools are allowlisted per profile.** The model may only invoke tools assigned to the active profile. Super Bot gets extra runtime tools (meta-tools, `bash`) injected server-side for `super_bot`.

**Tool calls use native LLM function calling.** Allowed tools are sent to OpenAI or Anthropic as structured definitions with JSON Schema parameters. The model returns tool calls; the server executes handlers and feeds results back as tool messages. Streaming clients receive `tool_start` / `tool_end` SSE events during execution.

## Boundaries

See the [system overview](#system-overview) diagram for the full topology. At a high level:

**Client ↔ server.** `@tinyclaw/client` knows session IDs and API shapes from `@tinyclaw/core`. It has no visibility into providers, profiles beyond the API, or the tool loop.

**HTTP ↔ auth.** Hono middleware enforces bearer auth and browser cookie-session auth. Mutating browser requests must also pass CSRF checks, except for explicitly public routes such as login/setup.

**HTTP ↔ org context.** After auth, org middleware resolves the active org, verifies membership, and attaches role. Clients send `X-Org-Id` (see `@tinyclaw/client`); the web dashboard persists the choice in the browser session via `/v1/auth/active-org`.

**Server ↔ agent package.** `AgentService` owns the session map and delegates to `AgentHarness`. The harness depends on `Provider` from `@tinyclaw/core`, not on HTTP or SQLite.

**Server ↔ database.** Organizations, memberships, invites, and tenant-owned rows (profiles, tools, sessions, automations, etc.) persist in SQLite with `org_id` scoping. Live chat state does not cross this boundary.

**Agent ↔ tools.** The harness asks the model; the server resolves and runs handlers. Builtin tools come from `@tinyclaw/core`; server-specific handlers (bash, Super Bot meta-tools) are registered in `apps/server`.

## Request lifecycle

1. `apps/server/src/http/app.ts` checks static web assets first.
2. Hono auth middleware validates bearer auth or browser session auth, then enforces CSRF for mutating browser requests.
3. Org middleware resolves org context (`X-Org-Id` or session `active_org_id`), verifies membership, and attaches `orgRole`. Skipped for public routes, `/v1/auth/*`, and `/v1/platform/*`.
4. A route handler in `apps/server/src/http/routes/*` parses the request and calls the right service. Role guards (`org-guards.ts`) enforce platform-admin, org-admin, or non-viewer checks where needed.
5. Service code calls `AgentService`, `OrgService`, persistence, workers, MCP, automations, or tasks as needed.
6. `/openapi.json` is served from the same Hono route registration, so docs and runtime stay aligned.

## Cross-cutting concerns

**Configuration** — API key and model live in `~/.tinyclaw/config.ini`, or via `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (OpenAI preferred when both are set). Provider is inferred automatically. Loaded through `@tinyclaw/core`. The server writes `~/.tinyclaw/runtime/server-url.txt` so clients can find it.

Deployment mailbox settings for the built-in `email` tool live in the `[email]` section of the same `config.ini` file (`imap_host`, `smtp_host`, shared `username`/`password`, TLS flags, and `from`). Org admins manage them from the web System page under the Tools tab. This mailbox is deployment-global, like Telegram/WhatsApp bridge credentials — not per-org database state.

**IDs** — Entities use prefixed IDs via `createId()` (e.g. `org_…`, `session_…`, `profile_…`).

**Multi-tenancy** — Flat org-as-tenant model. First-time setup (`POST /v1/auth/setup`) creates the initial org and admin user. Platform admins provision additional orgs via `/v1/platform/orgs`. Org admins invite members through `/v1/orgs/{orgId}/members` and `/v1/orgs/{orgId}/invites`. Users with multiple org memberships switch via the web org switcher or `POST /v1/auth/active-org`. Shared channel bots (Telegram/WhatsApp) will route via `channel_org_mappings`; schema is in place.

**API versioning** — `TINYCLAW_API_VERSION` is returned by `/health`. The server uses it for singleton detection (don't start a duplicate). Clients should reject incompatible versions.

**OpenAPI** — The HTTP surface is generated from Hono route registration in `apps/server/src/http/routes/*` via `apps/server/src/http/openapi.ts` and served at `/openapi.json`. Treat route code as source of truth.

**Offline-friendly startup** — The server starts without an API key. Chat and automation drafting degrade to heuristic fallbacks when no provider is configured.
