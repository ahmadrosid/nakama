# AI agents that work with your team

Give each agent a role, assign tools and memory, and run your whole nakama from one self-hosted deployment.

Set up the server once, create organizations and profiles, give each agent its role, and let people collaborate with the right member of your nakama for each task.

Nakama can run locally with Bun, in Docker, or on [managed hosting](https://getnakama.cloud/).

## Managed hosting

If you do not want to run your own server, use [Nakama Cloud](https://getnakama.cloud/). Sign up, create an instance, and open your dedicated URL (for example `acme.getnakama.cloud`). The first 24 hours are free with no credit card required. Complete Nakama's first-time setup wizard in the browser and you are live.

## Before you start

You need:

- An LLM provider API key
- [Bun](https://bun.sh) if you want to run from source (not needed for [managed hosting](https://getnakama.cloud/) or Docker)

## Run locally

Clone the repository and install dependencies:

```bash
git clone https://github.com/ahmadrosid/nakama.git
cd nakama
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

On first run, Nakama asks for your provider and API key if they are not configured yet. Settings are saved in `~/.nakama/config.ini`.

## Backup and restore

Platform admins can export local Nakama data from **Agent → System → Data → Export ZIP**.
The export is a `.zip` backup of the configured Nakama data root, which defaults to `~/.nakama` and follows `NAKAMA_CONFIG_DIR` when set.

Importing is a whole-install restore: preview the ZIP first, then confirm restore to replace the current local data root.
Treat export ZIPs as sensitive because they can include provider settings, auth data, org/profile workspaces, custom tools, skills, and the local SQLite database when it lives under the Nakama root.

## Docker

If you want a simpler deployment path, run Nakama with Docker.

Quickest option:

```bash
docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-config:/root/.nakama ghcr.io/ahmadrosid/nakama:latest
```

Build it yourself:

```bash
./scripts/docker-build.sh
docker run -d -p 4310:4310 -v nakama-config:/root/.nakama nakama
```

With Docker, the app is available at `http://localhost:4310`.

## First-time setup

After Nakama is running:

1. Open the dashboard
2. Create the first admin account and first organization
3. Configure your model provider
4. Create or review profiles
5. Invite other users if needed

## What you configure in Nakama

Most operators only need to think about four things:

- **Organization**: the tenant boundary
- **Members**: who can access that org
- **Profiles**: the bots people talk to
- **Tools and skills**: what each profile is allowed to do and which workflows it can follow (including bundled skills for memory, artifacts, automations, and skill authoring)

## Integrations

Nakama can expose the same agent runtime through:

- Web dashboard
- CLI — including `bun run dev:cli -- launch` for Codex, Claude Code, or OpenCode ([Coding agent](/coding-agent))
- Telegram
- WhatsApp
- Discord

Enable Telegram, WhatsApp, or Discord from the web app settings when you are ready.

Nakama can also expose webhook-based notification destinations from the same **Integrations** area.
The first destination type is Telegram, so external apps can send simple notifications into a Telegram group or topic through Nakama.

To create a Telegram notification destination, just copy the Telegram topic share link, such as `https://t.me/c/3734526664/147`, and paste it into Nakama. Nakama will extract the Chat ID and Topic ID for you automatically.

Telegram replies support normal Markdown for emphasis, code, headings, short lists, and simple links.
If you want Telegram voice notes to work, also open **Settings** and choose an OpenAI **Audio transcription model**.
WhatsApp supports direct-chat setup through the linked-device flow with QR or pairing code.
Discord supports DM pairing, server channels, threads, and slash commands. Enable **Message Content Intent** in the Discord Developer Portal for guild messages.

### Telegram group setup

If you want to use Nakama in Telegram groups:

1. Link each Telegram user in a private chat, or add their numeric user ID under **Integrations → Telegram → Allowed users**.
2. In `@BotFather`, disable **Group Privacy** for the bot if you want `@mentions` to work reliably.
3. If you changed Group Privacy, remove the bot from the group and add it back so Telegram applies the new setting.

Nakama still filters group messages locally, so even with privacy disabled it only responds to slash commands, replies to the bot, and real bot mentions.

For the full Telegram guide, see [Telegram](/telegram).
For the full WhatsApp guide, see [WhatsApp](/whatsapp).
For the full Discord guide, see [Discord](/discord).

## Next steps

- [Overview](/overview) — what Nakama is and how to think about it
- [Telegram](/telegram) — use cases, setup, groups, and troubleshooting
- [WhatsApp](/whatsapp) — direct chat setup, pairing, and troubleshooting
- [Discord](/discord) — bot setup, pairing, servers, and troubleshooting
- [Multi-tenancy](/multi-tenancy) — how orgs, members, and roles work
- [Profiles](/profiles) — how to define each bot
- [Builtin tools](/builtin-tools) — what bots can do
- [MCP servers](/mcp) — extend bots with external tools
