# Agent runtime map

System prompt, soul, tools and tool execution. Root rules: [`../../AGENTS.md`](../../AGENTS.md).

## System prompt

Merged in `agent-service` `resolveProfileSystemPrompt` → `generateReply` (`provider.generateChat` / `streamChat`):

| Change | File | Fn |
|---|---|---|
| Chat structure (USER.md, tools, timezone, channels) | `packages/agent/src/chat-prompt.ts` | `buildChatSystemPrompt` |
| Soul content | `packages/core/src/soul/compose.ts` | `composeSoulSystemPrompt` |
| Skills catalog / loaded skill / agent-browser | `packages/core/src/skills/compose.ts` (`load_skill` tool: `apps/server/src/tools/skill-manage-tool.ts`) | `composeSkillsCatalog`, `composeLoadedSkillPrompt`, `composeAgentBrowserCapabilityPrompt` |
| Per-turn context (date, etc.) | `packages/agent/src/chat.ts` | `generateReply` |

Super Nakama rules: `SUPER_NAKAMA_SYSTEM_PROMPT` in `packages/db/src/constants.ts`.

## Tools (`packages/core/src/tools/`)

| Tool / skill | Notes |
|---|---|
| `update-profile-memory` / `archive-profile-memory` | MEMORY.md ↔ memory-archive/ |
| `save_artifact` / `artifact-design` | Persist under `artifacts/`; skill holds design rules |
| `knowledge_base_search` / `web_search` / `email` | KB, web, mailbox |
| `search_files` / `ripgrep` | File/content search |
| `bash` | Profile workspace shell — assign per profile; Super Nakama by default |
| `sub_agent` | Opt-in same-profile delegate (not repo coding) |
| `coding-agent` | Repo coding via Codex / Claude Code / OpenCode / pi / Cursor Agent (`agent`) through `bash` — use instead of `sub_agent` for coding |
| `agent-browser` | Opt-in browser CLI; needs host install — `docs/website/content/docs/agent-browser.mdx` |
| `create-profile` | Super Nakama only, confirm-first — `apps/server/src/tools/super-nakama-tools.ts` |
| `skill_manage` | Web/cli skill CRUD + auto-assign — `apps/server/src/tools/skill-manage-tool.ts` (approval, curator, post-turn review live there) |
| Composio | Org toolkits + per-user OAuth — `docs/website/content/docs/composio.mdx` |

**Channel artifacts (Telegram/Discord/WhatsApp):** `packages/core/src/channel-artifacts.ts`, `packages/core/src/channel-artifact-delivery.ts`; handlers in `apps/platform/{telegram,discord,whatsapp}/src/channel-artifact-flow.ts`.

## Tool execution & workspace

Path bugs (a tool resolves under the repo instead of `~/.nakama`) → start here. Override root: `NAKAMA_CONFIG_DIR`.

| | Built-in | Custom JS | Custom Python |
|---|---|---|---|
| Code | `packages/core/src/tools/`, `apps/server/src/tools/` | `~/.nakama/orgs/{orgId}/tools/*.js` | `~/.nakama/orgs/{orgId}/tools/*.py` |
| Workspace | `getProfileSoulDir` inside handler | `context.workspaceRoot`, **not** `process.cwd()` | `NAKAMA_WORKSPACE_ROOT` env |
| Loader | builtins map | `apps/server/src/services/javascript-tool-loader.ts` | `apps/server/src/services/python-tool-loader.ts` |

- Profile workspace / soul: `~/.nakama/orgs/{orgId}/profiles/{profileId}/` (`getProfileSoulDir`). Load with `loadSoulStack()`, inject with `composeSoulSystemPrompt()`
- Custom tools dir: `getCustomToolsDir(orgId)`; `~/.nakama/tools/` only when there is no org
- Always build context with `buildToolExecutionContext()` (`packages/core/src/tools/context.ts`) and a real `profileId`, so `workspaceRoot` = soul dir. Monorepo-root paths mean `workspaceRoot` is missing

| Flow | Entry |
|---|---|
| Chat | `agent-service` → `buildChatSession()` → `buildToolExecutionContext(...)` |
| Tool loop | `packages/agent/src/tool-loop.ts` → `executeToolCall()`; parallel batching in `packages/agent/src/chat.ts` when every call is `parallelSafe` |
| Playground | `POST /v1/tools/:toolId/run` → `runToolPlayground()` |
| Param suggest | `POST /v1/tools/:toolId/params/suggest` |

**Parallel tool calls:** `parallelSafe: true` on read/search/fetch builtins (`read_file`, `search_files`, `knowledge_base_search`, `web_search`, `web_fetch`). Mutating / shell stay sequential; `sub_agent` is the exception and runs in parallel. Custom JS opts in via `handlerConfig.parallelSafe`; Python always sequential. Mixed turn → whole turn sequential.

**Playground UI:** `/system/playground/:toolId` — `apps/web/src/pages/ToolPlaygroundPage.tsx`, `apps/web/src/components/tools/ToolPlaygroundPanel.tsx`; admin-only via `canUseToolPlayground()`.
