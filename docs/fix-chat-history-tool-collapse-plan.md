# Fix tool call flicker when opening chat history

## Problem

`resumeSession` sets `busy` to `true` while it fetches saved messages. `ChatPageContent` passes `busy` as `streamActive` to the message list. The latest saved tool group then renders as live and expanded. When the session status check finishes, `busy` becomes `false` and the group collapses after 360 ms. `streamActive` also controls other message-list behavior, so changing its meaning would cause regressions.

## Plan

1. In `apps/web/src/pages/chat/use-chat-page.ts`, clear `turnStartedAt` when a session load begins. Keep setting it when `getSessionStatus` reports an active turn, and when a new send starts. Clear it when the turn ends, as today.
2. Add an optional `workStreamActive` prop to `ChatMessageList` in `apps/web/src/components/chat/chat-message-list.tsx`. Default it to `streamActive` so the automation run history keeps its current behavior. Use this prop only when marking the latest assistant work group active. Keep `streamActive` for loading text, message actions, and other existing behavior. Key the list by `sessionId` when present, because saved messages reuse IDs such as `history-0` across chats and can otherwise carry an open group into another chat.
3. In `apps/web/src/pages/chat/chat-page-content.tsx`, keep `streamActive={busy}` and pass `workStreamActive={turnStartedAt !== null}`. Keep `busy` for the composer and `actionsDisabled`.
4. Keep the current expansion and collapse behavior for a genuinely live turn. Do not change the tool or thinking components.

## Acceptance checks

1. Open a finished chat from history: saved tool calls and thinking are collapsed on first render and never expand by themselves. Message actions and loading text keep their current behavior.
2. Open a chat with a running turn: saved content stays collapsed during loading; the current work group expands after the server reports the active turn, then collapses when it ends.
3. Send a new message: its tool calls expand while the turn runs and collapse when it ends. Composer loading and disabled states still work.
4. Open a running automation conversation: its current work group still expands.
5. Add a focused happy-dom message-list test that asserts the tool toggle stays collapsed when `streamActive` is true but `workStreamActive` is false, expands when both are true, and resets when switching sessions with matching saved message IDs. Stub Virtuoso's viewport so the row renders in the test DOM. Run that test, the existing chat message turn tests, web type check, and lint check.

## Scope

Web chat and the shared message-list prop. No server, API, or data changes.
