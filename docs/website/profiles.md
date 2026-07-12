# Profiles

A **profile** is an agent definition Nakama runs for a session.

It answers one practical question: **which agent should respond, and what is its role?**

Profiles belong to an **organization**. Switching orgs in the dashboard shows only that org's agents.

## Default profile per organization

Nakama does **not** share one global `default` bot across every org.

When an organization is created — including the first org at install — Nakama automatically:

1. Creates one **default profile** for that org (`isDefault: true`)
2. Assigns the standard builtin tool set (web search, file tools, email, and the rest)
3. Initializes its soul directory on disk

That profile is named **Default Bot** and gets a unique id (not a fixed string like `default`).

| What | Behavior |
|------|----------|
| Default profile | Exactly one per org, marked with `isDefault` |
| Super bot | Not auto-created; platform admin may add a profile with `isSuper: true` if needed |
| Additional orgs | Each gets its own default profile and isolated on-disk data |

If a session or channel config omits a profile id — or names one that does not exist in the active org — Nakama falls back to that org's default profile.

### New custom profiles

Platform admins create extra profiles inside the **active org**. Each new profile gets its own soul directory and starts with `read_file`, `write_file`, `edit_file`, `search_files`, and `knowledge_base_search` when those builtins are available. Default and super-bot profiles also receive bundled skills (memory, automations, skill authoring) when installed on the server. Assign more tools, MCP servers, and skills from the dashboard.

Super Bot can also create profiles from chat. For profile-creation requests, it uses a Super Bot-only bundled skill that guides soul-file generation, keeps `MEMORY.md` empty, and uses the current tool inventory to recommend a small relevant starter set.

Super Bot can hand coding tasks to a dedicated coding agent via the `coding-delegation` skill and `bash`. See [Coding agent](/coding-agent).

## What a profile contains

| Field | What it means |
|------|----------------|
| `id` | Stable unique profile id |
| `name` | Human-friendly label shown in the UI |
| `model` | Optional model selection for this profile |
| `systemPrompt` | Base instructions stored in the database |
| `isSuper` | Marks the profile as a super profile with elevated behavior |
| `isDefault` | Marks the org's default profile used when none is specified |
| `tools` | Builtin or custom tools the profile is allowed to use |
| `mcpServers` | MCP servers available to the profile |
| `skills` | Reusable instructions assigned to the profile |
| `hasAvatar` | Whether the profile has a custom avatar |
| `soulActive` | Whether soul files are present and active |

## What a good profile usually represents

One profile should map to one clear purpose. Create another profile when you need different instructions, tools, tone, or knowledge.

## How profiles affect replies

When a chat runs with a profile, Nakama builds the agent context in this order:

1. Start with the profile's `systemPrompt`
2. If soul files exist, compose them into the main system prompt
3. Append the assigned skills catalog
4. Append the knowledge base catalog
5. Expose only the tools allowed for that profile

So a profile is not just a name. It controls both:

- **How the agent behaves**
- **What the agent is allowed to do**

For the full prompt assembly flow, see [Agent prompt](/agent-prompt).

## Soul vs system prompt

Profiles support two layers of instruction:

| Layer | Best for |
|------|----------|
| `systemPrompt` | Quick base instructions stored in the database |
| Soul files | Richer identity, style, operating rules, and memory on disk |

Soul files, avatars, knowledge-base documents, artifacts, and profile-scoped skills all live under an org-scoped path:

```text
~/.nakama/orgs/{orgId}/profiles/{profileId}/
```

Supported soul files:

| File | Purpose |
|------|---------|
| `SOUL.md` | Identity |
| `STYLE.md` | Writing voice |
| `INSTRUCTIONS.md` | Operating rules |
| `MEMORY.md` | Continuity across sessions |

Archived memory lives alongside soul files at `memory-archive/` (monthly `.md` files). It is not part of the soul stack loaded into chat.

Profile-scoped skills are stored at:

```text
~/.nakama/orgs/{orgId}/profiles/{profileId}/skills/
```

