import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "./chat-history";
import {
  createReplayAwareHandlers,
  isActiveTurnConflictError,
  materializedToolCallIds,
  seedStreamingStateForActiveTurn,
} from "./chat-stream-resume";

describe("chat-stream-resume", () => {
  test("materializedToolCallIds collects tool rows", () => {
    const messages: ChatListItem[] = [
      { content: "hi", id: "1", role: "user" },
      {
        content: "bash completed",
        id: "tool_1",
        role: "tool",
        tool: "bash",
        toolCallId: "call_1",
        toolStatus: "done",
      },
    ];

    expect(materializedToolCallIds(messages)).toEqual(new Set(["call_1"]));
  });

  test("seedStreamingStateForActiveTurn appends assistant shell after user message", () => {
    const messages: ChatListItem[] = [{ content: "hi", id: "1", role: "user" }];
    const next = seedStreamingStateForActiveTurn(messages);

    expect(next).toHaveLength(2);
    expect(next[1]?.role).toBe("assistant");
    expect(next[1]?.streaming).toBe(true);
  });

  test("seedStreamingStateForActiveTurn appends assistant shell after tool rows", () => {
    const messages: ChatListItem[] = [
      { content: "run", id: "1", role: "user" },
      {
        content: "bash completed",
        id: "tool_1",
        role: "tool",
        tool: "bash",
        toolCallId: "call_1",
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
      new Set(["call_1"])
    );

    handlers.onToolStart?.({
      input: {},
      tool: "bash",
      toolCallId: "call_1",
    });
    handlers.onToolStart?.({
      input: {},
      tool: "bash",
      toolCallId: "call_2",
    });

    expect(seen).toEqual(["call_2"]);
  });

  test("isActiveTurnConflictError detects server conflict copy", () => {
    expect(
      isActiveTurnConflictError(
        "A response is already in progress for this session."
      )
    ).toBe(true);
  });
});
