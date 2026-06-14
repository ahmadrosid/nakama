# TinyClaw Features

Short guide to what works today.

## Chat

- Talk to the agent from the **CLI** (primary client)
- CLI **auto-starts the server** if it is not already running
- **Streaming** replies over HTTP
- **Extended thinking** — stream model reasoning separately from the answer (Anthropic adaptive thinking, OpenAI reasoning summaries); enabled by default, configurable in **Settings** or `/thinking` in the CLI
- Works **offline** without an API key (limited responses)
- Switch models at runtime (`/model` in CLI, or API)
- **Image input** (vision) on configured providers:
  - **Web** — attach images in the chat composer
  - **CLI** — `@/path/to/image.png [optional message]`, `/paste` for clipboard images, or Ctrl+V / empty paste when the terminal supports it
  - **Telegram** — send a photo or image document (optional caption)

## LLM providers

TinyClaw currently supports these providers:

- **OpenAI**
- **Anthropic**
- **Google Gemini**
- **OpenRouter**
- **OpenAI-compatible custom providers** via a custom `baseUrl`

Provider selection and API keys can be configured in the web dashboard under **Settings**.

## Bot profiles

A **profile** is a bot config: name, system prompt, and allowed tools.

On first start, two profiles are created:

| Profile | ID | Purpose |
|---------|-----|---------|
| Super Bot | `profile_super_bot` | Creates bots and manages tools |
| Default Bot | `profile_default` | Normal assistant chat |

## Tools

Tools are actions a bot can use (in chat or automations).

**Built-in tools:** `write_file`, `delete_file`, `search_files`, `web_search`

When an OpenAI or Anthropic provider is configured, `web_search` runs natively on the provider with citations. OpenRouter uses the OpenRouter SDK (Chat Completions API, many models via one API key) and supports extended thinking via the `reasoning` parameter when enabled in Settings; native `web_search` is not enabled on OpenRouter yet.

**Super Bot only:** `bash` — run shell commands (stdout, stderr, exit code)

Each profile has its own **tool allowlist**. Super Bot and Default Bot start with all built-ins.

You can also register JavaScript tools. Metadata is stored in the DB, and the module is loaded from `~/.tinyclaw/tools/` at runtime.

## MCP servers

TinyClaw can connect to [Model Context Protocol](https://modelcontextprotocol.io/) servers and expose their tools to assigned profiles.

- **No built-in MCP** — profiles start with zero MCP servers assigned
- **Register servers** in the web UI under **Soul → MCP** (stdio or HTTP transports)
- **Assign per profile** on the **Profiles** page under **Allowed MCP servers**
- Tools from an assigned server are namespaced as `{serverName}__{toolName}` during chat
- Only profiles with an assigned server can call that server's tools

Workflow: register a server → connect/sync to cache its tools → assign the server to a profile → chat with that profile.

## Super Bot

Super Bot is the **orchestrator**. It can manage other bots via meta-tools:

| Tool | What it does |
|------|--------------|
| `list_profiles` | List all bot profiles |
| `get_profile` | Get one profile + its tools |
| `create_profile` | Create a new bot profile |
| `list_tools` | List all tools |
| `create_tool` | Register a new tool |
| `assign_tool_to_profile` | Give a tool to a bot |
| `create_automation` | Save a manual or scheduled automation |
| `list_automations` | List saved automations |
| `delete_automation` | Delete an automation |
| `run_automation` | Trigger a saved automation from chat |
| `bash` | Run a shell command (Super Bot only) |

When the model needs a tool, the server sends **native tool definitions** to OpenAI or Anthropic. The model returns structured tool calls; the server executes them and continues the conversation. Streaming clients receive `tool_start` and `tool_end` SSE events while tools run.

## Automations

- Create automations from chat using the `create_automation` tool
- Trigger automations from chat using the `run_automation` tool
- Draft automations from natural language (`/create` in CLI or Automations page)
- Save, edit, enable/disable, and delete automations via API or web UI
- **Manual trigger** — run on demand from the web UI, API, or `run_automation` in chat
- **Schedule trigger** — standard 5-field cron (e.g. `0 8 * * *`), with an optional per-automation timezone (otherwise your timezone from **Settings**)
- **Scheduled runs** — while the server is running, an in-process scheduler registers cron jobs for every enabled automation with a `schedule` trigger; the job list reloads when automations change
- Each run re-executes the stored prompt through the agent so it can choose tools dynamically
- Run history is stored in SQLite
- **Status** page (`/status` in the web UI) shows scheduler health (scheduled job count, active automation runs)

Scheduled automations only fire while the TinyClaw server process is up (there is no separate background worker).

## Storage

Data is saved in **SQLite** (default: `data/sqlite/tinyclaw.sqlite`).

| Stored |
|--------|
| Profiles |
| Tools |
| MCP servers |
| Profile ↔ tool links |
| Profile ↔ MCP server links |
| Session metadata |
| Chat message history |
| Automations |
| Automation run history |

Migrations run automatically when the server starts.

## API

Routes and schemas live in the OpenAPI spec:

- **File:** `apps/server/openapi.json` (regenerate with `bun run openapi:generate`)
- **Live:** `GET /openapi.json` on the running server
- **Browse:** [http://127.0.0.1:4310/docs](http://127.0.0.1:4310/docs) or `bun run dev:docs` → [http://127.0.0.1:4320](http://127.0.0.1:4320)

## Telegram

- Chat from Telegram via a thin bridge (`apps/platform/telegram`)
- Uses the same server sessions and history as CLI/web (`channel: "telegram"`)
- Link your account with a one-time **pairing code** from **Settings → Telegram** (no manual user ID required)
- Optional pre-approved user IDs for power users
- Configure token and profile from the web UI (saved to `~/.tinyclaw/telegram/config.ini`)
- Start with `bun run dev:telegram` (see [apps/platform/telegram/README.md](./apps/platform/telegram/README.md))

## Not yet

- User approval before Super Bot creates bots

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details.
