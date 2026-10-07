# Plan: make Workflows a built-in feature

Status: draft, not started. No code changed.

## Goal

Workflows stop being an official plugin (`packages/plugins/workflows`). They become part of the server, web app, and client. No install step. Same behavior. Existing data survives.

## Why

- The plugin needs an admin install, a spawned `bun` process per call, and a host RPC bridge (`plugin-agent-host.ts`) just to reach profile tools and the LLM.
- Core already knows about workflows in many places (`WorkflowRunToolRow`, `chat-stream-workflow.ts`, `query-keys.ts`, `agent-service` `runPluginSummarize`, `ToolContext.workflowId`). The plugin boundary is thin and leaks.
- `plugin-service.ts` has workflow special cases (`OFFICIAL_PLUGINS`, 300 s timeout, `plugin_workflows__` filter).

## CONTRIBUTING check ("Before you start building")

1. `stage: now` label — **open**. Confirm on the issue before PR.
2. Existing package can hold it — yes. Move code into `packages/core`, `packages/db`, `apps/server`, `apps/web`. No new workspace. The plugin workspace is deleted, so the count goes down.
3. Needs a folder the server cannot reach — no. Data moves into the main DB. No plugin data dir.
4. New abstraction with more than one caller — no new abstractions. Existing `WorkflowRunner` already takes injected deps. Keep that.

## What exists today

| Part | Location |
|---|---|
| Plugin manifest, 11 actions, 1 skill, 1 migration | `packages/plugins/workflows/nakama.plugin.json` |
| Step validation | `src/workflow-ops.ts`, `src/workflow-validate.ts` |
| Runner (tool, compare, assert, template, summarize) | `src/workflow-runner.ts` |
| Storage (per-org plugin SQLite: `workflows`, `runs`, `steps`, `metadata`) | `src/workflow-service.ts`, `migrations/001-workflows.sql` |
| Action dispatch | `src/actions.ts` → `actions/actions.js` (built file, committed) |
| UI (plugin runtime module, 1398 lines) | `src/ui.tsx` → `ui/app.js`, `ui/style.css` |
| Skill `create-workflow` | `skills/create-workflow/SKILL.md` |
| Host bridge (`profiles`, `tools`, `execute_tool`, `summarize`, `workflow_database`, `legacy_workflows`) | `apps/server/src/services/plugin-agent-host.ts` |
| Official install, `import_legacy` setup | `plugin-service.ts` (`OFFICIAL_PLUGINS`, ~L107, ~L471) |
| Client methods (go through `invokePluginAction`) | `packages/client/src/client.ts` ~L1980–2065 |
| Types | `packages/core/src/contract.ts` ~L1327–1485 (already core) |
| **Old built-in tables still in main DB** | `workflows`, `workflow_runs`, `workflow_run_steps` in `packages/db/sql/schema.sql`, `migrate.ts`, `adapters/sqlite.ts`, plus `DatabaseWorkflowStore` |

The old built-in storage was never removed. The plugin copies it once (`import_legacy`). This makes the move cheaper: the adapter methods already exist.

## Target design

### Storage

Use the main DB tables `workflows`, `workflow_runs`, `workflow_run_steps`. They are already org-scoped (`org_id`) and have adapter methods and `failInterruptedRuns` handling.

Check before coding: the plugin table has `lease_until` and a unique index "one running run per workflow". The old table has neither. Decide whether to add a partial unique index on `workflow_runs(workflow_id) WHERE status = 'running'` in a main-DB migration.

### Code placement

| Move | To |
|---|---|
| `workflow-ops.ts`, `workflow-validate.ts`, `workflow-runner.ts` (+ tests) | `packages/core/src/workflows/` |
| `workflow-service.ts` logic (create, update, list, runs, delete) | `apps/server/src/services/workflow-service.ts`, on `DatabaseWorkflowStore` + adapter. Drop the raw `bun:sqlite` code. |
| Runner deps `executeTool`, `runWorkflowSummarize` | Call `AgentService.resolvePluginExecutionTools`, `executeToolCall`, `runPluginSummarize` directly. No RPC. Rename the three methods (drop "Plugin"). |
| Agent tools `create_workflow`, `update_workflow`, `list_workflows`, `run_workflow` | `apps/server/src/tools/workflow-tools.ts` (same pattern as `skill-manage-tool.ts`) |
| Skill `create-workflow` | `packages/core/src/skills/bundled/create-workflow/SKILL.md`. Update tool names. |
| HTTP | `apps/server/src/http/routes/workflows.ts`, with `requireNotViewer` for mutate and run. Register in `app.ts` and `openapi.ts`. |
| Client | `packages/client/src/client.ts`: swap `invokePluginAction("workflows", …)` for REST calls. Keep method names. |
| UI | `apps/web/src/pages/WorkflowsPage.tsx` (+ small components if the file is too large). Port `ui.tsx`: `ctx.ui.*` → `@nakama/ui` imports, `ctx.host.call` → client, `ctx.styles(css)` → existing styling. Route + nav entry. `WorkflowRunToolRow` and `query-keys.ts` already exist. |

### Behavior to keep

