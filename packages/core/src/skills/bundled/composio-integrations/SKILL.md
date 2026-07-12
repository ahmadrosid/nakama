---
name: composio-integrations
description: Use Composio-connected SaaS tools safely. Never self-authorize OAuth; hand off missing connections to org admins.
---

# Composio integrations

Use assigned Composio tools when the user asks for external SaaS actions (email, Slack, GitHub, Notion, etc.).

## Rules

- Never attempt OAuth or open connect links yourself. Only org admins connect apps on Integrations.
- If a Composio tool returns `COMPOSIO_NOT_CONNECTED`, tell the user an org admin must connect the toolkit on Integrations, then retry.
- Only use Composio tools that are assigned to this profile.
- Do not invent successful external actions when a tool fails.

## When to use

- The user wants to read or write data in a connected SaaS app.
- The task clearly needs an assigned Composio toolkit.

## When not to use

- The user asks you to connect their account — redirect them to an org admin.
- Builtin tools, MCP tools, or file/bash tools already cover the task.
