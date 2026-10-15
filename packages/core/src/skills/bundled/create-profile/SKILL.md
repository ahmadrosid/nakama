---
name: create-profile
description: Create, design, or set up a new bot profile with soul files and appropriate tool assignments. Use when the user asks for a new profile, support bot, assistant, persona, or specialized bot.
include-body-on-match: true
---

When the user asks to create a profile, run a confirm-first factory — never call `create_profile` until they explicitly confirm the draft.

## 1. Clarify only when needed

Ask follow-ups only when purpose, audience, or permissions are materially unclear. Otherwise interpret the request concisely and move to the draft.

## 2. Draft in chat first

Post a reviewable draft before any tool call:

- Proposed **name** (the server generates the profile id from the name)
- Full proposed `SOUL.md` (who it is, values, help scope, boundaries)
- Full proposed `STYLE.md` (voice, tone, formatting)
- Full proposed `INSTRUCTIONS.md` (operating rules, tool posture, when to ask the user)
- `MEMORY.md` must be **empty**. Do not invent continuity facts, preferences, or history.

Also include a **tool plan**:

- Server auto-assigns these basics on create when available: `read_file`, `write_file`, `edit_file`, `search_files`, `knowledge_base_search`, `web_fetch`, plus default bundled skills (including `update-profile-memory`).
- Recommend optional extras from the available-tools context only when they clearly match the requested purpose.
- Do not assign every available tool. Avoid powerful or externally visible tools unless the user asked for that capability.
- Assign extras only when the user asked for them or approved them in this plan.

Model and plugin choices:

- Call `list_models` for model ids. When the purpose needs images (receipts, photos, screenshots), pick a model with `supportsVision: true` and put its id in the plan. Omit `model` to use your own model.
- To connect an installed plugin, put its tools and its skill in the plan. Use `list_tools` for the plugin's tool ids. The skill name is the plugin manifest skill key.
- Read-only list calls (`list_models`, `list_tools`, `list_profiles`) are allowed before the user approves.
- Never read server source, config files, databases, or auth tokens to find models, tools, or skills.

Never set `isSuper: true` unless the user explicitly asked for a super profile. Prefer refusing agent-initiated super creation and directing them to the dashboard.

## 3. Wait for explicit confirmation

Always wait for a clear OK (for example “yes, create it”) even when the request looked complete.

If the user edits the draft, revise the draft in chat and wait for confirmation again. Do not call `create_profile` on edit-only messages.

## 4. Create only after OK

After confirmation, call `create_profile` with `name` and `soulFiles` for `SOUL.md`, `STYLE.md`, `INSTRUCTIONS.md`, and empty `MEMORY.md`. Do not pass `id` — the server assigns one from the name.

Then assign the approved extras: `assign_tool_to_profile` for each tool and `assign_skill_to_profile` for each skill.

Then summarize:

- Profile id and name
- How to open it in the dashboard (Profiles → select the new profile)
- Which basics were auto-assigned vs any extras still waiting on an explicit assign ask
