# TinyClaw Architecture

TinyClaw is a personal AI assistant: one agent runtime, multiple thin clients. Users chat with configurable bots, draft automations, and (eventually) run them. Everything funnels through a single HTTP server; clients do not embed agent logic.

For what works today, see [FEATURES.md](./FEATURES.md). For HTTP routes, see `apps/server/openapi.json` or `/openapi.json` at runtime.

## System overview

```mermaid
flowchart TB
  subgraph clients ["Thin clients"]
    cli["apps/cli"]
  end

  subgraph sdk ["@tinyclaw/client"]
    httpSdk["HTTP SDK"]
  end

  subgraph server ["apps/server — agent runtime"]
    app["app.ts — HTTP / SSE"]
    agentSvc["AgentService"]
    profileSvc["ProfileService"]
    resolver["tool-resolver"]
    handlers["Tool handlers<br/>builtin · bash · super-bot"]
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
    sqlite[("SQLite<br/>profiles · tools · sessions")]
    config["~/.tinyclaw/config.ini"]
  end

  cli --> httpSdk
  httpSdk -->|"HTTP / SSE"| app
  app --> agentSvc
  app --> profileSvc
  agentSvc --> agent
  agentSvc --> resolver
  resolver --> handlers
  agentSvc --> providers
  agentSvc --> memory
  profileSvc --> dbPkg
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
│   ├── cli/                 # Terminal client (primary); auto-starts server
│   └── server/              # HTTP API, agent runtime, LLM providers, openapi.json, scripts/
├── packages/
│   ├── core/                # Config, API types, provider interfaces, builtin tools
│   ├── agent/               # Chat harness, tool loop, automation engine
│   ├── db/                  # SQLite via bun:sqlite
│   └── client/              # HTTP SDK for apps
```

**Where is the thing that does X?**

| Question | Look in |
|----------|---------|
| HTTP routing | `app.ts` in `apps/server` |
| Session lifecycle, model switching | `AgentService` |
| Profile and tool CRUD | `ProfileService` |
| Resolving which tools a session may call | `tool-resolver.ts` |
| Super Bot meta-tools, bash | `super-bot-tools.ts`, `bash.ts` |
| LLM vendor calls | `providers/` in `apps/server` |
| Chat, streaming, tool loop | `AgentHarness`, `AgentChatSession` in `@tinyclaw/agent` |
| SQLite schema (`packages/db/sql/schema.sql`) | `@tinyclaw/db` |
| CLI server discovery / spawn | `ensure-server.ts` in `apps/cli` |
| Shared request/response types | `@tinyclaw/core` (`contract.ts`) |
| OpenAPI generation | `openapi/build-spec.ts` in `apps/server` |

Use symbol search for exact paths — names are stable; line numbers are not.

## Architectural invariants

**One agent runtime.** Chat and automation drafting run only in `apps/server`. No client talks to OpenAI or Anthropic directly.

**Hub and spoke.** New channels are thin apps on `@tinyclaw/client`. There is no second agent implementation per channel.

**Packages do not depend on apps.** `packages/*` must not import from `apps/*`. Shared code flows packages → apps, never the reverse.

**Providers are server-only.** OpenAI and Anthropic adapters live under `apps/server/src/providers/`, not in `@tinyclaw/core` or `@tinyclaw/agent`.

**Profiles gate behavior.** A session binds to a profile (`profile_default` when omitted). The profile supplies the system prompt and tool allowlist before any message is handled.

**Chat history is in-memory.** `AgentChatSession` holds `ChatMessage[]` in the server process. SQLite stores profiles, tools, session metadata — not message bodies.

**Tools are allowlisted per profile.** The model may only invoke tools assigned to the active profile. Super Bot gets extra runtime tools (meta-tools, `bash`) injected server-side for `profile_super_bot`.

**Tool calls use native LLM function calling.** Allowed tools are sent to OpenAI or Anthropic as structured definitions with JSON Schema parameters. The model returns tool calls; the server executes handlers and feeds results back as tool messages. Streaming clients receive `tool_start` / `tool_end` SSE events during execution.

## Boundaries

See the [system overview](#system-overview) diagram for the full topology. At a high level:

**Client ↔ server.** `@tinyclaw/client` knows session IDs and API shapes from `@tinyclaw/core`. It has no visibility into providers, profiles beyond the API, or the tool loop.

**Server ↔ agent package.** `AgentService` owns the session map and delegates to `AgentHarness`. The harness depends on `Provider` from `@tinyclaw/core`, not on HTTP or SQLite.

**Server ↔ database.** Profiles, tools, profile–tool links, session rows, and automations schema persist in SQLite. Live chat state does not cross this boundary.

**Agent ↔ tools.** The harness asks the model; the server resolves and runs handlers. Builtin tools come from `@tinyclaw/core`; server-specific handlers (bash, Super Bot meta-tools) are registered in `apps/server`.

## Cross-cutting concerns

**Configuration** — API key and model live in `~/.tinyclaw/config.ini`, or via `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (OpenAI preferred when both are set). Provider is inferred automatically. Loaded through `@tinyclaw/core`. The server writes `~/.tinyclaw/runtime/server-url.txt` so clients can find it.

**IDs** — Entities use prefixed IDs via `createId()` (e.g. `session_…`, `profile_…`).

**API versioning** — `TINYCLAW_API_VERSION` is returned by `/health`. The server uses it for singleton detection (don't start a duplicate). Clients should reject incompatible versions.

**OpenAPI** — The HTTP surface is generated from TypeScript (`openapi/build-spec.ts`). Regenerate with `bun run openapi:generate`. The live server builds the spec at startup; treat code as source of truth, not a stale file on disk.

**Offline-friendly startup** — The server starts without an API key. Chat and automation drafting degrade to heuristic fallbacks when no provider is configured.
