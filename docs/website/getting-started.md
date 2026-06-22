# Getting Started

TinyClaw can run locally with Bun or in Docker.

## Before you start

You need:

- An LLM provider API key
- [Bun](https://bun.sh) if you want to run from source

## Run locally

```bash
bun install
bun run dev:web
```

Open:

- Dashboard: `http://localhost:3000`
- API server: `http://127.0.0.1:4310`
- API docs: `http://127.0.0.1:4310/docs`

If you only want the API server:

```bash
bun run dev:server
```

On first run, TinyClaw asks for your provider and API key if they are not configured yet. Settings are saved in `~/.tinyclaw/config.ini`.

## Docker

If you want a simpler deployment path, run TinyClaw with Docker.

Quickest option:

```bash
docker pull ghcr.io/ahmadrosid/tinyclaw:latest
docker run -d -p 4310:4310 -v tinyclaw-config:/root/.tinyclaw ghcr.io/ahmadrosid/tinyclaw:latest
```

Build it yourself:

```bash
docker build --platform=linux/amd64 -t tinyclaw .
docker run -d -p 4310:4310 -v tinyclaw-config:/root/.tinyclaw tinyclaw
```

With Docker, the app is available at `http://localhost:4310`.

## First-time setup

After TinyClaw is running:

1. Open the dashboard
2. Create the first admin account and first organization
3. Configure your model provider
4. Create or review profiles
5. Invite other users if needed

## What you configure in TinyClaw

Most operators only need to think about four things:

- **Organization**: the tenant boundary
- **Members**: who can access that org
- **Profiles**: the bots people talk to
- **Tools**: what each profile is allowed to do

## Integrations

TinyClaw can expose the same agent runtime through:

- Web dashboard
- CLI
- Telegram
- WhatsApp

Enable Telegram or WhatsApp from the web app settings when you are ready.

## Next steps

- [Overview](/overview) — what TinyClaw is and how to think about it
- [Multi-tenancy](/multi-tenancy) — how orgs, members, and roles work
- [Profiles](/profiles) — how to define each bot
- [Builtin tools](/builtin-tools) — what bots can do
- [MCP servers](/mcp) — extend bots with external tools
