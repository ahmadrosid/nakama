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

- Proposed **name** and optional **id**
- Full proposed `SOUL.md` (who it is, values, help scope, boundaries)
- Full proposed `STYLE.md` (voice, tone, formatting)
- Full proposed `INSTRUCTIONS.md` (operating rules, tool posture, when to ask the user)
- `MEMORY.md` must be **empty**. Do not invent continuity facts, preferences, or history.

Also include a **tool plan**:

- Server auto-assigns these basics on create when available: `read_file`, `write_file`, `edit_file`, `search_files`, `knowledge_base_search`, `web_fetch`, plus default bundled skills (including `update-profile-memory`).
- Recommend optional extras from the available-tools context only when they clearly match the requested purpose.
- Do not assign every available tool. Avoid powerful or externally visible tools unless the user asked for that capability.
- Extra tools still need an explicit user ask after create (`assign_tool_to_profile`).

Never set `isSuper: true` unless the user explicitly asked for a super profile. Prefer refusing agent-initiated super creation and directing them to the dashboard.

## 3. Wait for explicit confirmation

Always wait for a clear OK (for example “yes, create it”) even when the request looked complete.

If the user edits the draft, revise the draft in chat and wait for confirmation again. Do not call `create_profile` on edit-only messages.

## 4. Create only after OK

After confirmation, call `create_profile` with `name`, optional `id`, and `soulFiles` for `SOUL.md`, `STYLE.md`, `INSTRUCTIONS.md`, and empty `MEMORY.md`.

Then summarize:

- Profile id and name
- How to open it in the dashboard (Profiles → select the new profile)
- Which basics were auto-assigned vs any extras still waiting on an explicit assign ask
