# Overview

TinyClaw is a self-hosted AI agent platform for teams.

The easiest way to think about it:

- One TinyClaw server can host many organizations
- Each organization can have many members
- Each organization can have many profiles
- Each profile is a bot with its own behavior, memory, and tool access

## Core mental model

If you are using TinyClaw, most of the product can be understood through these four ideas.

### 1. Organization

An organization is the main boundary in TinyClaw.

It keeps one team's data separate from another team's data, including:

- Members
- Profiles
- Sessions
- Tools
- Skills
- MCP servers
- Usage data

### 2. Profile

A profile is the bot users talk to.

It defines:

- The bot's identity
- The bot's instructions
- Which model it uses
- Which tools it may call
- Which knowledge base it can search

If two profiles should behave differently, make two profiles.

### 3. Tool access

Profiles do not automatically get every capability.

You choose which tools a profile can use, such as:

- Web search
- File access
- Knowledge base search
- Email
- Skill creation

This is how you keep one bot safe and narrow while another bot can be more capable.

### 4. Channels

The same TinyClaw profile can be used from different places:

- Web dashboard
- CLI
- Telegram
- WhatsApp

## Typical setup

Most deployments follow this pattern:

1. Create the first organization
2. Add members
3. Create one or more profiles
4. Assign tools to each profile
5. Upload knowledge base documents if needed
6. Let users chat with the right profile

## Who TinyClaw is for

TinyClaw is a good fit when you want:

- Your own hosted agent system
- Multiple bots with different behavior
- Team or tenant separation
- Control over tools and model access
- Web and messaging channels on top of one backend

It is less about writing prompts manually and more about operating a small agent platform for yourself or your team.

## Next steps

- [Multi-tenancy](/multi-tenancy) — org model, members, and roles
- [Profiles](/profiles) — how each bot is defined
- [Builtin tools](/builtin-tools) — what profiles can do
- [MCP servers](/mcp) — extend profiles with external tools
