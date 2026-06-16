<p align="center"> <img alt="TinyClaw logo" src="tinyclaw.png" width="188"> </p>
# TinyClaw

> Deploy your own personal AI Assistant as easy as using WordPress.

A tiny, working Bun + TypeScript monorepo for running your own AI agent. Chat, create automations from natural language, and connect via web, CLI, Telegram, or WhatsApp — all through one server.

![Demo](./tinyclaw-demo.png)

Inspired by [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes](https://github.com/nousresearch/hermes-agent).

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, package layout, and data flows

## Quick start

Requires [Bun](https://bun.sh).

```bash
# Install dependencies
bun install

# Start the web (starts the server automatically if needed)
bun run dev:web
```

Visit web dashboard: http://localhost:3000

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

### WhatsApp

Configure it in **Settings → WhatsApp**, then run:

```bash
bun run dev:whatsapp
```

Save your phone number, generate the pairing code, then enter it in WhatsApp under **Settings → Linked Devices → Link with phone number**.

See [apps/platform/whatsapp/README.md](./apps/platform/whatsapp/README.md) for bridge details.

On first run, the server prompts for a provider and API key if none is configured. Settings are saved to `~/.tinyclaw/config.ini`.

The server listens on `http://127.0.0.1:4310` by default. Interactive API docs are available at `http://127.0.0.1:4310/docs`.

## License

MIT
