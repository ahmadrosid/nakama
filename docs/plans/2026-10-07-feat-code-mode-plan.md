---
title: "Code mode for agent tools"
type: feat
date: 2026-10-07
origin: https://github.com/ahmadrosid/nakama/issues/1680
status: proposed
---

# Code mode for agent tools

## Goal

Let an agent use one `execute` call to run a short JavaScript program against its assigned tools. The program can make dependent calls, run safe independent calls together, and return a small result. Intermediate tool results stay out of model context.

Success means an agent can list issues from an assigned MCP tool, filter them in code, and return five matches without sending the full list to the model. The same path must work for a built-in read tool.

## Current flow

- `AgentService.resolveProfileTools()` collects assigned built-in, MCP, Composio, plugin, and skill tools. It applies channel, role, and profile gates before chat starts.
- `createAgentChatSession()` calls `createTurnTools()` for plugin discovery, then exposes active definitions to the provider.
- `executeToolCalls()` runs provider tool calls and appends each result to chat history. It runs a batch together only when every tool is `parallelSafe`.
- `executeToolCall()` invokes the tool and may shorten its output with `distillToolResult()`.
- `buildToolExecutionContext()` supplies the profile workspace, organization, user, session, and cancellation signal.
- Chat history stores normal tool calls and results. Automation runs also store each call as a step before execution and use those steps after a restart.

These parts provide the host tool set and execution context. No current path lets model-written code call those tools inside one provider tool call.

## OpenCode lessons

OpenCode exposes one `execute` tool backed by a confined JavaScript interpreter. It gives the program an explicit tool tree, a searchable catalog, call limits, and plain-data input and output. The host still owns authorization. Its MCP adapter keeps file content outside the interpreter and attaches it to the outer result.

Borrow those boundaries, not its runtime code. `@opencode-ai/codemode` is currently a private OpenCode workspace package and uses Effect. Nakama should first test a small QuickJS WASM adapter under Bun and the Docker build. QuickJS supports memory limits and interrupt handlers, but its promise job loop needs explicit handling. Do not start the agent integration until this check passes.

