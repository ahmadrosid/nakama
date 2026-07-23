<p align="center"> <img alt="Nakama logo" src="nakama.png" width="188"> </p>

# Nakama

> Deploy your own AI Agent platform as easily as spinning up WordPress.

[Documentation](https://docs.getnakama.com/) · [Managed hosting](https://getnakama.cloud/)

Nakama is a small, self-hosted Bun + TypeScript monorepo for running AI agents. Prefer not to run your own server? Use [managed hosting at getnakama.cloud](https://getnakama.cloud/) — sign up, create an instance, and open your dedicated URL (for example `acme.getnakama.cloud`). The first 24 hours are free with no credit card required.

Inspired by [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes Agent](https://github.com/nousresearch/hermes-agent) — same self-hosted agent idea (tools, channels, soul, automations) — but **multi-tenant by design**. Those projects target one operator on one machine; Nakama is one server, many orgs, with isolated profiles, sessions, member invites, and roles built in.

![Demo](./nakama_demo.png)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, or the [docs site](https://docs.getnakama.com/) for the full guide.

## Quick start

### Managed hosting

The fastest way to try Nakama is [Nakama Cloud](https://getnakama.cloud/). Create an account, provision an instance, complete the first-time setup wizard in the browser, and you are live — no Bun, Docker, or VPS required.

### Run locally

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
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama ghcr.io/ahmadrosid/nakama:latest
```

**Build from source:**

```bash
./scripts/docker-build.sh
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama nakama
```

**Fresh start:**

```bash
./scripts/docker-reset.sh
./scripts/docker-build.sh
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama nakama
```

The dashboard will be available at http://localhost:4310.

### Integrations

Nakama integrates with **Telegram**, **WhatsApp**, and **Composio** (SaaS app connections). Enable them in the web app under **Integrations**.

For Composio, save your API key under **Integrations → Composio** (stored in `~/.nakama/composio/config.ini`). Org admins connect OAuth apps on Integrations; assign toolkits per profile on **Profiles**.

On first run, the server prompts for a provider and API key if none is configured. Settings are saved to `~/.nakama/config.ini`.

The server listens on `http://127.0.0.1:4310` by default. Interactive API docs are available at `http://127.0.0.1:4310/docs`.

## License

MIT
