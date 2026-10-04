# Add Netra Runtime as an LLM provider

## Goal

Let an organization add Netra Runtime with its API key, choose an available chat model, and use it for Nakama agent turns. Reuse the existing OpenAI-compatible client and provider-instance code. Add no package or standalone provider client.

## Evidence and decisions

- [Netra's API guide](https://app.netraruntime.com/docs/reference.md) specifies the base URL `https://api.netraruntime.com/v1`, Bearer authentication, `GET /v1/models`, and `POST /v1/chat/completions`.
- [Netra's model guide](https://app.netraruntime.com/docs/models.md) names two distinct models: **DeepSeek V4.1 Flash** is `deepseek/deepseek-v4.1-flash`; **DeepSeek V4 Flash 0731** is `deepseek/deepseek-v4-flash-0731`. The earlier plan gave the V4 ID the V4.1 name. Do not repeat that error.
- The supplied screenshot shows organization rates of $0.10 input, $0.01 cached input, and $0.25 output per million tokens for its displayed model. The [published rates](https://app.netraruntime.com/docs/models.md) differ. Nakama must not bundle the screenshot's rates as public rates.
- Model availability, limits, features, and effective prices can differ by organization. Use the authenticated model list for IDs. That list is not a full pricing or capability record. Do not infer prices or features from it.
- Netra documents tool calls and tool-result continuation through its gateway for V4 Flash 0731. It documents image input and thinking for V4.1 Flash. The guide does not claim that V4.1 tool continuation works. A Nakama agent needs this checked before V4.1 becomes a usable agent model.
- Netra's [reasoning guide](https://app.netraruntime.com/docs/parameters.md) says ordinary requests without a reasoning control default to thinking off, while tool requests can default to high thinking. It prefers one canonical `reasoning` object.
- Netra's [streaming guide](https://app.netraruntime.com/docs/streaming.md) says a stream can contain a terminal error after HTTP 200. A partial answer must not count as success.

## Major gaps in the first plan

1. It used the wrong model ID for V4.1 Flash. A valid V4 request would appear under the wrong model name and rates.
2. It assumed a fixed model catalog, although Netra provides an authenticated organization catalog. That could offer unavailable models or omit organization models.
3. It left pricing and thinking behavior open. Current Nakama code sends two reasoning controls and sends no explicit off control. Netra's tool default can override a user's thinking-off choice.
4. It did not cover native reasoning details in tool continuation. Nakama currently stores plain thinking text and tool calls, then rebuilds the assistant message. Netra says to keep returned detail blocks and tool IDs in order.
5. It did not cover terminal stream errors, model refresh preserving saved rates, or Netra's model-specific JSON behavior.

## Implementation plan

1. Add `netra` to `ProviderName`, provider parsing, API-key environment mapping (`NETRA_API_KEY`), provider labels, web choices, and CLI setup. Accept any nonempty API key. Use the existing server-side secret storage and provider-instance scope.
2. Add Netra to `DISCOVERY_MODEL_PROVIDERS` with base URL `https://api.netraruntime.com/v1`. During setup and model refresh, call authenticated `GET /v1/models` with the saved or entered key. Let the admin choose an exact returned chat model ID. Show both DeepSeek IDs under their correct names when present. The model list alone cannot prove that an organization model supports chat or tools. Keep an explicit manual-ID fallback if discovery fails; validate that ID with a small chat request before treating setup as ready.
3. Connect Netra to existing discovery paths in `apps/server/src/services/agent-service.ts`, provider-instance creation and editing, `getModelsForProviderInstance`, web setup, Settings, and CLI setup. Store the selected model as the default entry in the instance's `customModels`; keep profile model selections in their existing store. A refresh must keep selected IDs and admin-entered capabilities and rates for matching IDs. Mark a removed ID unavailable and require a new choice before the next turn.
4. Add the `netra` branch in `apps/server/src/providers/create.ts`. Use Chat Completions at the documented base URL. Reject a `responses` wire setting for this provider. Send the key as a Bearer token. Check that `/chat/completions` appears once in the final URL. Keep provider name `netra` in usage records.
5. Add Netra-specific request handling in the existing OpenAI-compatible module. Send exactly one canonical `reasoning` object. Send `{"enabled":false}` when Nakama thinking is off, including tool turns. Map Nakama `medium` to Netra `high`, as Netra documents. When thinking is on, send a supported effort and parse reasoning separately from answer text. Do not send unsupported sampling fields from the screenshot by default.
6. Test tool calls for each selectable model with a real request or recorded cassette. Check automatic tool choice, streamed argument fragments, exact tool-call IDs, tool results, and a completed second answer. V4 Flash 0731 has documented gateway support. Make V4.1 or an organization model available for Nakama agent use only if this check passes. Enforce that rule in server model selection as well as the picker.
7. Preserve any returned `reasoning_details` blocks, their order, signatures, and encrypted data through the tool loop and saved chat history. Replay them with the original assistant tool calls and matching tool results. Do not replace them with plain thinking text or invented blocks. If Netra requires these blocks for a model and Nakama cannot preserve them, do not enable that model for tool turns.
8. Handle SSE reasoning fields, tool fragments, empty-choice usage chunks, `[DONE]`, and terminal error events. If the stream reports an error or closes before a valid end, return an error with any partial output kept for inspection. Do not report the partial text as a completed agent reply. Check that cached input stays a subset of prompt tokens and reasoning tokens stay a subset of completion tokens.
9. Keep Netra cost unknown until an admin supplies all required rates for that organization's model. Use `CustomModelEntry` for input, cached input, and output rates. Retain those overrides on catalog refresh. Show the screenshot rates only as a user-entered example, never as a bundled rate. Do not use Nakama's generic $1/$3 fallback for Netra. Test the cached-token formula against Netra's documented example.
10. Check `generateText` against Netra's supported `response_format` for the selected model. If `json_object` is rejected, use a supported strict schema or prompt-only JSON path in the existing module. Verify title and other non-chat calls, not only streaming agent turns.
11. For V4.1, verify image input through Nakama's existing message-content conversion and set vision support only when the request works. Keep V4 Flash 0731 text-only. Do not add an image-generation endpoint.
12. Update user docs with the Netra API-key path, model discovery, model choice, and optional organization rates. Do not add Netra's separate MCP or tracing products to this provider change.

## Acceptance checks

1. A new organization can add Netra, discover models with its own key, select an exact ID, send a chat turn, and select the same model after restart.
2. The picker never calls V4 Flash 0731 “V4.1 Flash.” An ID absent from the current organization catalog is not silently replaced by another ID.
3. Thinking on and off produce the documented single control, including on tool turns. A tool call completes with the original ID and reasoning details preserved.
4. A streamed terminal error fails the turn. Empty-choice usage events update token counts without adding cached or reasoning tokens twice.
5. Unknown rates stay unknown. Saved organization rates survive model refresh and produce the expected cost for fresh, cached, and output tokens.
6. Tests cover model discovery, provider setup and selection, URL/auth/body, `generateText`, non-stream and stream replies, saved-history tool continuation, V4.1 image input, usage, and error events. Record a real provider cassette for the capability checks. Replay it offline in CI without the key.
7. Run focused tests, `bun run check`, `bun run test`, and `bun run knip`. Do not require a browser check for this plan.

## Release gate

Before making V4.1 selectable for agent turns, run its tool-continuation check with a Netra key. If it fails, ship the verified V4 Flash 0731 path and keep V4.1 unavailable in the agent picker. Record the result in the PR. Do not claim that the screenshot or the model list proves tool support.

## Implementation status

The provider setup, discovery, chat path, usage rates, and documentation are implemented. The agent picker and server permit DeepSeek V4 Flash 0731 only. V4.1 and other organization models remain unavailable because no live Netra key was supplied for a tool-continuation cassette. The image and tool protocol tests use mocked responses; they do not prove live model behavior.
