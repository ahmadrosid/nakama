# TinyClaw Features

Short guide to what works today.

## Chat

- Talk to the agent from the **CLI** (primary client)
- CLI **auto-starts the server** if it is not already running
- **Streaming** replies over HTTP
- Works **offline** without an API key (limited responses)
- Switch models at runtime (`/model` in CLI, or API)
- **Image input** (vision) on configured providers:
  - **Web** — attach images in the chat composer
  - **CLI** — `@/path/to/image.png [optional message]`, `/paste` for clipboard images, or Ctrl+V / empty paste when the terminal supports it
  - **Telegram** — send a photo or image document (optional caption)

## Bot profiles

A **profile** is a bot config: name, system prompt, and allowed tools.

On first start, two profiles are created:

| Profile | ID | Purpose |
|---------|-----|---------|
| Super Bot | `profile_super_bot` | Creates bots and manages tools |
| Default Bot | `profile_default` | Normal assistant chat |

Start a session with a profile:

```json
POST /v1/sessions
{ "channel": "cli", "profileId": "profile_super_bot" }
```

If you omit `profileId`, it uses **Default Bot**.

## Tools

Tools are actions a bot can use (in chat or automations).

**Built-in tools:** `write_file`, `delete_file`, `web_search`

When an OpenAI or Anthropic provider is configured, `web_search` runs natively on the provider with citations.

**Super Bot only:** `bash` — run shell commands (stdout, stderr, exit code)

Each profile has its own **tool allowlist**. Super Bot and Default Bot start with all built-ins.

You can also register JavaScript tools. Metadata is stored in the DB, and the module is loaded from `~/.tinyclaw/tools/` at runtime.

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
| `bash` | Run a shell command (Super Bot only) |

When the model needs a tool, the server sends **native tool definitions** to OpenAI or Anthropic. The model returns structured tool calls; the server executes them and continues the conversation. Streaming clients receive `tool_start` and `tool_end` SSE events while tools run.

## Automations

- Create automations from chat using the `create_automation` tool
- Draft automations from natural language (`/create` in CLI or Automations page)
- Save, edit, enable/disable, and delete automations via API or web UI
- Run automations manually or on a timezone-aware cron schedule
- Each run re-executes the stored prompt through the agent so it can choose tools dynamically
- Run history is stored in SQLite

## Storage

Data is saved in **SQLite** (default: `data/sqlite/tinyclaw.sqlite`).

| Stored |
|--------|
| Profiles |
| Tools |
| Profile ↔ tool links |
| Session metadata |
| Chat message history |
| Automations (schema ready) |

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

- Running automations on a schedule
- User approval before Super Bot creates bots

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details.
