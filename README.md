<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/nakama-logo-dither-dark.png" />
    <img alt="Nakama logo" src="assets/nakama-logo-dither-light.png" width="188" />
  </picture>
</p>

<p align="center">
  <a href="https://discord.gg/qhKbMFEUc"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

# Nakama

[Documentation](https://ahmadrosid.github.io/nakama/) · [Demo](https://demo.getnakama.cloud) · [Managed hosting](https://getnakama.cloud/)

Your next hire will still be human.
With Nakama, that person works on important tasks.
The AI agents do the trivial tasks.

Nakama is a small, self-hosted service for AI agents. You can imagine that nakama is like [OpenClaw](https://github.com/openclaw/openclaw) and [Hermes Agent](https://github.com/nousresearch/hermes-agent) but it design to work with your teams.

- Nakama is multi-tenant by design.
- Those projects serve one operator on one machine.
- Nakama is one server for many orgs.
- Each org has isolated profiles, sessions, member invites, and roles.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/nakama_demo_dark.png" />
  <img alt="Nakama dashboard demo" src="assets/nakama_demo_light.png" />
</picture>

Open [ARCHITECTURE.md](./ARCHITECTURE.md) for the system design.
Open the [docs site](https://ahmadrosid.github.io/nakama/) for the full guide.

## Quick start

### Try the demo

Open the live demo at [https://demo.getnakama.cloud](https://demo.getnakama.cloud).

- Username: `demo@getnakama.cloud`
- Password: `demo1234`

### Managed hosting

Use [Nakama Cloud](https://getnakama.cloud/) to try Nakama with the least work.

1. Create an account.
2. Provision an instance.
3. Complete the first-time setup wizard in the browser.

You do not need Bun, Docker, or a VPS.

### Run locally

You need [Bun](https://bun.sh).

```bash
# Install dependencies
bun install

# Start the web (starts the server automatically if needed)
bun run dev:web
```

Open the web dashboard: http://localhost:3000

Or start the server alone:

```bash
bun run dev:server
```

### Docker

You can also run Nakama with Docker.

**Prebuilt image (fastest):**

```bash
# Pull and run the latest image
docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama ghcr.io/ahmadrosid/nakama:latest
```

**Build from source:**

```bash
./scripts/docker-build-run.sh
```

**Fresh start:**

```bash
./scripts/docker-destroy.sh
./scripts/docker-build-run.sh
```

Open the dashboard at http://localhost:4310.

### Integrations

Nakama connects to **Telegram**, **WhatsApp**, and **Composio**.
With Composio, you can connect to more than 1,000 external apps.
Enable them in the web app under **Integrations**.

On the first run, the server asks for a provider and an API key if none is configured.
The server saves settings to `~/.nakama/config.ini`.

The server listens on `http://127.0.0.1:4310` by default.
Interactive API docs are at `http://127.0.0.1:4310/docs`.

## License

MIT
