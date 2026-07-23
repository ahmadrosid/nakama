# Nakama Documentation

Nakama is a multi-tenant platform for teams of AI agents. Each profile is a bot with its own role, soul, tools, and memory — exposed through the web dashboard, CLI, Telegram, WhatsApp, or Discord from one deployment.

## Quick start

Pick the fastest path for you:

```bash
# Managed hosting — no install (recommended)
# Sign up at https://getnakama.cloud/ and open your instance URL

# Docker — single container
docker pull ghcr.io/ahmadrosid/nakama:latest
docker run -d -p 4310:4310 -v nakama-data:/nakama/data --name nakama ghcr.io/ahmadrosid/nakama:latest

# Local development — from source
git clone https://github.com/ahmadrosid/nakama.git && cd nakama
bun install && bun run dev:web
```

Then open the dashboard, complete the setup wizard, and send your first message. See [Quickstart](/quickstart) for the full first-run flow.

## Start here

- [Quickstart](/quickstart) — install, open the dashboard, and send your first message
- [Overview](/overview) — organizations, profiles, tools, and channels
- [First-time setup](/first-time-setup) — admin account, org, provider, and profiles
- [Providers](/providers) — LLM API keys and model configuration

## Deploy

- [Quickstart](/quickstart) — local development with Bun
- [Docker](/docker) — production-style single-container deployment
- [Managed hosting](https://getnakama.cloud/) — sign up and open your dedicated URL
- [Backup and restore](/backup-restore) — export and restore your Nakama data root

## Concepts

- [Multi-tenancy](/multi-tenancy) — organizations, members, roles, and tenant isolation
- [Profiles](/profiles) — soul files, memory, tools, and model selection
- [Agent prompts](/agent-prompt) — how Nakama builds the system prompt each turn

## Channels

- [Telegram](/telegram) — bot setup, pairing, groups, and troubleshooting
- [WhatsApp](/whatsapp) — direct chat linking, commands, and troubleshooting
- [Discord](/discord) — bot setup, pairing, slash commands, and servers

## Extend

- [Builtin tools](/builtin-tools) — file access, web search, email, bash, and more
- [Skills](/skills) — reusable workflows including memory, artifacts, and automations
- [Integrations](/integrations) — dashboard settings for channels and external providers
- [Coding agent](/coding-agent) — Codex, Claude Code, or OpenCode from chat or CLI
- [Agent browser](/agent-browser) — interactive browser automation for login-walled sites
- [MCP servers](/mcp) — connect external tool providers
- [Composio](/composio) — SaaS OAuth and toolkit assignment

## Reference

- [llms.txt](/llms.txt) — documentation index for AI agents and tooling
- [GitHub repository](https://github.com/ahmadrosid/nakama) — source code and issues
