import { describe, expect, test } from "bun:test";
import type { ChatMessage, SessionMessageMeta } from "@tinyclaw/core/contract";
import { chatMessagesToListItems } from "./chat-history";

describe("chatMessagesToListItems", () => {
  test("preserves history index and metadata for rendered items", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tool_1", name: "search_files", arguments: { path: "src" } }],
      },
      { role: "tool", toolCallId: "tool_1", name: "search_files", content: "{\"ok\":true}" },
      { role: "assistant", content: "Done" },
    ];
    const messageMeta: SessionMessageMeta[] = [
      { id: "msg_1", seq: 0, createdAt: "2026-06-14T10:00:00.000Z" },
      { id: "msg_2", seq: 1, createdAt: "2026-06-14T10:00:01.000Z" },
      { id: "msg_3", seq: 2, createdAt: "2026-06-14T10:00:02.000Z" },
      { id: "msg_4", seq: 3, createdAt: "2026-06-14T10:00:03.000Z" },
    ];

    const items = chatMessagesToListItems(messages, messageMeta);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      role: "user",
      historyIndex: 0,
      createdAt: "2026-06-14T10:00:00.000Z",
    });
    expect(items[1]).toMatchObject({
      role: "tool",
      historyIndex: 2,
      createdAt: "2026-06-14T10:00:02.000Z",
      toolInput: { path: "src" },
    });
    expect(items[2]).toMatchObject({
      role: "assistant",
      historyIndex: 3,
      createdAt: "2026-06-14T10:00:03.000Z",
      content: "Done",
    });
  });
});
