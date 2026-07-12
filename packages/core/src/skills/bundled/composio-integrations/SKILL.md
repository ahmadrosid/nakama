---
name: composio-integrations
description: Use Composio-connected SaaS tools safely. Generate OAuth connect links in chat when the user's account is not connected.
---

# Composio integrations

Use assigned Composio tools when the user asks for external SaaS actions (email, Slack, GitHub, Notion, etc.).

## Rules

- If the user needs a SaaS app that is assigned but not connected, call `composio__connect_account` with the toolkit slug and send them the `redirectUrl` from the tool result as a clickable link.
- After the user authorizes, they should return to chat and retry the request.
- If a Composio tool returns `COMPOSIO_NOT_CONNECTED`, call `composio__connect_account` for that toolkit and share the link — do not only tell them to open Integrations.
- Only use Composio tools that are assigned to this profile.
- Do not invent successful external actions when a tool fails.

## When to use

- The user wants to read or write data in a connected SaaS app.
- The task clearly needs an assigned Composio toolkit.

## When not to use

- Builtin tools, MCP tools, or file/bash tools already cover the task.
