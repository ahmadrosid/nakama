# TinyClaw Features

Short guide to what works today.

## Chat

- Talk to the agent from the **CLI** (primary client)
- CLI **auto-starts the server** if it is not already running
- **Streaming** replies over HTTP
- Works **offline** without an API key (limited responses)
- Switch models at runtime (`/model` in CLI, or API)

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
| `bash` | Run a shell command (Super Bot only) |

When the model needs a tool, the server sends **native tool definitions** to OpenAI or Anthropic. The model returns structured tool calls; the server executes them and continues the conversation. Streaming clients receive `tool_start` and `tool_end` SSE events while tools run.

## Automations

- Draft automations from natural language (`/create` in CLI)
- LLM returns a JSON automation with steps that reference tools
- **Not executed yet** — drafting only

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

## Not yet

- Web / Telegram clients
- Running automations on a schedule
- User approval before Super Bot creates bots

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details.