- Recursion guard: steps cannot call workflow tools. Replace `startsWith("plugin_workflows__")` with the new tool names.
- Run timeout: 300 s today. Keep the same limit in the server run path.
- Access: members use workflows. Viewers blocked. Members cannot run as Super Bot.
- Run history, receipts, delete run.

### Decide: Data tab

The **Data** tab uses `inspectWorkflowSqlite` (`workflow_database` host op). It browses agent SQLite tools, not workflow storage. Options below.

## Steps

### PR 1 — built-in backend + client

1. Move runner/ops/validate + tests into `packages/core/src/workflows/`. Keep tests green.
2. Add `workflow-service.ts` in `apps/server`. Use `DatabaseWorkflowStore`. Add run-lock index if decided.
3. Add `workflow-tools.ts`. Register as built-in tools. Add the skill to bundled skills.
4. Add `routes/workflows.ts` + OpenAPI.
5. Point `packages/client` at the new routes.
6. Data migration (see below).
7. Tests: behavior only (status, stored data, side effects). Port `official-workflows.test.ts`, `workflow-service.test.ts`, `workflow-runner.test.ts`, `workflow-ops.test.ts`.

### PR 2 — web UI

1. Add `WorkflowsPage.tsx`, route, nav item. Reuse `pluginIcon("workflows")` icon.
2. Keep `WorkflowRunToolRow`; point it at the new tool names (`chat-stream-workflow.ts`).
3. Type check + build. Browser check only if asked.

### PR 3 — delete the plugin

1. Delete `packages/plugins/workflows/`.
2. `plugin-service.ts`: remove `workflows` from `OFFICIAL_PLUGINS`, the 300 s special case, and `setupAction` plumbing if Supermemory does not use it.
3. `plugin-agent-host.ts`: remove `workflow_database` and `legacy_workflows`. Check whether `profiles`, `tools`, `execute_tool`, `summarize` still have a caller (Supermemory). Delete what has none (knip will flag).
4. Remove `knip.jsonc` entry, `pluginIcon` and `PluginsPage` description entries, `plugin-runtime.test.ts` workflow cases.
5. Docs: rewrite `docs/website/content/docs/workflows.mdx` (no install steps; UI path from nav). Fix `ARCHITECTURE.md` lines 108, 123. Update `overview.mdx` if it mentions install.
6. `bun run knip`, `bun x ultracite check`, `bun test`.

PR 1 and PR 2 may merge as one if reviewers prefer. Do not ship PR 3 before the migration has run in a release.

## Data migration (existing installs)

Three cases:

| Org state | Action |
|---|---|
| Never installed plugin | Old tables hold the data (or nothing). It shows up built-in. No work. |
| Plugin installed | Plugin SQLite holds newer data. Old tables hold a stale copy from `import_legacy`. |
| Plugin uninstalled, data retained | Same as above if the data dir still exists. |

Startup migration, once per org, idempotent:

1. For each org with a `workflows` plugin install (or a retained data dir), open `getOrgPluginDataDir(orgId, "workflows")` SQLite read-only.
2. Upsert plugin rows into the main tables by `id`. Plugin wins on conflict. Map plugin `data` JSON → main columns (`name`, `profile_id`, `enabled`, `definition`, run `status`, `input`, `output`, `error`, steps `position`).
3. Settle runs still marked running (reuse `failInterruptedRuns` logic).
4. Record done in a metadata key. Do not delete the plugin data dir in this release.
5. Remove the `workflows` org plugin install record so it leaves the **Plugins** list. Keep a hidden tombstone in `PluginService` so an old release package cannot reinstall it.

Test with a fixture plugin DB: counts match, ids match, second run changes nothing.

## Tool rename (breaking for profiles and automations)

Old: `plugin_workflows__create_workflow` etc. Profiles that assigned these tools, and automation prompts that name them, break on rename.

Add a one-time remap in profile tool assignment resolution, and mention it in release notes. Update the `create-workflow` skill text.

## Risks

1. Tool rename breaks assigned profiles — mitigate with the remap above.
2. Concurrent run of the same workflow — plugin enforced it with a unique index. Do not lose this.
3. Data loss in migration — read-only source, keep plugin data dir for one release.
4. `ui.tsx` port is the largest diff (~1400 lines). Port as-is first, split later.
5. Supermemory still uses the host bridge. Do not delete shared ops blindly.

## Decisions for the owner

1. **Tool names.**
   1. Rename to `create_workflow`, `update_workflow`, `list_workflows`, `run_workflow` + remap old assignments (recommended).
   2. Rename, no remap. Admins reassign by hand.
   3. Keep `plugin_workflows__*` names as aliases forever.
2. **Data tab.**
   1. Drop it in this change (recommended: not part of workflows storage).
   2. Keep it, move `inspectWorkflowSqlite` behind a server route.
   3. Move it to the agent SQLite tool page later, separate issue.
3. **PR shape.**
   1. Three PRs: backend, UI, delete (recommended).
   2. One PR for everything.
   3. Two PRs: backend + UI, then delete.

## Out of scope

- Scheduling workflows (stays via automations).
- New step kinds.
- Changing the run model or receipts.
