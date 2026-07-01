# Getting Started

TinyClaw can run locally with Bun or in Docker.

## Why TinyClaw exists?

TinyClaw makes setting up an AI agent as easy as running a WordPress site — self-hosted and managed without a team of engineers.

Where OpenClaw and Hermes serve personal assistants, TinyClaw is built for **team assistants** — agents that work alongside a whole team, not a single person.

Multi-tenant by default: each organization is an isolated boundary with its own profiles, members, tools, and memory. One deployment can serve many clients — agencies and service companies get a separate org, agents, and data per client.

## Before you start

You need:

- An LLM provider API key
- [Bun](https://bun.sh) if you want to run from source

## Run locally

Clone the repository and install dependencies:

```bash
git clone https://github.com/ahmadrosid/tinyclaw.git
cd tinyclaw
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

## Backup and restore

Platform admins can export local TinyClaw data from **Agent → System → Data → Export ZIP**.
The export is a `.zip` backup of the configured TinyClaw data root, which defaults to `~/.tinyclaw` and follows `TINYCLAW_CONFIG_DIR` when set.

Importing is a whole-install restore: preview the ZIP first, then confirm restore to replace the current local data root.
Treat export ZIPs as sensitive because they can include provider settings, auth data, org/profile workspaces, custom tools, skills, and the local SQLite database when it lives under the TinyClaw root.

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

Telegram replies support normal Markdown for emphasis, code, headings, short lists, and simple links.
WhatsApp supports direct-chat setup through the linked-device flow with QR or pairing code.

### Telegram group setup

If you want to use TinyClaw in Telegram groups:

1. Link your Telegram account to the bot in a private chat first.
2. In `@BotFather`, disable **Group Privacy** for the bot if you want `@mentions` to work reliably.
3. If you changed Group Privacy, remove the bot from the group and add it back so Telegram applies the new setting.

TinyClaw still filters group messages locally, so even with privacy disabled it only responds to slash commands, replies to the bot, and real bot mentions.

For the full Telegram guide, see [Telegram](/telegram).
For the full WhatsApp guide, see [WhatsApp](/whatsapp).

## Next steps

- [Overview](/overview) — what TinyClaw is and how to think about it
- [Telegram](/telegram) — use cases, setup, groups, and troubleshooting
- [WhatsApp](/whatsapp) — direct chat setup, pairing, and troubleshooting
- [Multi-tenancy](/multi-tenancy) — how orgs, members, and roles work
- [Profiles](/profiles) — how to define each bot
- [Builtin tools](/builtin-tools) — what bots can do
- [MCP servers](/mcp) — extend bots with external tools
