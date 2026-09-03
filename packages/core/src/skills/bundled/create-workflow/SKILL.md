---
name: create-workflow
description: Create and run user-triggered workflows with declared steps. Use when the user wants a verifiable recipe (fetch, compare, summarize) they can run on demand from chat or the dashboard.
include-body-on-match: true
---

When the user wants a workflow they can run on demand (for example "morning brief"), explain the step recipe clearly before saving.

Use `create_workflow` to save workflows with declared steps:
- `tool` steps call assigned profile tools or MCP tools
- `compare` / `assert` / `template` steps run deterministically on prior receipts
- exactly one final `summarize` step turns receipts into prose

When the user names a profile to run as, confirm that profile and pass its `profileId`. Omit `profileId` to use the current chat profile.

When the user asks to run a saved workflow, use `list_workflows` to find it, then `run_workflow`. Pass `input` when the recipe uses `{{input.*}}` bindings.

When the user wants to change an existing workflow, use `update_workflow`.

Do not use workflows for clock-driven jobs — use `create_automation` for schedules.
