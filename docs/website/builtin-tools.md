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

| Tool | `default` / `super_bot` | New custom profiles | Notes |
|------|-------------------------|---------------------|-------|
| `write_file` | Yes | Yes | |
| `write_docx` | Yes | No | Create real `.docx` files from Markdown |
| `delete_file` | Yes | No | |
| `edit_file` | Yes | Yes | |
| `read_file` | Yes | Yes | |
| `search_files` | Yes | Yes | |
| `knowledge_base_search` | Yes | Yes | |
| `web_search` | Yes | No | |
| `web_fetch` | Yes | Yes | |
| `email` | Yes | No | Omitted at runtime when mailbox is unconfigured |
| `bash` | Super Bot only | No | Run shell commands in the profile workspace |
| `sub_agent` | No | No | Opt-in: delegate to a same-profile sub-agent (see below) |

**New custom profiles** receive `read_file`, `write_file`, `edit_file`, `search_files`, `knowledge_base_search`, and `web_fetch` until a platform admin assigns additional tools. Memory writes, archives, and artifact saves use bundled skills with those file tools — see [Skills](/skills#bundled-system-skills). Word documents use `write_docx` (system profiles only by default). Coding-agent workflows use `bash` with the `coding-delegation` skill — see [Coding agent](/coding-agent). Interactive browser automation (login walls, forms, clicks) uses `bash` with the opt-in `agent-browser` skill — see [Agent browser](/agent-browser). The `sub_agent` tool is seeded but **not** auto-assigned — platform admins opt in per profile. System profiles (`default`, `super_bot`) get the full seeded builtin set; Super Bot also receives `bash`.

## Choosing tools for a profile

Good starting patterns:

- **Simple chat bot**: no extra tools
- **Research bot**: `web_search`, `web_fetch`, `knowledge_base_search`, optionally `sub_agent` for parallel deep dives
- **Knowledge bot**: `knowledge_base_search`, file tools, bundled system skills
- **Ops bot**: file tools, bundled `save-artifact` skill, `email`
- **Delegation bot**: `sub_agent` for in-process research/review/planning subtasks
- **Coding agent (Super Bot or custom)**: `bash`, `coding-delegation` skill, plus a configured harness in Integrations

## Memory workflows

Profile memory is not a separate builtin. Agents use `read_file`, `write_file`, and `edit_file` with two bundled skills:

| Skill | Purpose |
|-------|---------|
| `update-profile-memory` | Append facts and preferences to active `MEMORY.md` |
| `archive-profile-memory` | Move bullets to `memory-archive/` without deleting them |

Active `MEMORY.md` has a **4096-byte** soft limit. Default and super-bot profiles receive these skills when bundled skills are installed on the server. See [Bundled system skills](/skills#bundled-system-skills) for the full workflow.

## Artifact saves

Persistent outputs (reports, summaries, generated text, Word documents) are not a separate builtin. Agents use `write_file` or `write_docx` with the `save-artifact` bundled skill under `artifacts/`. The skill also documents writing a `{filename}.nakama-meta.json` sidecar so the dashboard Artifacts tab shows MIME types and timestamps.

On web chat, `write_file` and `write_docx` saves under `artifacts/` appear as attachment chips on the assistant message. Click a chip to open a resizable preview panel with copy, download, and fullscreen:

On **Telegram** and **Discord**, the same paired saves post a Publish share link after the agent reply; ask to “send the file” when you want a native attachment. See [Telegram](/telegram#saved-artifacts-and-share-links) and [Discord](/discord#saved-artifacts-and-share-links).

| Content type | Preview behavior |
|--------------|------------------|
| HTML (`.html`, `text/html`) | Sandboxed iframe render |
| Markdown (`.md`, `text/markdown`) | Rendered prose |
| Word (`.docx` from `write_docx`) | Server converts to Markdown for preview |
| JSON, code, plain text | Syntax highlighting or monospace block |
| Unknown extension | UTF-8 sniff — preview when the bytes look like text |

Legacy `.doc` (Word 97–2003) is not supported for generation or preview. Binary formats outside these paths show a download-only message.

## Coding agent

Repo coding work is not a separate builtin. Profiles with the `coding-delegation` skill invoke Codex, Claude Code, or OpenCode through `bash`. You can also launch a harness directly with `bun run dev:cli -- launch`. See [Coding agent](/coding-agent) for setup, the inference gateway, CLI flags, and runtime behavior.

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

**Restrictions:** Rejects `.docx` and `.doc` paths — a `.docx` is a ZIP archive, not UTF-8 text. Use `write_docx` instead.

**Availability:** When assigned to the profile.

### `write_docx`

Create a real Microsoft Word (`.docx`) document from Markdown content. Headings, bold/italic, lists, tables, and code blocks are converted. Use whenever the user asks for a Word document.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `path` | string | Yes | Must end in `.docx`; relative to profile workspace unless absolute |
| `markdown` | string | Yes | Markdown source for the document body |
| `cwd` | string | No | Base directory within workspace; defaults to workspace root |

**Returns:** `{ path, bytesWritten }`

**Scope:** Profile workspace only. Under `artifacts/`, existing files are not silently overwritten — Nakama picks a unique filename instead.

**Availability:** When assigned to the profile. Assigned to system profiles (`default`, `super_bot`) by default; assign manually to custom profiles when needed.

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

Search uploaded knowledge base documents for relevant facts. The Knowledge tab can also show inherited URL sources, such as the Nakama documentation index at `llms.txt`; use `web_fetch` on that index and on specific `.md` pages — not `knowledge_base_search`.

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

### `bash`

Run a one-off shell command in the profile workspace and return stdout, stderr, and exit code.

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `command` | string | Yes | Shell command to run |
| `cwd` | string | No | Working directory within the profile workspace |
| `timeoutMs` | number | No | Default 30000, max 1800000 (30 minutes) |
| `env` | object | No | Extra env vars merged at spawn time (string values) |
| `codingAgent` | boolean | No | When true, Nakama merges coding-agent spawn env (gateway routing) for this command |

**Returns:** `{ exitCode, stdout, stderr, timedOut }`

**Coding-agent spawn env:** When `codingAgent: true` (or the command matches the active harness binary), Nakama merges inference-gateway env vars on the server before spawn. See [Coding agent — Model routing](/coding-agent#model-routing-inference-gateway). Optional `env` keys are merged on top.

**Scope:** Profile workspace only. Do not use `bash` to create persistent tools or `.sh` wrappers — register JavaScript tools under `~/.nakama/tools/` instead.

**Availability:** When assigned to the profile. Super Bot receives `bash` by default. Required for the [coding agent](/coding-agent) workflow and the opt-in [agent-browser](/agent-browser) skill.

### `sub_agent`

Run a focused **same-profile** sub-agent for delegated work (research, review, planning, debugging). The parent receives a structured result to summarize for the user. This is a Nakama-native in-process agent loop — **not** the external coding-agent path (`bash` + `coding-delegation`).

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `task` | string | Yes | Clear instruction for the sub-agent |
| `context` | string | No | Optional scoped background (not full parent chat history) |
| `timeoutMs` | number | No | Default 300000 (5 min), max 600000 (10 min) |

**Returns:** `{ status, summary, output, error? }` where `status` is `success`, `fail`, or `timeout`.

**Limits (v1):**

- Same profile only — no cross-profile targeting
- One level of nesting — sub-agents cannot call `sub_agent` again
- No persisted child chat session — audit via parent tool result + server logs
- Child runs share the profile workspace; side effects persist even if the parent times out
- Default timeout counts toward the parent web stream budget (10 minute total turn limit)

**Availability:** When assigned to the profile (opt-in; not part of default custom profile assignments).

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
- [Coding agent](/coding-agent) — hand repo work to Codex, Claude Code, or OpenCode via `bash`
- [Agent browser](/agent-browser) — interactive browsing via `bash` and the `agent-browser` skill
- [Agent prompts](/agent-prompt) — how bundled system skills appear in the chat wrapper
- [MCP servers](/mcp) — extend a profile with external tools via the Model Context Protocol
- [Profiles](/profiles) — how to design each bot
- [Multi-tenancy](/multi-tenancy) — who can assign tools and manage access
