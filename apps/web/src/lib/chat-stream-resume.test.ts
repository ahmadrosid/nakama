import { describe, expect, test } from "bun:test";
import {
  createReplayAwareHandlers,
  isActiveTurnConflictError,
  materializedToolCallIds,
  seedStreamingStateForActiveTurn,
} from "./chat-stream-resume";
import type { ChatListItem } from "./chat-history";

describe("chat-stream-resume", () => {
  test("materializedToolCallIds collects tool rows", () => {
    const messages: ChatListItem[] = [
      { id: "1", role: "user", content: "hi" },
      {
        id: "tool_1",
        role: "tool",
        content: "bash completed",
        toolCallId: "call_1",
        tool: "bash",
        toolStatus: "done",
      },
    ];

    expect(materializedToolCallIds(messages)).toEqual(new Set(["call_1"]));
  });

  test("seedStreamingStateForActiveTurn appends assistant shell after user message", () => {
    const messages: ChatListItem[] = [{ id: "1", role: "user", content: "hi" }];
    const next = seedStreamingStateForActiveTurn(messages);

    expect(next).toHaveLength(2);
    expect(next[1]?.role).toBe("assistant");
    expect(next[1]?.streaming).toBe(true);
  });

  test("seedStreamingStateForActiveTurn appends assistant shell after tool rows", () => {
    const messages: ChatListItem[] = [
      { id: "1", role: "user", content: "run" },
      {
        id: "tool_1",
        role: "tool",
        content: "bash completed",
        toolCallId: "call_1",
        tool: "bash",
        toolStatus: "running",
      },
    ];
    const next = seedStreamingStateForActiveTurn(messages);

    expect(next.at(-1)?.role).toBe("assistant");
    expect(next.at(-1)?.streaming).toBe(true);
  });

  test("createReplayAwareHandlers skips materialized tool events", () => {
    const seen: string[] = [];
    const handlers = createReplayAwareHandlers(
      {
        onChunk: () => {},
        onToolStart: (event) => {
          seen.push(event.toolCallId);
        },
      },
      new Set(["call_1"]),
    );

    handlers.onToolStart?.({
      toolCallId: "call_1",
      tool: "bash",
      input: {},
    });
    handlers.onToolStart?.({
      toolCallId: "call_2",
      tool: "bash",
      input: {},
    });

    expect(seen).toEqual(["call_2"]);
  });

  test("isActiveTurnConflictError detects server conflict copy", () => {
    expect(
      isActiveTurnConflictError("A response is already in progress for this session."),
    ).toBe(true);
  });
});
