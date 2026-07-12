# Builtin Tools

Builtin tools are the actions a profile is allowed to take.

The mental model is simple:

- A profile can only use the tools assigned to it
- Different profiles can have different permissions
- Tool access is one of the main ways you control risk

Platform admins assign tools to profiles from the dashboard.

## Why tools matter

The same model behaves very differently depending on its tools.

For example:

- A writing bot may need no tools at all
- A research bot may need web search, web fetch, and knowledge base search
- An ops bot may need file access and email
- A power-user bot may need skills and MCP servers

Give each profile the minimum tool set it needs.

## Default assignments

Nakama includes these builtins:

| Tool | `default` / `super_bot` | All profiles | Notes |
|------|-------------------------|--------------|-------|
| `write_file` | Yes | Yes | Assigned to new custom profiles by default |
| `delete_file` | Yes | No | |
| `edit_file` | Yes | Yes | Assigned to new custom profiles by default |
| `read_file` | Yes | Yes | Assigned to new custom profiles by default |
| `search_files` | Yes | Yes | Assigned to new custom profiles by default |
| `knowledge_base_search` | Yes | Yes | Assigned to new custom profiles by default |
| `web_search` | Yes | No | |
| `web_fetch` | Yes | No | |
| `email` | Yes | No | Omitted at runtime when mailbox is unconfigured |

