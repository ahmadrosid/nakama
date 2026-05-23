# TinyClaw

TinyClaw is a personal AI assistant built as a tiny Bun + TypeScript monorepo. Prompt the agent in chat, draft automations from natural language, and reach the same agent from multiple channels through one central server.

Inspired by [OpenClaw](https://github.com/openclaw/openclaw).

- [FEATURES.md](./FEATURES.md) — what works today (chat, profiles, tools, API, storage)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, package layout, and data flows

## Quick start

Requires [Bun](https://bun.sh).

```bash
# Install dependencies
bun install

# Start the CLI (starts the server automatically if needed)
bun run dev:cli
```

Or run the server on its own:

```bash
bun run dev:server
```

On first run, the server prompts for a provider and API key if none is configured. Settings are saved to `~/.tinyclaw/config.ini`.

The server listens on `http://127.0.0.1:4310` by default. See [FEATURES.md](./FEATURES.md#api) for interactive API docs.

## CLI commands

| Command | Description |
|---------|-------------|
| `/help` | List commands |
| `/clear` | Clear chat history |
| `/models` | List available models |
| `/model [id]` | Show or switch model |
| `/create [prompt]` | Draft an automation from a prompt |
| `/exit` | Quit |

Type `/` to see filtered suggestions. Use ↑/↓ to navigate, Enter to select, Tab to fill the input.

## Configuration

Provider, API key, and model live in `~/.tinyclaw/config.ini`, or set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the environment (OpenAI is preferred when both are set). See [ARCHITECTURE.md](./ARCHITECTURE.md#cross-cutting-concerns) for paths, runtime discovery, and versioning.

### User config (`~/.tinyclaw/config.ini`)

```ini
api_key=sk-...
model=gpt-5.4
```

The provider is inferred from the API key (`sk-ant-…` → Anthropic, otherwise OpenAI). An optional `provider=` line is still supported for older configs.

## License

MIT
