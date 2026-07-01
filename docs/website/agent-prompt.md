# Agent prompt

When a user starts chatting with a profile, TinyClaw builds one system prompt from several sources.

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

TinyClaw first resolves the profile's main prompt.

If the profile has soul files, TinyClaw uses them:

| File | Injected as |
|------|-------------|
| `SOUL.md` | Identity |
| `STYLE.md` | Voice and style |
| `INSTRUCTIONS.md` | Operating instructions |
| `MEMORY.md` | Continuity |
| `examples/*.md` | Calibration examples |

If there are no soul files, TinyClaw uses the profile's stored `systemPrompt`.

If both exist and they are different, the stored `systemPrompt` is appended as extra profile instructions.

## Extra profile context

After the main profile prompt, TinyClaw may append:

- Assigned skills catalog
- Knowledge base catalog
- Super Bot tool-authoring rules, only for super profiles

## Chat wrapper

The chat runtime then wraps the profile prompt with general chat instructions:

- User context from `USER.md`, when available
- The user's timezone
- Tool-use guidance for assigned tools
- Memory and skill rules when those tools are available
- Telegram or WhatsApp behavior when the message comes from those channels

When soul is active, TinyClaw tells the agent to use tools while staying in character.

## Per-turn context

On each user message, TinyClaw can add fresh context for that turn:

- Active todo/task state
- Skills matched to the current user message

This context is not permanent. It is attached only when relevant for the current turn.

## Current date

Right before sending the request to the LLM, TinyClaw appends the current date:

```text
Today is <current date>.
```

## Where this lives in code

| Step | File |
|------|------|
| Build profile prompt | `apps/server/src/services/agent-service.ts` |
| Compose soul files | `packages/core/src/soul/compose.ts` |
| Build chat wrapper | `packages/agent/src/chat-prompt.ts` |
| Add per-turn context | `packages/agent/src/chat.ts` |
| Send final prompt to provider | `packages/agent/src/chat.ts` |

