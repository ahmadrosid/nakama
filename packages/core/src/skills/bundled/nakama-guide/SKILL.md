---
name: nakama-guide
description: Map of the Nakama web app — each page, its path, what it controls, and who can open it. Use when the user asks where or how to find, set, or change something in Nakama itself (models, providers, image generation, tools, skills, members, channels, settings).
---

# Nakama guide

Use this map when the user asks where something is in Nakama. Do not guess from other web apps.

## How to answer

1. Name the real path, for example **Settings → AI Providers**, and give the page link. In web chat, write a Markdown link with the path, for example [AI Providers](/settings/providers). It opens the page in the same tab. To point to one card on AI Providers, add its anchor: `#image-parsing`, `#transcription`, `#image-generation`, `#web-search`, or `#browser-runtime`, for example [Image generation model](/settings/providers#image-generation). In Telegram, Discord, or WhatsApp, write the path as plain text.
2. Say who can change it. If the page needs a platform admin, say that a platform admin must make the change.
3. Give one or two steps, not a generic walkthrough.
4. If the setting is not on this map, read the docs with `web_fetch` on `https://ahmadrosid.github.io/nakama/llms.txt` before you answer.

## Layout

- **Left rail** (far left): profile avatars to switch agent. At the bottom: the notifications bell and the account avatar.
- **Account avatar menu** (bottom left): Profile, Personalisation, Organization, Theme, Log out. It has no Settings item.
- **Sidebar**: organization switcher at the top, then New chat, Agent, Groups, Connections, Automations, Settings, then Recents.
- **Settings** (`/settings`) is the hub for configuration. It groups pages into Workspace, Agent tools, Integrations, and Installed plugins.

## Roles

- **Platform admin**: runs the Nakama install. Only role that can open AI Providers, Skills, and MCP.
- **Org admin**: manages one organization.
- **Member** and **viewer**: org roles with less access. Viewers cannot use Groups, Google Meet, Organization, or Browse Files.

## Pages

| Page | Where | Path | What it controls | Who |
|---|---|---|---|---|
| New chat | Sidebar | `/chat` | Start a chat; pick agent, model, and effort in the composer | Everyone |
| Agent | Sidebar | `/profiles` | Agents (profiles): model, instructions, soul, assigned tools, skills, MCP servers, channels (Telegram, Discord, WhatsApp) | Everyone; editing depends on role |
| Groups | Sidebar | `/groups` | Group chats where agents talk to each other | Org admin, member |
| Connections | Sidebar | `/connectors` | Composio apps and per-user OAuth connections | Platform admin, org admin, member |
| Automations | Sidebar | `/automations` | Scheduled automations and their runs | Everyone |
| Settings | Sidebar | `/settings` | Hub for every page below | Everyone (shows only allowed pages) |
| Notifications | Bell, bottom left | `/notifications` | Automation runs and org memory proposals | Everyone |

### Settings → Workspace

| Page | Path | What it controls | Who |
|---|---|---|---|
| Organization | `/organization` | Members, invites, teams, org memory, org settings | Platform admin, org admin, member |
| Browse Files | `/files` | Agent artifacts and workspace files | Platform admin, org admin, member |
| Usage | `/settings/usage` | Token usage and cost | Platform admin, org admin |
| Workers | `/workers` | Automation and channel workers, worker logs | Platform admin, org admin |
| Google Meet | `/google-meet` | Meeting capture and transcripts | Org admin, member |
| Preferences | `/settings/preferences` | Appearance, user context, token usage in chat, version, browser sessions, MFA. Org admin: local API token. Platform admin: Web public URL, Composio, data export | Everyone (sections by role) |

### Settings → Agent tools

| Page | Path | What it controls | Who |
|---|---|---|---|
| AI Providers | `/settings/providers` | Provider API keys and models. Cards: **Image parsing model**, **Audio transcription model**, **Image generation model**, web search, browser runtime | Platform admin only |
| Tools | `/settings/tools` | Built-in and custom tools, tool playground, email mailbox setup | Platform admin, org admin |
| Skills | `/settings/skills` | Organization skill catalog | Platform admin only |
| MCP | `/settings/mcp` | MCP servers | Platform admin only |
| Plugins | `/settings/plugins` | Install and manage plugins | Platform admin, org admin |

### Settings → Integrations

| Page | Path | What it controls | Who |
|---|---|---|---|
| Notifications | `/settings/connections/notifications` | Notification delivery | Platform admin, org admin |
| Composio | `/connectors` | Composio toolkits | Platform admin, org admin, member |
| Coding agents | `/settings/connections/coding-agents` | Codex, Claude Code, OpenCode, pi, Cursor Agent setup | Platform admin, org admin |
| Error tracking | `/settings/connections/error-tracking` | Error tracking | Platform admin only |

## Common questions

| User asks | Answer |
|---|---|
| Set the image generation model | Settings → AI Providers (`/settings/providers`), card **Image generation model**. Platform admin only. The agent also needs the `generate_image` tool (Agent → Tools) |
| Set voice message transcription | Settings → AI Providers, card **Audio transcription model**. Platform admin only |
| Let a text-only model read images | Settings → AI Providers, card **Image parsing model**. Platform admin only |
| Add or fix an API key, reconnect ChatGPT or Grok | Settings → AI Providers. Platform admin only |
| Change an agent's model, tools, or skills | Agent (`/profiles`), pick the agent |
| Connect Telegram, Discord, or WhatsApp | Agent (`/profiles`), pick the agent, open its channels |
| Invite a teammate | Settings → Organization (`/organization`) |
| Change the theme | Account avatar menu → Theme, or Settings → Preferences (`/settings/preferences`) |
