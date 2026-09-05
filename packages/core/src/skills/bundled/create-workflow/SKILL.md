---
name: create-workflow
description: Create and run user-triggered workflows with declared steps. Use when the user asks about a workflow or wants a verifiable recipe (fetch, compare, summarize) they can run on demand from chat or the dashboard.
include-body-on-match: true
---

When the user wants a workflow they can run on demand (for example "morning brief"), explain the step recipe clearly before saving.

Use `create_workflow` with `kind` (never `type`). Last step must be `summarize` with `prompt` (never `instruction`).

```json
[
  { "id": "news", "kind": "tool", "tool": "web_fetch", "input": { "url": "https://news.ycombinator.com" } },
  { "id": "summary", "kind": "summarize", "prompt": "Write a brief from the receipts only." }
]
```

- `tool` — assigned profile or MCP tool that can run locally; `input` must match that tool's schema. Use `web_fetch` for URLs. Do not use `web_search` — it only runs inside a provider chat turn.
- `compare` / `assert` / `template` — deterministic on prior receipts, fail closed. `compare.op` is `eq` | `near` | `contains`. Do not use compare as free-text analysis
- exactly one final `summarize` — turns the receipt bag into prose (no tools)

When the user names a profile to run as, confirm that profile and pass its `profileId`. Omit `profileId` to use the current chat profile.

When the user asks to run a saved workflow, use `list_workflows` to find it, then `run_workflow`. Never invent or edit a workflow id. Reuse the id from `list_workflows`. Pass `input` when the recipe uses `{{input.*}}` bindings.

When the user wants to change an existing workflow, use `update_workflow`.

Do not use workflows for clock-driven jobs — use `create_automation` for schedules.
