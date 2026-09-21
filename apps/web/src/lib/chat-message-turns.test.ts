import { describe, expect, test } from "bun:test";
import {
  segmentAssistantTurn,
  toolGroupElapsedSeconds,
} from "@/components/chat/assistant-tool-group.shared";
import type { ChatListItem } from "./chat-history";
import { groupMessagesIntoTurns, turnKey } from "./chat-message-turns";

function item(
  partial: Pick<ChatListItem, "id" | "role"> & Partial<ChatListItem>
): ChatListItem {
  return {
    content: "",
    ...partial,
  };
}

describe("groupMessagesIntoTurns", () => {
  test("keeps the latest work active between batches until the response ends", () => {
    const messages = [
      item({ id: "t1", role: "tool", toolStatus: "done" }),
      item({ content: "Progress", id: "a1", role: "assistant" }),
      item({ id: "t2", role: "tool", toolStatus: "done" }),
    ];
    expect(segmentAssistantTurn(messages, true)).toMatchObject([
      { kind: "work" },
      { kind: "text" },
      { active: true, kind: "work" },
    ]);
    expect(segmentAssistantTurn(messages, true)[0]).not.toHaveProperty(
      "active",
      true
    );
    messages.push(
      item({
        content: "Final reply",
        id: "a2",
        role: "assistant",
        streaming: true,
      })
    );
    expect(segmentAssistantTurn(messages, true)[2]).toHaveProperty(
      "active",
      true
    );
    expect(segmentAssistantTurn(messages, false)[2]).toHaveProperty(
      "active",
      false
    );
    // Cancellation must win even if the last tool event still says running.
    expect(
      segmentAssistantTurn(
        [item({ id: "cancelled", role: "tool", toolStatus: "running" })],
        false
      )[0]
    ).toHaveProperty("active", false);
  });
  test("tool duration survives reload and measures parallel tools as a span", () => {
    const tools = [
      item({
        id: "t1",
        role: "tool",
        toolCompletedAt: 9000,
        toolStartedAt: 1000,
        toolStatus: "done",
      }),
      item({
        id: "t2",
        role: "tool",
        toolCompletedAt: 6000,
        toolStartedAt: 2000,
        toolStatus: "done",
      }),
    ];
    expect(toolGroupElapsedSeconds(tools, 100_000)).toBe(8);
    expect(toolGroupElapsedSeconds(tools, 12_000, true)).toBe(11);
    expect(toolGroupElapsedSeconds(tools, 200_000)).toBe(8);
    expect(
      toolGroupElapsedSeconds([{ ...tools[0]!, toolStatus: "running" }], 12_000)
    ).toBe(11);
    expect(
      toolGroupElapsedSeconds(
        [
          item({
            createdAt: new Date().toISOString(),
            id: "old",
            role: "tool",
          }),
        ],
        100_000
      )
    ).toBeNull();
  });
  test("returns empty turns for empty messages", () => {
    expect(groupMessagesIntoTurns([])).toEqual([]);
  });

  test("groups user, assistant+tools, user into three turns", () => {
    const messages: ChatListItem[] = [
      item({ content: "hi", id: "u1", role: "user" }),
      item({ id: "t1", role: "tool", tool: "bash", toolStatus: "done" }),
      item({ content: "done", id: "a1", role: "assistant" }),
      item({ content: "next", id: "u2", role: "user" }),
    ];

    const turns = groupMessagesIntoTurns(messages);

    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ kind: "user", message: { id: "u1" } });
    expect(turns[1]?.kind).toBe("assistant");
    if (turns[1]?.kind === "assistant") {
      expect(turns[1].messages.map(({ message }) => message.id)).toEqual([
        "t1",
        "a1",
      ]);
    }
    expect(turns[2]).toMatchObject({ kind: "user", message: { id: "u2" } });
  });

  test("keeps consecutive assistants and tools in one assistant turn", () => {
    const messages: ChatListItem[] = [
      item({ content: "thinking aloud", id: "a0", role: "assistant" }),
      item({ id: "t1", role: "tool", tool: "bash", toolStatus: "done" }),
      item({ content: "final", id: "a1", role: "assistant" }),
    ];

    const turns = groupMessagesIntoTurns(messages);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.kind).toBe("assistant");
    if (turns[0]?.kind === "assistant") {
      expect(turns[0].messages.map(({ message }) => message.id)).toEqual([
        "a0",
        "t1",
        "a1",
      ]);
    }
  });

  test("keeps explicit tool groups stable across message updates", () => {
    const segments = segmentAssistantTurn([
      item({ id: "t1", role: "tool", tool: "read_file", toolGroupId: "g1" }),
      item({ id: "a1", role: "assistant", thinking: "progress" }),
      item({ id: "t2", role: "tool", tool: "search_files", toolGroupId: "g1" }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      groupId: "t1",
      kind: "work",
      tools: [{ id: "t1" }, { id: "t2" }],
    });
  });

  test("merges successive tool batches and trailing reasoning", () => {
    const tools = [3, 4, 6].flatMap((count, group) =>
      Array.from({ length: count }, (_, index) =>
        item({
          id: `${group}-${index}`,
          role: "tool",
          toolGroupId: `g${group}`,
        })
      )
    );
    const segments = segmentAssistantTurn([
      ...tools,
      item({ id: "thinking", role: "assistant", thinking: "Next step" }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      groupId: "0-0",
      thinking: { thinking: "Next step" },
      tools,
    });
  });

  test("preserves reasoning and a stable group as work streams", () => {
    const first = item({
      id: "a1",
      role: "assistant",
      thinking: "First step",
      thinkingStreaming: true,
    });
    const tool = item({ id: "t1", role: "tool", toolGroupId: "g1" });
    const duringTool = segmentAssistantTurn([first, tool]);
    expect(duringTool[0]).toMatchObject({
      groupId: "a1",
      thinking: { thinkingStreaming: false },
    });
    const segments = segmentAssistantTurn([
      first,
      tool,
      item({
        id: "a2",
        role: "assistant",
        thinking: "Second step",
        thinkingStreaming: true,
      }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      groupId: "a1",
      thinking: {
        thinking: "First step\n\nSecond step",
        thinkingStreaming: true,
      },
    });
    expect(first.thinkingStreaming).toBe(true);
  });

  test("visible text separates work even when tool group IDs match", () => {
    const segments = segmentAssistantTurn([
      item({ id: "t1", role: "tool", toolGroupId: "g1" }),
      item({
        content: "Progress update",
        id: "a1",
        role: "assistant",
        thinking: "Reviewing results",
      }),
      item({ id: "t2", role: "tool", toolGroupId: "g1" }),
      item({ content: "Done", id: "a2", role: "assistant" }),
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "work",
      "text",
      "work",
      "text",
    ]);
    expect(segments[0]).toMatchObject({
      thinking: { thinking: "Reviewing results" },
      tools: [{ id: "t1" }],
    });
    expect(segments[1]).toMatchObject({
      message: { content: "Progress update" },
    });
    expect(segments[2]).toMatchObject({
      groupId: "t2",
      tools: [{ id: "t2" }],
    });
  });
});

describe("turnKey", () => {
  test("uses user message id", () => {
    const turn = groupMessagesIntoTurns([
      item({ content: "hi", id: "u1", role: "user" }),
    ])[0]!;
    expect(turnKey(turn)).toBe("u1");
  });

  test("keeps assistant key stable when a tool appends", () => {
    const base = groupMessagesIntoTurns([
      item({ content: "x", id: "a1", role: "assistant" }),
      item({ id: "t1", role: "tool", tool: "bash", toolStatus: "done" }),
    ])[0]!;
    const withExtra = groupMessagesIntoTurns([
      item({ content: "x", id: "a1", role: "assistant" }),
      item({ id: "t1", role: "tool", tool: "bash", toolStatus: "done" }),
      item({ id: "t2", role: "tool", tool: "bash", toolStatus: "done" }),
    ])[0]!;

    expect(turnKey(base)).toBe("assistant:a1");
    expect(turnKey(withExtra)).toBe("assistant:a1");
  });
});
