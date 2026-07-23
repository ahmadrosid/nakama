# How Agent Prompts Work

When a user starts chatting with a profile, Nakama builds one system prompt from several sources.

The short version:

```text
Profile soul/system prompt
+ skills catalog
+ knowledge base catalog
+ super bot rules, when enabled
+ USER.md context
+ timezone
+ tool instructions
+ channel instructions
+ per-turn todo and matched skill context
+ current date
```

## Main profile prompt

Nakama first resolves the profile's main prompt.

If the profile has soul files, Nakama uses them:

| File | Injected as |
|------|-------------|
| `SOUL.md` | Identity |
| `STYLE.md` | Voice and style |
| `INSTRUCTIONS.md` | Operating instructions |
| `MEMORY.md` | Continuity |

If there are no soul files, Nakama uses the profile's stored `systemPrompt`.

If both exist and they are different, the stored `systemPrompt` is appended as extra profile instructions.

## Extra profile context

After the main profile prompt, Nakama may append:

- Assigned skills catalog
- Knowledge base catalog
- Super Bot tool-authoring rules, only for super profiles

## Chat wrapper

The chat runtime then wraps the profile prompt with general chat instructions:

- User context from `USER.md`, when available
- The user's timezone
- Tool-use guidance for assigned tools
- Memory and skill rules when `read_file` and `edit_file` are available (bundled `update-profile-memory` and `archive-profile-memory` skills)
- Artifact guidance when `write_file` is available (bundled `save-artifact` skill)
- Word-document guidance when `write_docx` is available (use Markdown input; never target `.docx` paths with `write_file`)
- Coding-agent harness context when `coding-agent` matches ([Coding agent](/coding-agent))
- Telegram or WhatsApp behavior when the message comes from those channels
- Discord behavior when the message comes from a server channel (public replies)

When soul is active, Nakama tells the agent to use tools while staying in character.

## Per-turn context

On each user message, Nakama can add fresh context for that turn:

- Active todo/task state
- Skills matched to the current user message

This context is not permanent. It is attached only when relevant for the current turn.

## Current date

Right before sending the request to the LLM, Nakama appends the current date:

```text
Today is <current date>.
```

## Bundled system skills

Profiles do not use dedicated memory or artifact builtins. The chat wrapper nudges the agent toward bundled skills when the right file tools are assigned:

| Skill | When nudged | Purpose |
|-------|-------------|---------|
| `update-profile-memory` | `read_file` + `edit_file` | Append facts and preferences to active `MEMORY.md` |
| `archive-profile-memory` | `read_file` + `edit_file` | Move bullets from `MEMORY.md` into `memory-archive/` without deleting them |
| `save-artifact` | `write_file` or `write_docx` | Save persistent outputs under `artifacts/` with metadata for the dashboard; on web chat, paired saves also show as message attachment chips with in-chat preview |

The skills catalog is always visible. When a user message matches a skill description, Nakama can attach the full skill body for that turn (`include-body-on-match: true`).

Active `MEMORY.md` is also composed into the soul stack. Archived content under `memory-archive/` is not loaded automatically — the agent uses `search_files` or `read_file` to retrieve it. Artifacts under `artifacts/` are not loaded into the agent prompt — users browse them in the dashboard Artifacts tab, download via the API, or open them from web chat attachment chips on assistant messages (HTML, Markdown, Word, code, and text previews are rendered by content type).

See [Skills](/skills) for the bundled skill list and [Profiles](/profiles) for where memory and artifact files live on disk.

## Where this lives in code

| Step | File |
|------|------|
| Build profile prompt | `apps/server/src/services/agent-service.ts` |
| Compose soul files | `packages/core/src/soul/compose.ts` |
| Build chat wrapper | `packages/agent/src/chat-prompt.ts` |
| Add per-turn context | `packages/agent/src/chat.ts` |
| Send final prompt to provider | `packages/agent/src/chat.ts` |
