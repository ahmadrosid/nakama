# Overview

Nakama is an open-source platform for building teams of AI agents.

Every agent has a role. Together, they're your nakama.

The easiest way to think about it:

- One Nakama server can host many organizations
- Each organization can have many members
- Each organization can have many profiles
- Each profile is a bot with its own behavior, memory, and tool access

## Core mental model

If you are using Nakama, most of the product can be understood through these four ideas.

### 1. Organization

An organization is the main boundary in Nakama.

It keeps one team's data separate from another team's data, including:

- Members
- Profiles
- Sessions
- Tools
- Skills
- MCP servers
- Usage data

### 2. Profile

A profile is an agent on your team — the bot users talk to.

Each profile has a role. It defines:

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

The same Nakama profile can be used from different places:

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

## Who Nakama is for

Nakama is a good fit when you want:

- A team of AI agents, not a single general-purpose assistant
- Each agent with a distinct role, tools, and behavior
- Your own open-source, self-hosted agent platform
- Team or tenant separation across organizations
- Web and messaging channels on top of one backend

It is less about writing one prompt and more about assembling and operating your nakama.

## Next steps

- [Multi-tenancy](/multi-tenancy) — org model, members, and roles
- [Profiles](/profiles) — how each bot is defined
- [Builtin tools](/builtin-tools) — what profiles can do
- [MCP servers](/mcp) — extend profiles with external tools
