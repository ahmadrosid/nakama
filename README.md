<p align="center"> <img alt="TinyClaw logo" src="tinyclaw.png" width="188"> </p>

# TinyClaw

> Deploy your own AI Agent platform as easily as spinning up WordPress.

TinyClaw is a small, self-hosted Bun + TypeScript monorepo for running AI agents. 

Inspired by [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes Agent](https://github.com/nousresearch/hermes-agent) — same self-hosted agent idea (tools, channels, soul, automations) — but **multi-tenant by design**. Those projects target one operator on one machine; TinyClaw is one server, many orgs, with isolated profiles, sessions, member invites, and roles built in.

![Demo](./tinyclaw-demo.png)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design and data flows.

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

### Docker

You can also run TinyClaw with Docker.

**Prebuilt image (quickest):**

```bash
# Pull and run the latest image
docker pull ghcr.io/ahmadrosid/tinyclaw:latest
docker run -d -p 4310:4310 -v tinyclaw-config:/root/.tinyclaw ghcr.io/ahmadrosid/tinyclaw:latest
```

**Build from source:**

```bash
# Build the image
docker build --platform=linux/amd64 -t tinyclaw .

# Run the container
docker run -d -p 4310:4310 -v tinyclaw-config:/root/.tinyclaw tinyclaw
```

The dashboard will be available at http://localhost:4310.

### Integrations

TinyClaw integrates with **Telegram** and **WhatsApp**. Enable them in the web app under **Settings → Telegram** or **Settings → WhatsApp**.

On first run, the server prompts for a provider and API key if none is configured. Settings are saved to `~/.tinyclaw/config.ini`.

The server listens on `http://127.0.0.1:4310` by default. Interactive API docs are available at `http://127.0.0.1:4310/docs`.

## License

MIT
