import { describe, expect, test } from "bun:test";
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
