---
name: create-profile
description: Create, design, or set up a new bot profile with soul files and appropriate tool assignments. Use when the user asks for a new profile, support bot, assistant, persona, or specialized bot.
include-body-on-match: true
---

When the user asks to create a profile, turn the request into a complete profile setup.

Clarify only when the profile's purpose, audience, or permissions are materially unclear. Otherwise proceed with a concise, useful interpretation of the request.

Create the profile with generated soul files:

- `SOUL.md` defines who the profile is, what it values, what it helps with, and its boundaries.
- `STYLE.md` defines voice, tone, formatting, and communication preferences.
- `INSTRUCTIONS.md` defines operating rules, tool-use posture, uncertainty handling, and when to ask the user.
- `MEMORY.md` must be empty. Do not invent continuity facts, preferences, or history for a new profile.

Use the available-tools context when it is present. Assign the basic tools by default: `read_file`, `write_file`, `edit_file`, `search_files`, `knowledge_base_search`, and `update_profile_memory`. Recommend or assign additional tools only when they clearly match the user's requested profile purpose. Do not assign every available tool.

When choosing tools:

- Prefer small, relevant tool sets.
- Treat custom tools as optional capabilities that need a clear fit.
- Avoid powerful or externally visible tools unless the user asked for that capability.
- Summarize which tools were assigned and why.

The profile should be ready to use after creation: name, soul files, empty memory, and a practical starter tool set.
