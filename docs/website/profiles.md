# Profiles

A **profile** is the bot definition TinyClaw runs for a session.

It answers one practical question: **which bot should respond, and how should it behave?**

## Fresh install defaults

On a fresh installation, TinyClaw creates **two profiles by default**:

| Profile | Purpose | Default access |
|---------|---------|----------------|
| `super_bot` | Built-in admin-style bot | Highest permissions, including super-bot-only capabilities |
| `default` | Normal starter bot | General seeded tool set for everyday use |

### New custom profiles

New custom profiles start with their own soul directory and only the builtin `create_skill` tool. Platform admins can assign more tools, MCP servers, and skills later.

## What a profile contains

| Field | What it means |
|------|----------------|
| `id` | Stable profile ID such as `default` or `super_bot` |
| `name` | Human-friendly label shown in the UI |
| `model` | Optional model override for this profile |
| `systemPrompt` | Base instructions stored in the database |
| `thinkingEnabled` | Whether this profile explicitly enables or disables thinking |
| `thinkingEffort` | Optional thinking level such as low, medium, or high |
| `isSuper` | Marks the profile as a super profile with elevated behavior |
| `tools` | Builtin or custom tools the profile is allowed to use |
| `mcpServers` | MCP servers available to the profile |
| `skills` | Reusable instructions assigned to the profile |
| `hasAvatar` | Whether the profile has a custom avatar |
| `soulActive` | Whether soul files are present and active |

## What a good profile usually represents

One profile should map to one clear purpose. Create another profile when you need different instructions, tools, tone, or knowledge.

## How profiles affect replies

When a chat runs with a profile, TinyClaw builds the agent context in this order:

1. Start with the profile's `systemPrompt`
2. If soul files exist, compose them into the main system prompt
3. Append the assigned skills catalog
4. Append the knowledge base catalog
5. Expose only the tools allowed for that profile

So a profile is not just a name. It controls both:

- **How the agent behaves**
- **What the agent is allowed to do**

## Soul vs system prompt

Profiles support two layers of instruction:

| Layer | Best for |
|------|----------|
| `systemPrompt` | Quick base instructions stored in the database |
| Soul files | Richer identity, style, operating rules, and memory on disk |

Soul files live under:

```text
~/.tinyclaw/profiles/{profileId}/
```

Supported soul files:

| File | Purpose |
|------|---------|
| `SOUL.md` | Identity |
| `STYLE.md` | Writing voice |
| `INSTRUCTIONS.md` | Operating rules |
| `MEMORY.md` | Continuity across sessions |
| `examples/*.md` | Calibration examples |

If you want richer personality and clearer long-term behavior, use soul files. If you only need a quick setup, the stored `systemPrompt` may be enough.

## Thinking settings

Each profile can override model thinking behavior.

| Field | Meaning |
|------|---------|
| `thinkingEnabled` | Turns profile-level thinking override on or off |
| `thinkingEffort` | Sets the effort level when thinking is enabled |

If a profile leaves them unset, TinyClaw falls back to the deployment defaults.

## Knowledge base and memory

Profiles keep their own context on disk:

- **Knowledge base** documents for searchable reference material
- **`MEMORY.md`** for facts and continuity saved by the agent

This data does not carry across profiles.

## Multi-tenant behavior

Profiles are tenant-owned data inside an organization. In practice:

- Profiles belong to an org
- Sessions bind to one profile
- Tool access is scoped per profile
- Profile admin actions are platform-admin only

Org admins manage members, not profiles.

## When to create multiple profiles

Create separate profiles when you need different:

- Agent identities
- Safety or operating rules
- Tool access
- Knowledge bases
- Models or thinking settings

## Next steps

- [Builtin tools](/builtin-tools) — what each profile can do
- [Multi-tenancy](/multi-tenancy) — who can manage profiles and members
