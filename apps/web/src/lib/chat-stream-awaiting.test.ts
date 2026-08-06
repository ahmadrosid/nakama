import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "@/lib/chat-history";
import {
  awaitingModelLabel,
  buildStreamHandlers,
  isAwaitingModelResponse,
} from "./chat-stream";

function assistant(partial: Partial<ChatListItem> & { id: string }): ChatListItem {
  return {
    role: "assistant",
    content: "",
    ...partial,
  };
}

function tool(partial: Partial<ChatListItem> & { id: string; tool: string }): ChatListItem {
  return {
    role: "tool",
    content: partial.tool,
    toolCallId: partial.id,
    toolStatus: "done",
    ...partial,
  };
}

describe("isAwaitingModelResponse", () => {
  test("false when thinking is streaming", () => {
    expect(
      isAwaitingModelResponse([
        { id: "u1", role: "user", content: "hi" },
        assistant({ id: "a1", streaming: true, thinkingStreaming: true, thinking: "" }),
      ]),
    ).toBe(false);
  });

  test("true when empty streaming assistant waits for first token", () => {
    expect(
      isAwaitingModelResponse([
        { id: "u1", role: "user", content: "hi" },
        assistant({ id: "a1", streaming: true }),
      ]),
    ).toBe(true);
  });

  test("false when text is streaming", () => {
    expect(
      isAwaitingModelResponse([
        { id: "u1", role: "user", content: "hi" },
        assistant({ id: "a1", streaming: true, content: "Hello" }),
      ]),
    ).toBe(false);
  });

  test("false while a tool is running", () => {
    expect(
      isAwaitingModelResponse([
        { id: "u1", role: "user", content: "hi" },
        assistant({ id: "a1", streaming: false, thinking: "plan" }),
        tool({ id: "t1", tool: "list_profiles", toolStatus: "running" }),
      ]),
    ).toBe(false);
  });

  test("true after tools complete while waiting for next turn", () => {
    expect(
      isAwaitingModelResponse([
        { id: "u1", role: "user", content: "hi" },
        assistant({ id: "a1", streaming: false, thinking: "plan" }),
        tool({ id: "t1", tool: "list_profiles", toolStatus: "done" }),
        tool({ id: "t2", tool: "list_tools", toolStatus: "done" }),
      ]),
    ).toBe(true);
  });
});

describe("awaitingModelLabel", () => {
  test("Thinking… before any tools or thinking text", () => {
    expect(
      awaitingModelLabel([
        { id: "u1", role: "user", content: "hi" },
        assistant({ id: "a1", streaming: true }),
      ]),
    ).toBe("Thinking…");
  });

  test("Working… after tools", () => {
    expect(
      awaitingModelLabel([
        { id: "u1", role: "user", content: "hi" },
        tool({ id: "t1", tool: "list_profiles", toolStatus: "done" }),
      ]),
    ).toBe("Working…");
  });
});

describe("buildStreamHandlers onThinking after tools", () => {
  test("seeds a new streaming assistant when last message is a tool", () => {
    let messages: ChatListItem[] = [
      { id: "u1", role: "user", content: "hi" },
      assistant({ id: "a1", streaming: false, thinking: "plan" }),
      tool({ id: "t1", tool: "list_profiles", toolStatus: "done" }),
    ];

    const handlers = buildStreamHandlers((updater) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
    });

    handlers.onThinking?.("next thought ");

    const last = messages[messages.length - 1];
    expect(last?.role).toBe("assistant");
    expect(last?.streaming).toBe(true);
    expect(last?.thinkingStreaming).toBe(true);
    expect(last?.thinking).toBe("next thought ");
    expect(isAwaitingModelResponse(messages)).toBe(false);
  });
});
