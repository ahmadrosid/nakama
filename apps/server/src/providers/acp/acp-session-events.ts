import type * as acp from "@agentclientprotocol/sdk";
import type { StreamChatHandlers } from "@nakama/core";
import { readRecord } from "../shared";

/**
 * Turns the ACP `session/update` stream into the handler calls the chat loop
 * already renders. ACP tool calls carry a title on `tool_call` only, so the
 * title is remembered and reused for the matching `tool_call_update`.
 */
export function createAcpUpdateMapper(handlers: StreamChatHandlers) {
  const toolTitles = new Map<string, string>();
  let assistantText = "";

  return {
    assistantText: () => assistantText,

    handle(notification: acp.SessionNotification): void {
      const update = notification.update;

      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          if (update.content.type !== "text") {
            return;
          }

          assistantText += update.content.text;
          handlers.onChunk(update.content.text);

          return;
        }

        case "agent_thought_chunk": {
          if (update.content.type === "text") {
            handlers.onThinking?.(update.content.text);
          }

          return;
        }

        case "tool_call": {
          toolTitles.set(update.toolCallId, update.title);
          handlers.onToolStart?.({
            input: readRecord(update.rawInput),
            tool: update.title,
            toolCallId: update.toolCallId,
          });

          return;
        }

        case "tool_call_update": {
          if (update.status !== "completed" && update.status !== "failed") {
            return;
          }

          handlers.onToolEnd?.({
            result: update.rawOutput ?? update.content ?? null,
            tool: toolTitles.get(update.toolCallId) ?? update.title ?? "tool",
            toolCallId: update.toolCallId,
          });

          return;
        }

        default:
          return;
      }
    },
  };
}
