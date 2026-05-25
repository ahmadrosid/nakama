<p align="center">
  <img alt="TinyClaw logo" src="tinyclaw.png" width="256">
</p>

# TinyClaw

TinyClaw is a personal AI assistant built as a tiny Bun + TypeScript monorepo. Prompt the agent in chat, draft automations from natural language, and reach the same agent from multiple channels through one central server.

![Demo](./tinyclaw-demo.png)

Inspired by [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes](https://github.com/nousresearch/hermes-agent).

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

### Telegram

Configure in the web app under **Settings → Telegram**, or use env vars, then run:

```bash
bun run dev:telegram
```

See [apps/platform/telegram/README.md](./apps/platform/telegram/README.md) for setup details.

On first run, the server prompts for a provider and API key if none is configured. Settings are saved to `~/.tinyclaw/config.ini`.

The server listens on `http://127.0.0.1:4310` by default. See [FEATURES.md](./FEATURES.md#api) for interactive API docs.

## License

MIT
