<p align="center"> <img alt="Nakama logo" src="nakama.png" width="188"> </p>

# Nakama

> Deploy your own AI Agent platform as easily as spinning up WordPress.

[Documentation](https://ahmadrosid.github.io/nakama/)

Nakama is a small, self-hosted Bun + TypeScript monorepo for running AI agents. 

Inspired by [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes Agent](https://github.com/nousresearch/hermes-agent) — same self-hosted agent idea (tools, channels, soul, automations) — but **multi-tenant by design**. Those projects target one operator on one machine; Nakama is one server, many orgs, with isolated profiles, sessions, member invites, and roles built in.

![Demo](./nakama-demo.png)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, or the [docs site](https://ahmadrosid.github.io/nakama/) for the full guide.

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

You can also run Nakama with Docker.

**Prebuilt image (quickest):**

```bash
# Pull and run the latest image
docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-config:/root/.nakama ghcr.io/ahmadrosid/nakama:latest
```

**Build from source:**

```bash
# Build the image
docker build --platform=linux/amd64 -t nakama .

# Run the container
docker run -d -p 4310:4310 -v nakama-config:/root/.nakama nakama
```

The dashboard will be available at http://localhost:4310.

### Integrations

Nakama integrates with **Telegram** and **WhatsApp**. Enable them in the web app under **Integrations**.

On first run, the server prompts for a provider and API key if none is configured. Settings are saved to `~/.nakama/config.ini`.

The server listens on `http://127.0.0.1:4310` by default. Interactive API docs are available at `http://127.0.0.1:4310/docs`.

## License

MIT