References: [OpenCode design](https://github.com/anomalyco/opencode/blob/dev/packages/codemode/codemode.md), [OpenCode adapter](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/code-mode.ts), [QuickJS documentation](https://github.com/justjake/quickjs-emscripten/blob/main/README.md).

## Scope and behavior

1. Add code mode to the shared agent loop for chat, CLI, and messaging channels. Leave automations off until their restart path can handle nested calls.
2. Build the catalog from tools assigned to the session. Include MCP tools with valid input schemas and an explicit set of built-in data tools, starting with `search_files`. Do not resolve tools from another profile or organization.
3. Keep direct tools visible in the first release. `execute` reduces round trips and intermediate results. It does **not** yet reduce the provider's tool catalog size.
4. Keep shell, custom code tools, coding agents, sub-agents, interaction tools, and attachment tools direct. Provider-hosted tools never enter the code mode catalog.
5. Give the program only exact-name tool functions, `search`, and JSON-like data. It has no direct access to process, imports, filesystem, network, environment variables, or host objects. Assigned tools can still access resources through their normal host rules.
6. Keep the inline catalog small. Return exact tool names, descriptions, and input schemas from bounded catalog search. Reject duplicate or unsafe names rather than guessing a callable path.
7. Keep each child call's original organization, user, role, profile, channel, workspace, and cancellation context. The leaf tool keeps its authorization and approval checks.
8. Validate each child input against its `ToolDefinition.parameters` before dispatch. If a schema cannot be validated safely, leave that tool direct. Reject unsafe object keys and non-JSON values.
9. Recheck an MCP server's enabled state on every child call, as its current bridge does. Use the same session assignment snapshot as direct calls; a new session picks up assignment changes.
10. Allow concurrent child calls only for `parallelSafe` tools. MCP tools have no such flag today, so run them one at a time. Run all other calls exclusively, in call order, even if the program uses `Promise.all`.
11. Enforce time, memory, call-count, concurrency, input-size, child-result-size, and final-output limits. Pass cancellation through the MCP bridge too. Do not retry a mutating call after an uncertain timeout.
12. Persist each child call's name, input, result or error, status, timing, organization, and parent call ID outside model history. Start the record before dispatch. Keep intermediate results out of provider context.
13. Expose `execute` only for a stored session with an organization and working audit callbacks. Exclude cognito sessions, which have no session row. A missing or failed audit callback must never allow an unrecorded child call.
14. Gate the first release with `NAKAMA_CODE_MODE=1`. Keep normal direct calls available when the setting is off or a tool is outside the catalog.

## Design

```text
assigned tools -> catalog -> provider: direct tools + execute
                                            |
                                            v
                              confined JavaScript runtime
                                            |
                                exact-name child dispatch
                                            |
                              existing ToolDefinition.run()
                                            |
                              small execute result -> history
```

Create the `execute` definition from the same assigned tool snapshot used by `createTurnTools()` in `packages/agent/src/chat.ts`. Build the execution context before deciding whether `execute` is available. Rebuild the wrapper when that session resets active tools for a user turn. Put a bounded inline catalog and the search rule in the `execute` description. Use the same model-facing tool list for provider calls, token estimates, and compaction. Keep the runtime adapter in `packages/agent`; pass host audit callbacks through `ToolContext`. Do not add a workspace or a general plugin API.

Use a fresh sandbox for each `execute` call. Copy tool inputs and results across the boundary as JSON-like data. Reject functions, cycles, oversized values, and unsafe object keys before the program sees them. Do not use `eval`, `new Function`, or `node:vm` as the isolation boundary.

Track every child promise on the host. Do not report a successful `execute` call while child calls still run, even if the program forgot to await them. Drain those calls and their audit writes before disposal. On cancellation or timeout, signal active calls, mark unsettled outcomes unknown, and never replay them automatically.

Reuse `executeToolCall()` for child error handling and the leaf tool's `run()` method. Add an internal option to leave child results intact; `distillToolResult()` could remove data the program needs. Apply the final output limit to the outer `execute` result sent to history. Convert a child `{ error }` result into a rejected program promise with a safe message. Never expose host stack traces.

Validate arguments on the host before calling `executeToolCall()`. Use a JSON Schema validator for MCP schemas and the existing `ToolDefinition.parameters` contract. Do not treat model-facing signatures as validation. A missing schema means the existing empty-object input contract. Exclude schemas the validator cannot enforce; the direct tool remains available.

Add child-call records through the existing database migration path and `ToolContext` callbacks for begin and complete. `executeToolCalls()` must pass the provider's outer tool-call ID into `execute`; child IDs derive from it. An audit begin write must finish before the child tool starts; if it fails, do not run the tool. Missing callbacks disable `execute`. Complete the record after the child settles, including failure or cancellation. A record left running after a crash means "outcome unknown" and must not trigger a retry. Store records outside `session_messages`, so history replay and context estimates still see only the outer `execute` call. Scope each write and read by organization and session; verify that the session belongs to that organization. Delete child records when the session is deleted. Bound stored result size and mark truncation. The server must store records for web, CLI, and channel sessions without making the agent package depend on the database.

Keep image, audio, and file payloads on the host side. The first release supports MCP text and structured results. The current MCP manager returns `structuredContent` before checking other content. Pass a host-owned code-mode child marker through `ToolContext` and the MCP bridge so the manager can inspect the raw response before projection. Return a private `{ value, hasMedia }` envelope only to that child path; keep direct tool results unchanged. If a call returns media, stop that program with a clear "result not available in code mode" status. Record that the call already ran; never suggest repeating it, because it may have changed external data. Do not copy base64 data into the sandbox or audit record. Media forwarding needs its own end-to-end check before such results become supported.

## Implementation steps

1. **Prove the sandbox.** Run a QuickJS program under Bun and Docker. Test an async host call, `Promise.all`, a busy loop, memory exhaustion, cancellation, and absence of ambient filesystem or network access. If limits fail, choose another confined runtime before integration.
2. **Add the runtime adapter.** Create one sandbox per call. Supply exact-name tool functions through a host bridge. Add bounded catalog search, JSON Schema input validation, JSON-like data copying, and child-call scheduling. Reuse an installed validator if it covers the schemas; otherwise add one direct dependency.
3. **Add child audit storage.** Update `packages/db/sql/schema.sql`, the migration in `packages/db/src/migrate.ts`, database types, and the SQLite adapter. Insert each child record before its tool runs. Add organization and session guards, session-delete cascade, and a size limit. Keep results outside model history.
4. **Wire the agent loop.** Build `execute` from assigned tools and use the existing execution context. Keep direct tools for fallback. Exclude `execute` itself and ineligible tools from its catalog. Pass host audit callbacks from `AgentService`. Pass `ToolContext.signal` and the host-owned child marker through `buildMcpToolDefinitions()`, `McpService.callTool()`, and `McpClientManager.callTool()`; the current MCP path has no signal. Detect media before the MCP manager discards raw content. Keep the private envelope out of direct tool results and model history.
5. **Add opt-in and coverage.** Gate `execute` with `NAKAMA_CODE_MODE=1` for stored, non-cognito sessions. Test chat with one MCP tool and `search_files`, including audit retention, cross-organization isolation, a media result without repeat, cancellation, and serialized writes. Compare context use and elapsed time with direct calls. If the sandbox needs a package, update its workspace manifest and root lockfile. Update `.docker/runtime-deps` and regenerate its lockfile for both image architectures.

Automation support is a follow-up. Before enabling it, extend `replayAutomationSteps()` to journal nested calls and report uncertain effects. Never replay an interrupted mutating child.

## Acceptance checks

- A program can call assigned `search_files` and an assigned MCP tool, filter both text or structured results, and return one small value.
- A program cannot call a tool outside its assignment snapshot, a disabled MCP server, or a cross-organization tool.
- A program cannot recurse through `execute` or directly reach process, filesystem, network, or host secrets.
- Invalid child arguments stop before the tool runs. Unsupported schemas keep their tools direct.
- Dependent calls work. Two `parallelSafe` built-in reads overlap. MCP and mutating calls do not overlap other child calls.
- A program that returns before awaiting a child still waits for that child's settlement and audit write before `execute` reports success.
- A busy loop, many calls, and large output each stop within the configured limits. Cancellation stops the program and signals active children; an uncooperative remote tool may finish later.
- A child tool failure gives the model a useful error without exposing host internals. Every started child has a durable record, even if the program later fails.
- A missing audit callback or failed start write prevents child execution.
- A session deletion removes its child records. A cognito session never receives `execute`.
- A media result reports that its tool already ran. It never prompts an automatic repeat of a call with an unknown effect.
- Direct tool calls still work when code mode is off or when a tool cannot enter the sandbox.
- Automations do not receive `execute` before the restart test proves that interrupted side effects are never repeated.
- Bun tests, type checks, and the Docker runtime build pass. No browser check is needed because the first release adds no UI.

## Implementation gates

- Choose the fixed limits from measured sandbox and tool timings. Keep them as host constants until a real need for configuration appears.
- Keep eligible direct tools visible in the first release. A later catalog reduction needs a separate check of prompt guidance, tool discovery, provider behavior, and context estimates. Do not claim catalog token savings in the first release.

Issue #1680 has no `stage: now` label. This file is a plan; implementation starts when the issue is selected for work.
