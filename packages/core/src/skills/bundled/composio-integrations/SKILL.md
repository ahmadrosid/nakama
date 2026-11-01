---
name: composio-integrations
description: Use Composio-connected SaaS tools safely. Generate OAuth connect links in chat when the user's account is not connected.
---

# Composio integrations

Use assigned Composio tools when the user asks for external SaaS actions (email, Slack, GitHub, Notion, etc.).

## Rules

- If the user needs a SaaS app that is not connected, call `composio__connect_account` with the toolkit slug. In web chat, do this even when the app is not in the assigned list; do not refuse before you call it. In other channels, only assigned apps can be connected: for any other app, tell the user to ask an admin to add it to this agent.
- If the tool result has a `redirectUrl`, send it as a clickable link. If it has `type: "composio_connect"`, the chat shows a Connect button: tell the user to click it, and do not write a link.
- After the user authorizes, they should return to chat and retry the request.
- If a Composio tool returns `COMPOSIO_NOT_CONNECTED`, call `composio__connect_account` for that toolkit — do not only tell them to open Integrations.
- Only run Composio actions for apps that are assigned to this profile and connected.
- Do not invent successful external actions when a tool fails.

## When to use

- The user wants to read or write data in a connected SaaS app.
- The task clearly needs an assigned Composio toolkit.

## When not to use

- Builtin tools, MCP tools, or file/bash tools already cover the task.
