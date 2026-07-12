# Composio

Nakama integrates with [Composio](https://composio.dev) to give agents access to external SaaS tools with managed OAuth.

## Setup

1. Set `COMPOSIO_API_KEY` on the Nakama server.
2. Restart the server and confirm `/health` reports `composioAvailable: true`.
3. As an org admin, open **Integrations → Composio**.
4. Enable a toolkit, click **Connect**, and complete OAuth in the browser.
5. Click **Sync tools** after connecting.
6. Assign the toolkit to a profile on the **Profiles** page.

## Tenancy model

- Connections are **org-shared**. Composio `user_id` is `nakama:org:{orgId}`.
- All org members use the same connected SaaS accounts for assigned toolkits.
- Only org admins can enable, connect, disconnect, or sync toolkits.

## Chat behavior

- Assigned Composio tools are namespaced as `composio__{toolkit}__{tool}`.
- Agents cannot self-authorize OAuth. The bundled `composio-integrations` skill teaches handoff to org admins.
- Auth failures return `COMPOSIO_NOT_CONNECTED`.

## Related docs

- [MCP servers](/mcp) — generic MCP integration (separate from Composio)
- [Integrations](/integrations) — other bridge and channel settings