**New custom profiles** receive `read_file`, `write_file`, `edit_file`, `search_files`, and `knowledge_base_search` until a platform admin assigns additional tools. Memory writes, archives, and artifact saves use bundled skills with those file tools — see [Skills](/skills#bundled-system-skills). System profiles (`default`, `super_bot`) get the full seeded set.

## Choosing tools for a profile

Good starting patterns:

- **Simple chat bot**: no extra tools
- **Research bot**: `web_search`, `web_fetch`, `knowledge_base_search`
- **Knowledge bot**: `knowledge_base_search`, file tools, bundled system skills
- **Ops bot**: file tools, bundled `save-artifact` skill, `email`

## Memory workflows

Profile memory is not a separate builtin. Agents use `read_file`, `write_file`, and `edit_file` with two bundled skills:

| Skill | Purpose |
|-------|---------|
| `update-profile-memory` | Append facts and preferences to active `MEMORY.md` |
| `archive-profile-memory` | Move bullets to `memory-archive/` without deleting them |

Active `MEMORY.md` has a **4096-byte** soft limit. Default and super-bot profiles receive these skills when bundled skills are installed on the server. See [Bundled system skills](/skills#bundled-system-skills) for the full workflow.

## Artifact saves

Persistent outputs (reports, summaries, generated text) are not a separate builtin. Agents use `write_file` with the `save-artifact` bundled skill under `artifacts/`. The skill also documents writing a `{filename}.nakama-meta.json` sidecar so the dashboard Artifacts tab shows MIME types and timestamps. Text-only — binary files are not supported in this workflow yet.

## Tool reference

### `write_file`

Write text to a file in the profile workspace.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `path` | string | Yes | Relative to profile workspace unless absolute |
| `content` | string | Yes | Text to write |
| `cwd` | string | No | Base directory within workspace; defaults to workspace root |

**Returns:** `{ path, bytesWritten }`

**Scope:** `~/.nakama/orgs/{orgId}/profiles/{profileId}/` and `~/.nakama/tools/` (custom JS modules)

**Availability:** When assigned to the profile.

### `delete_file`

Delete a file from the profile workspace or custom tools directory.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `path` | string | Yes | Must be within allowed directories |
| `cwd` | string | No | Base directory within workspace |

**Returns:** `{ path, deleted: true }`

**Scope:** Profile workspace and custom tools directory only.

**Availability:** When assigned to the profile.

### `edit_file`

Edit an existing text file in the profile workspace using exact replacements.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `path` | string | Yes | Relative to profile workspace unless absolute |
| `edits` | array | Yes | One or more `{ oldText, newText }` replacements |
| `cwd` | string | No | Base directory within workspace |

Each `oldText` must be present once and edits must not overlap. Nakama applies all edits against the original file, then writes the result atomically after validation.

**Returns:** `{ path, replacements, bytesWritten, fuzzyMatches }`

**Scope:** Profile workspace and custom tools directory only.

**Availability:** When assigned to the profile.

### `read_file`

Read text from a file in the profile workspace.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `path` | string | Yes | Relative to profile workspace unless absolute |
| `cwd` | string | No | Base directory within workspace |
| `offset` | number | No | 1-based start line; default 1 |
| `limit` | number | No | Maximum lines to return |

**Returns:** `{ path, content, bytesRead, startLine, endLine, totalLines, truncated }`

**Scope:** Profile workspace and custom tools directory. Reading `config.ini` by basename is blocked.

**Availability:** When assigned to the profile.

### `search_files`

Search text in files under the profile workspace.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `query` | string | Yes | Keyword or regex pattern |
| `path` | string | No | Subdirectory or file within workspace |
| `glob` | string | No | Ripgrep glob filter (e.g. `*.md`) |
| `regex` | boolean | No | Treat query as regex; default true |
| `maxResults` | number | No | Default 50, max 200 |

**Returns:** `{ query, root, matches, matchCount, truncated }`

**Scope:** `~/.nakama/orgs/{orgId}/profiles/{profileId}/` only. Requires `rg` (ripgrep) on PATH.

**Availability:** When assigned to the profile.

### `knowledge_base_search`

Search uploaded knowledge base documents for relevant facts. The Knowledge tab can also show inherited URL sources, such as the Nakama documentation; use `web_fetch` or `web_search` for those URL sources.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `query` | string | Yes | Keyword or regex pattern |
| `filename` | string | No | Filter to one source document (e.g. `report.pdf`) |
| `regex` | boolean | No | Default true |
| `maxResults` | number | No | Default 50, max 200 |

**Returns:** `{ query, root, matches, matchCount, truncated }` — empty matches when no ready document matches the filter.

**Scope:** Extracted text files stored under `~/.nakama/orgs/{orgId}/profiles/{profileId}/knowledge-base/`.

**Availability:** When assigned **and** at least one uploaded document has `status: "ready"`. Inherited URL sources do not require `knowledge_base_search`; they require `web_fetch` or `web_search`.

### `web_search`

Search the web for current information.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `query` | string | Yes | Search query |

**Availability:** When assigned **and** the configured provider is OpenAI or Anthropic with a valid API key. Not available on OpenRouter. On Gemini, web search is disabled when other local tools are present on the same turn.

### `web_fetch`

Fetch a single public HTTP(S) URL and return its content. HTML pages are converted to Markdown. Use for retrieving a known URL; use `web_search` when you need to discover sources.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `url` | string | Yes | Absolute `http://` or `https://` URL |
| `raw` | boolean | No | When true, return raw body without Markdown conversion; default false |

**Returns:** `{ url, finalUrl, status, contentType, bytes, content }`

**Behavior:** Follows up to 5 redirects. Request timeout 30s. Maximum response body 1 MB.

**Scope:** Public internet addresses only. Private, reserved, and localhost targets are blocked.

**Availability:** When assigned to the profile.

### `email`

List, read, search, and send email through the deployment mailbox configured in Settings.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `action` | string | Yes | `list`, `read`, `search`, or `send` |
| `folder` | string | No | Mailbox folder; default `INBOX` |
| `limit` | number | No | For list/search; default 20, max 100 |
| `uid` | number | Yes for `read` | IMAP UID |
| `query` | string | Yes for `search` | Subject/from/body search |
| `to` | string | Yes for `send` | Single recipient |
| `subject` | string | For `send` | Email subject |
| `text` | string | For `send` | Plain text body |
| `html` | string | No | Optional HTML body for send |

**Returns:** Structured JSON with `messages`, `message`, or `sent` — or `{ error: "..." }` on failure. Send body max 256 KB.

**Availability:** When assigned **and** the `[email]` section in `~/.nakama/config.ini` is complete. Omitted at runtime when incomplete (`omitUnavailableBuiltinTools`).

## Configuration prerequisites

### Email

The `email` tool uses a deployment-global mailbox. Required keys in `~/.nakama/config.ini` under `[email]`:

- `imap_host`, `smtp_host`
- `username`, `password`
- Resolvable `from` address
- TLS flags as needed

Org admins configure these from the web **System → Tools** page.

### Web search

Requires an OpenAI or Anthropic provider with a configured API key.

### Knowledge base

Upload documents via the profile dashboard or API. Search only indexes extracted text from documents with `status: "ready"`. Upload path: `~/.nakama/orgs/{orgId}/profiles/{profileId}/knowledge-base/`.

### Data portability

Platform admins can export and import the whole local Nakama data root from **Agent → System → Data** in the dashboard.
Use **Export ZIP** to download a backup.
Exports are `.zip` backups and should be handled as sensitive files because they can include local auth, provider configuration, custom tools, skills, profile workspaces, and a local SQLite database.

Import first previews the ZIP manifest and restore impact.
Confirmed restore replaces the current local data root; selective merge, scheduled backups, cloud destinations, and encrypted archives are not part of the first version.

## Safety boundaries

File tools (`read_file`, `write_file`, `edit_file`, `delete_file`) are scoped to:

- **Profile workspace:** `~/.nakama/orgs/{orgId}/profiles/{profileId}/` (soul files, knowledge base, `artifacts/`, etc.)
- **Custom tools directory:** `~/.nakama/tools/` (follows `NAKAMA_CONFIG_DIR` if set)

Agents save persistent outputs under `artifacts/` via the `save-artifact` bundled skill and `write_file`, not a dedicated builtin.

Path guards enforce:

- **10 MB** maximum file size for reads and writes
- No path traversal outside allowed directories
- No reads of `config.ini` by basename
- Blocked special paths (`/dev/`, `/proc/`, `/sys/`)

All builtin tool IDs are protected and cannot be deleted from the dashboard.

## Next steps

- [Skills](/skills) — bundled system skills and reusable profile procedures
- [Agent prompts](/agent-prompt) — how bundled system skills appear in the chat wrapper
- [MCP servers](/mcp) — extend a profile with external tools via the Model Context Protocol
- [Profiles](/profiles) — how to design each bot
- [Multi-tenancy](/multi-tenancy) — who can assign tools and manage access
