# Reduce repeated code

## Goal

Share code only where the behavior is the same today. Keep provider and UI differences visible at their call sites.

## Plan

1. **Share streamed tool call handling.** Move `PendingToolCall`, `mergePendingToolCall`, and `finalizePendingToolCalls` into `apps/server/src/providers/shared.ts`. Replace the local copies in `openai/index.ts`, `openrouter/index.ts`, and `openai-compatible/index.ts`. Keep each provider's stream reader and error handling in its own module. Confirm that the OpenRouter SDK tool delta fits the shared input type without a cast. If it does not, keep only the common finalizer in `shared.ts`.
2. **Share web source parsing helpers.** Move `readRecord`, `readString`, `normalizeSourceUrl`, and `dedupeSources` into the existing `apps/web/src/components/chat/web-search.shared.ts` module, which already holds `WebSearchSource`. Import them in `chat-stream-web-search.ts` and `chat-stream-web-fetch.ts`. Keep search and fetch result parsing separate because they accept different result shapes.
3. **Use one settings row only if its output stays the same.** Compare the two `SettingsRow` components in `integration-settings.shared.tsx` and `discord-settings-card.shared.tsx`. Discord's current row callers pass strings for `description`, so use the existing integration component if its spacing and text wrap match. Update Discord imports and remove its duplicate. Keep both components if sharing needs new style options or changes the rendered UI.

## Keep separate

- Keep the Discord and Telegram token fields separate. Their setup steps and labels differ. A shared field would need several content options.
- Keep pairing controls separate. Their linked states and button behavior differ.
- Keep `WebSearchToolRow` and `WebFetchToolRow` separate for now. Their state builders and render rules differ, and both already use `WebSourceCard`.
- Keep menu and popover content separate. They wrap different Base UI controls.
- Keep channel save request builders separate. Each is short and uses its channel request type.
- Keep channel artifact cleanup separate. Discord preserves `sessionIds` on `/clear`; Telegram and WhatsApp currently omit it. Their handlers are short, and sharing them could change saved session data. Review that behavior as a separate correctness task.

## Checks

1. Add one focused shared test for tool call order, partial tool deltas, and invalid JSON arguments. Run `bun test apps/server/src/providers/shared.test.ts apps/server/src/providers/openai/stream.test.ts apps/server/src/providers/openrouter/index.test.ts apps/server/src/providers/openai-compatible/index.test.ts` and `bun run --filter @nakama/server build`.
2. From `apps/web`, run `bun test src/lib/chat-stream-web-search.test.ts src/lib/chat-stream-web-fetch.test.ts`. From the repository root, run `bun x tsc --noEmit -p apps/web/tsconfig.json`. Add a first-source assertion only if the existing tests do not cover duplicate URLs.
3. Run `bun x tsc --noEmit -p apps/web/tsconfig.json` and `bun x ultracite check` after the settings row change. Check that its labels, description, spacing, and child layout stay the same. Use a browser check only if requested.

Each step passes its listed checks. Do not add a package or an abstraction for one call site.