Artifacts saved by the agent (via the `save-artifact` skill and `write_file`) are stored at:

```text
~/.nakama/orgs/{orgId}/profiles/{profileId}/artifacts/
```

If you want richer personality and clearer long-term behavior, use soul files. If you only need a quick setup, the stored `systemPrompt` may be enough.

Platform-admin data exports include these org/profile workspaces as part of the full Nakama data-root ZIP.
Restoring an export replaces the local data root after preview and confirmation; it is not a per-profile merge.

### Default Bot soul stack

New organizations receive a **pre-filled** soul stack for Default Bot — identity, voice, operating rules, and memory — not blank placeholders. Customize files in the dashboard Prompt tab. The database `systemPrompt` field is for optional operational overrides when it differs from `SOUL.md`; fresh installs leave it empty so identity lives in soul files alone.

Existing profiles keep customized soul files. On server startup, `ensureSoulScaffolded()` fills **missing or empty** soul files and upgrades **legacy placeholder** `SOUL.md` content (the old `# Your Name` scaffold) to the current Default Bot template. Customized souls are not overwritten.

## Model selection

Each profile can optionally select its own model.

| Field | Meaning |
|------|---------|
| `model` | Uses a specific model for this profile instead of the workspace default |

## Knowledge base and memory

Profiles keep their own context on disk under the org-scoped profile directory:

- **Knowledge base** documents for searchable reference material
- **Inherited knowledge sources** for shared product references, such as the Nakama documentation
- **`MEMORY.md`** for active facts and continuity the agent should remember across sessions
- **`memory-archive/`** for facts moved out of active memory without deleting them
- **Artifacts** for persistent reports and generated text saved via the `save-artifact` skill

Memory writes and archives use bundled skills (`update-profile-memory`, `archive-profile-memory`) with the profile's file tools — not separate memory builtins. Artifact saves use `save-artifact` with `write_file`. Default and super-bot profiles receive these skills automatically when they are installed on the server.

| Store | Loaded into chat | How agents write |
|-------|------------------|------------------|
| `MEMORY.md` | Yes (via soul stack) | `update-profile-memory` skill + `read_file` / `edit_file` / `write_file` |
| `memory-archive/` | No | `archive-profile-memory` skill + file tools |
| `artifacts/` | No (dashboard + download API) | `save-artifact` skill + `write_file` |
| Knowledge base | Via `knowledge_base_search` when assigned | Upload via dashboard; search at runtime |
| Profile skills | Via skill matcher when relevant | `manage-skills` skill or dashboard |

Active `MEMORY.md` has a **4096-byte** soft limit. When it is full, the agent should archive old bullets before adding new ones.

This data is isolated per org and per profile. Two orgs never read or write the same directory, even if profile ids happen to match.

Each profile also sees the default Nakama documentation source in the Knowledge tab:

```text
https://ahmadrosid.github.io/nakama/llms.txt
```

When a user asks about Nakama setup, profiles, tools, orgs, integrations, API, or troubleshooting, the agent should `web_fetch` that index first, then `web_fetch` the matching `.md` page (for example `telegram.md` for Telegram setup). Do not use `knowledge_base_search` for inherited documentation — that tool only searches uploaded files.

## Multi-tenant behavior

Profiles are tenant-owned data inside an organization:

| Rule | Detail |
|------|--------|
| Listing | `GET /v1/profiles` returns only profiles for the active org |
| Lookup | Requesting another org's profile id returns not found |
| Sessions | Bind to one profile within the active org |
| Tool access | Scoped per profile |
| Mutations | Platform-admin only; org members chat with org profiles |

Org admins manage members, not profiles. Platform admins need an active org context when creating or editing profiles.

## When to create multiple profiles

Create separate profiles when you need different:

- Agent identities
- Safety or operating rules
- Tool access
- Knowledge bases
- Models

## Next steps

- [Builtin tools](/builtin-tools) — what each profile can do
- [MCP servers](/mcp) — extend a profile with external tools
- [Multi-tenancy](/multi-tenancy) — who can manage profiles and members
