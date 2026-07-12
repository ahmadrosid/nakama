# MCP Servers

An **MCP server** is an external tool provider that extends what a profile can do, beyond the [builtin tools](/builtin-tools).

Nakama is an **MCP client**. It connects to MCP servers you register, discovers the tools they expose, and bridges those tools into a profile's chat loop so the model can call them like any other tool.

The mental model is simple:

- You register an MCP server once (platform admin)
- You assign that server to one or more profiles
- Each assigned profile gains the server's tools at chat time

## Why MCP servers matter

The builtin tools cover general actions like file access, web search, and email. But real setups often need capabilities that are specific to a product, a data source, or an internal system.

MCP is how you plug those in without writing custom code inside Nakama. The [Model Context Protocol](https://modelcontextprotocol.io) is a standard for exposing tools to LLMs, and there is a growing ecosystem of ready-made MCP servers for things like databases, APIs, issue trackers, and knowledge sources.

Use MCP servers when you want a profile to:

- Query a database or internal API
- Read from or write to a SaaS product that ships an MCP server
- Run a local tool exposed through a command-based MCP server
- Add a narrow capability that does not belong in the builtin set

If a capability should be available to every profile by default, it is probably a builtin tool or a [bundled skill](/skills), not an MCP server. Profile memory (`MEMORY.md`) and artifact saves (`artifacts/`) use bundled skills plus file tools — not dedicated builtins.

## How MCP servers fit with profiles and tools

MCP servers sit alongside the [builtin tools](/builtin-tools) and follow the same safety principle: **a profile only gets the tools it is assigned.**

| Layer | Who manages it | How a profile gets it |
|------|----------------|----------------------|
| Builtin tools | Platform admin | Assigned per profile |
| Bundled skills | Shipped with Nakama | Assigned per profile (memory, artifacts, automations, skill authoring) |
| MCP servers | Platform admin | Registered once, then assigned per profile |
| Profile skills | Platform admin or the bot itself | Assigned per profile |

Registering an MCP server does **not** give it to any profile. A platform admin must assign it. This keeps tool access deliberate and scoped, the same way builtin tool access is.

## Two transports

Nakama supports two ways to reach an MCP server:

| Transport | When to use | What you configure |
|-----------|-------------|---------------------|
| `http` | The server is hosted remotely (a SaaS MCP endpoint, a shared service) | `url` and optional `headers` for auth |
| `stdio` | The server runs as a local command (an `npx` package, a binary) | `command`, optional `args`, optional `env` |

### HTTP servers

Nakama opens a streamable HTTP connection to the URL and reuses it across turns. Put any auth tokens or custom headers in the `headers` map.

Example config:

```json
{
  "url": "https://mcp.example.com/sse",
  "headers": {
    "Authorization": "Bearer my-token"
  }
}
```

### stdio servers

Nakama spawns the command as a child process and talks to it over stdin/stdout using the MCP stdio transport. `args` and `env` are optional.

Example config:

```json
{
  "command": "npx",
  "args": ["-y", "some-mcp-package"],
  "env": {
    "API_KEY": "secret-value"
  }
}
```

For stdio servers, Nakama runs one process **per profile** and sets the working directory to that profile's soul directory (`~/.nakama/profiles/{profileId}/`). This keeps each profile's stdio server isolated. HTTP servers share a single connection regardless of how many profiles use them.

## How tools appear to the model

When a chat runs, Nakama looks at the profile's assigned MCP servers, reads each server's **cached tools**, and exposes them to the model as regular tools.

To avoid name collisions between servers — and with the builtin tools — each MCP tool is namespaced as:

```text
{serverName}__{toolName}
```

For example, a server named `github` exposing a `read_file` tool becomes `github__read_file`. Characters that are not allowed in tool names are replaced with `_`, and collisions are de-duplicated with a numeric suffix.

The model sees these tools alongside the profile's builtin tools and can call them in the same turn. When the model calls one, Nakama forwards the call to the connected MCP server and returns the result.

## The connect and sync lifecycle

MCP servers are not queried live on every chat turn. Instead, Nakama **caches the tool list** when it connects. This is why there is a connect/sync lifecycle.

| State | What it means |
|-------|---------------|
| `connected` | Nakama has an active client connection and a cached tool list |
| `disconnected` | No active connection; tools are stale or empty |
| `error` | The last connect or sync failed; `lastError` holds the message |

### Connect

Connecting opens a client connection to the server, fetches its tool list, and caches it. A server must be connected for its tools to be callable during chat.

### Sync

Syncing refreshes the cached tool list from an already-connected server. Run this when the server has added, removed, or renamed tools and you want Nakama to pick up the change.

### Restart behavior

When Nakama starts up, it automatically reconnects every **enabled** MCP server. Disabled servers are left disconnected. If a server cannot be reached at startup, Nakama logs a warning and continues — the server's status becomes `error` and can be reconnected from the dashboard.

## Where to manage MCP servers

MCP servers are registered from the **System** page, then assigned to bots from the **Profiles** page.

| Action | Where to go | Who |
|--------|-------------|-----|
| Register, edit, connect, or delete an MCP server | **Agent → System → MCP** tab | Platform admin |
| Make a server's tools available to a bot | **Agent → Profiles** → open a profile → **MCP servers** section | Platform admin |

The **System** page lives under the **Agent** group in the sidebar. Open it and select the **MCP** tab to manage servers. The **Profiles** page is also under **Agent** — open a profile to assign or unassign servers.

## How to add an MCP server

Platform admins register MCP servers from **Agent → System → MCP** in the dashboard.

1. Open the **MCP** tab
2. Click **Add server**
3. Choose a transport: **HTTP** or **Command**
4. Enter a name and the transport config
5. Click **Test connection** to verify the config before saving
6. Save — the server is created and (if enabled) connected immediately

### Import from an existing MCP config

If you already have an MCP client config (for example, a Cursor `mcpServers` block), you do not need to retype it.

Use **Import JSON** in the add dialog, or simply paste the JSON onto the form. Nakama parses the standard shape:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "some-mcp-package"]
    }
  }
}
```

A bare server object (with a top-level `command` or `url`) is also accepted. The first server entry fills the form so you can review, test, and save.

## How to assign an MCP server to a profile

Registering a server does not give it to any profile. To make a server's tools available to a bot:

1. Go to **Agent → Profiles** and open the profile you want to extend
2. Scroll to the **MCP servers** section
3. Click **Assign existing** and pick from the registered servers
4. The profile gains that server's cached tools immediately

You can also click **Add MCP server** from the profile page to register a new server without leaving, then assign it.

Unassigning a server removes its tools from the profile's next chat. Deleting a server removes it from every profile.

## Secret handling

HTTP headers and stdio environment values are often secrets. Nakama treats them carefully:

- **Redacted in responses:** The API and dashboard return header and env values as `••••••••` instead of the real value.
- **Blank means keep:** When editing a server, leave a secret field blank to preserve the stored value. Send a new non-empty value to replace it.
- **Test merges secrets:** The test-connection endpoint merges your input with the stored config, so you can test using the existing secret without re-entering it.

## Config reference

### HTTP config

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | string | Yes | Must be a valid URL |
| `headers` | Record&lt;string, string&gt; | No | Auth or custom headers |

### stdio config

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `command` | string | Yes | Executable on PATH or an absolute path |
| `args` | string[] | No | Arguments passed to the command |
| `env` | Record&lt;string, string&gt; | No | Environment variables for the child process |

## Permissions

MCP servers are a platform-admin responsibility, matching profiles, builtin tools, and skills. This keeps the bot system consistent across organizations while org admins focus on members.

| Actor | Can manage MCP servers | Can use a profile that has MCP tools |
|-------|------------------------|--------------------------------------|
| Platform admin | Yes | Yes |
| Org admin | No | Yes |
| Org member | No | Yes |
| Org viewer | No | No (viewers cannot invoke agents) |

## Troubleshooting

- **Status stays `error`:** Check `lastError` on the server. Common causes are a wrong URL, a missing `command`, an unreachable host, or expired auth credentials.
- **No tools discovered:** The server connected but returned zero tools. Some servers require arguments or scopes before exposing tools. Run **Sync tools** after fixing the server-side config.
- **Tool calls return "not connected":** The cached tool list exists but the live connection dropped. Reconnect the server, or for stdio servers make sure the command is still on PATH.
- **Namespaced name looks wrong:** Tool names are sanitized to `a-zA-Z0-9_-`. Dots and slashes become `_`, so `tools.list` from server `user.tolaria` becomes `user_tolaria__tools_list`.

## Next steps

- [Builtin tools](/builtin-tools) — the tools that ship with Nakama
- [Profiles](/profiles) — how to design each bot and its tool access
- [Multi-tenancy](/multi-tenancy) — who can manage MCP servers and why
