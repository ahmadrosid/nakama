# Skills

A **skill** is a reusable instruction bundle you assign to a profile.

Think of it as a saved workflow:

- The profile keeps its main identity in soul files or `systemPrompt`
- A skill adds a focused procedure for a specific kind of task
- The agent can match and use that procedure when it is relevant

Use skills when you want the bot to follow the same steps repeatedly without cramming everything into the main prompt.

## Why skills matter

Skills help keep profiles clean.

For example:

- A support bot can have one skill for bug triage
- A content bot can have one skill for rewriting release notes
- An ops bot can have one skill for incident summaries

This gives you smaller, clearer building blocks instead of one giant prompt.

## How skills fit with profiles

Skills are assigned per profile, just like tools and MCP servers.

| Layer | What it controls |
|------|-------------------|
| Soul / `systemPrompt` | The bot's overall identity and rules |
| Skills | Repeatable workflows or task-specific instructions |
| Tools | Actions the bot is allowed to take |
| MCP servers | Extra external tools |

A profile can have many skills, and the same global skill can be assigned to more than one profile.

## Two kinds of skills

### Global skills

Global skills live in the shared skill library:

```text
~/.nakama/agent/skills/
```

These are useful when the same workflow should be reusable across multiple profiles.

### Profile-scoped skills

Profile-scoped skills live inside one org/profile workspace:

```text
~/.nakama/orgs/{orgId}/profiles/{profileId}/skills/
```

These are useful when the workflow only makes sense for one specific bot.

## Skill file format

Each skill is stored in its own directory with a `SKILL.md` file.

Minimal example:

```md
---
name: weather
description: Use when the user asks for a weather forecast.
---

# Skill instructions

1. Ask for the city if missing.
2. Check the forecast.
3. Summarize it clearly.
```

Required frontmatter:

| Field | Required | Meaning |
|------|----------|---------|
| `name` | Yes | Lowercase letters, numbers, and hyphens only |
| `description` | Yes | Short summary of when the skill should be used |

Optional frontmatter:

| Field | Meaning |
|------|---------|
| `disable-model-invocation` | Only run on explicit invocation |
| `include-body-on-match` | Include the full body when the skill auto-matches |

## Skills with tools

A skill can also include a local tool module in the same directory:

- `tool.ts`
- `tool.js`

When present, the dashboard shows the skill as **includes tool**.

This is useful when the workflow needs both:

- Instructions in `SKILL.md`
- A small custom tool that the skill can use

## How skills are used at runtime

When a profile starts a chat, Nakama appends the assigned skills catalog to the agent prompt.

On each user turn, Nakama can also attach matched skill context for the current message.

That means skills are not a separate bot. They are extra behavior layers attached to a profile.

## Invoking skills in chat

In the web chat composer, type `/` to open a picker for skills assigned to the active profile.

You can:

- Type to filter the skill list
- Use Arrow Up and Arrow Down to move through options
- Press Enter to insert the selected skill
- Press Escape to close the picker

Selecting a skill inserts an explicit invocation like:

```text
/skill weather
```

The composer highlights the selected skill, but the message still sends as plain text so it works with the normal skill matcher.

Nakama also ships bundled skills for system workflows. The `create-profile` bundled skill is assigned only to Super Bot, so profile-authoring instructions load when Super Bot is asked to create a profile without adding those instructions to ordinary profile prompts.

For more detail, see [Agent prompts](/agent-prompt).

## How to create and assign skills

There are two common paths.

### From the dashboard

Platform admins can:

1. Go to **Agent → Profiles**
2. Open a profile
3. Use the **Skills** section to add, assign, unassign, or inspect skills

The dashboard also supports a shared skill library through the skills API and sync flow.

### From the agent itself

Profiles receive bundled skills for common workflows:

- `create-automation` — scheduling, reminders, and saved automations
- `manage-skills` — create and update profile-scoped skills with `write_file`, `read_file`, `search_files`, and `edit_file`
- `update-profile-memory` — record facts in active `MEMORY.md` via file tools
- `archive-profile-memory` — move facts from active `MEMORY.md` into `memory-archive/` without deleting them
- `save-artifact` — save persistent text outputs under `artifacts/` via `write_file`

New custom profiles receive the file tools and `knowledge_base_search` by default when those builtins are available. Default and super-bot profiles also receive the bundled skills above when they are installed and synced on the server.

### Bundled system skills

`update-profile-memory`, `archive-profile-memory`, and `save-artifact` replace older dedicated builtins. They teach the agent how to use generic file tools safely:

- **Memory write path:** read or create `MEMORY.md`, append a dated `- bullet` under the user's timezone date, keep the `# Memory Log` preamble, stay under 4096 bytes
- **Archive path:** copy exact bullets to `memory-archive/YYYY-MM.md`, then remove them from `MEMORY.md`
- **Artifact path:** `write_file` under `artifacts/{filename}`, then write `{filename}.nakama-meta.json` with MIME metadata for the dashboard (text-only)

These skills use `include-body-on-match: true`, so the full procedure loads when the user's message matches the skill description. The chat wrapper also mentions memory skills when `read_file` and `edit_file` are available, and `save-artifact` when `write_file` is available.

They are hidden from the `/skill` slash picker (like `create-automation` and `manage-skills`) because they are system workflows, not user-authored skills. Agents can still invoke them explicitly with `/skill update-profile-memory`, `/skill archive-profile-memory`, or `/skill save-artifact`.

## Sync behavior

Nakama discovers skills from disk and syncs them into the database.

This is why there is a skills sync step:

- Files on disk are the source material
- The database stores discovered metadata for the dashboard and API

If you add or change skill folders manually, run skill sync so Nakama refreshes what it knows.

## Permissions

Skill management is a platform-admin operation in the dashboard and API.

| Actor | Can manage skills | Can use a profile with skills |
|------|-------------------|-------------------------------|
| Platform admin | Yes | Yes |
| Org admin | No | Yes |
| Org member | No | Yes |
| Org viewer | No | No |

Viewers cannot invoke agents, so they cannot trigger skills either.

## When to use a skill vs something else

- Use a **skill** for a repeatable workflow
- Use **`update-profile-memory`** for user facts, preferences, and durable context (not procedures)
- Use **`archive-profile-memory`** when the user wants to forget, tidy, or free space in active memory without deleting history
- Use the **main profile prompt** for always-on behavior and identity
- Use a **builtin tool** for a native capability like web search or file access
- Use **`save-artifact`** for persistent reports, summaries, and generated text under `artifacts/`
- Use an **MCP server** for external tool integrations

## Next steps

- [Profiles](/profiles) — how skills attach to a bot
- [Builtin tools](/builtin-tools) — the actions a profile can take
- [MCP servers](/mcp) — external tools assigned to a profile
