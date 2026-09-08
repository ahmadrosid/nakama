import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "@/lib/chat-history";
import {
  clearFailedChatTurn,
  readFailedChatTurn,
  storeFailedChatTurn,
} from "@/lib/chat-history";
import {
  appendFailedTurnIfNeeded,
  editedPromptText,
  findFailedRetryPrompt,
  markStreamingTurnFailed,
  messagesWithoutFailedTurn,
  nextSuccessfulTurnAt,
  planPromptBranch,
} from "@/pages/chat/chat-page.shared";

function user(
  content: string,
  extras: Partial<ChatListItem> = {}
): ChatListItem {
  return { content, id: `user-${content}`, role: "user", ...extras };
}

function assistant(
  content: string,
  extras: Partial<ChatListItem> = {}
): ChatListItem {
  return {
    content,
    id: `asst-${content || "empty"}`,
    role: "assistant",
    ...extras,
  };
}

describe("markStreamingTurnFailed", () => {
  test("converts a streaming assistant into a failed marker", () => {
    const messages = [
      user("hello"),
      assistant("", { id: "stream", streaming: true }),
    ];

    const next = markStreamingTurnFailed(messages, "Rate limited");

    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      content: "Rate limited",
      failed: true,
      id: "stream",
      streaming: false,
    });
  });

  test("appends a failed marker when only the user message remains", () => {
    const next = markStreamingTurnFailed([user("hello")], "Boom");

    expect(next).toHaveLength(2);
    expect(next[0]?.content).toBe("hello");
    expect(next[1]).toMatchObject({
      content: "Boom",
      failed: true,
      role: "assistant",
    });
  });
});

describe("appendFailedTurnIfNeeded", () => {
  test("appends stored user + failed assistant after reload", () => {
    const next = appendFailedTurnIfNeeded(
      [user("earlier", { historyIndex: 0 })],
      {
        error: "429",
        text: "retry me",
      }
    );

    expect(next.map((message) => message.role)).toEqual([
      "user",
      "user",
      "assistant",
    ]);
    expect(next[1]).toMatchObject({ content: "retry me", role: "user" });
    expect(next[2]).toMatchObject({
      content: "429",
      failed: true,
      role: "assistant",
    });
  });

  test("is a no-op when a failed marker is already present", () => {
    const messages = [user("retry me"), assistant("429", { failed: true })];

    expect(
      appendFailedTurnIfNeeded(messages, { error: "429", text: "retry me" })
    ).toBe(messages);
  });
});

describe("failed turn retry helpers", () => {
  test("finds the prompt and strips the optimistic failed turn", () => {
    const failed = assistant("429", { failed: true, id: "failed" });
    const messages = [
      user("kept", { historyIndex: 0 }),
      user("retry me"),
      failed,
    ];

    expect(findFailedRetryPrompt(messages, failed)?.content).toBe("retry me");
    expect(messagesWithoutFailedTurn(messages, failed)).toEqual([
      user("kept", { historyIndex: 0 }),
    ]);
  });

  test("keeps a persisted user message when stripping a failed marker", () => {
    const failed = assistant("429", { failed: true, id: "failed" });
    const messages = [user("persisted", { historyIndex: 0 }), failed];

    expect(messagesWithoutFailedTurn(messages, failed)).toEqual([
      user("persisted", { historyIndex: 0 }),
    ]);
  });
});

describe("failed chat turn storage", () => {
  function withLocalStorage<T>(run: (store: Map<string, string>) => T): T {
    const store = new Map<string, string>();
    const previousLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => {
          store.delete(key);
        },
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });

    try {
      return run(store);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    }
  }

  test("round-trips a failed turn and clears it", () => {
    withLocalStorage(() => {
      const sessionId = `session_failed_${Date.now()}`;
      storeFailedChatTurn(sessionId, {
        error: "Rate limit",
        text: "hello",
      });

      expect(readFailedChatTurn(sessionId)).toEqual({
        error: "Rate limit",
        text: "hello",
      });

      clearFailedChatTurn(sessionId);
      expect(readFailedChatTurn(sessionId)).toBeNull();
    });
  });

  test("rejects malformed storage payloads", () => {
    withLocalStorage((store) => {
      const sessionId = `session_bad_${Date.now()}`;
      store.set(
        `nakama:failed-chat-turn:${sessionId}`,
        JSON.stringify({ error: "x" })
      );

      expect(readFailedChatTurn(sessionId)).toBeNull();
    });
  });
});

describe("nextSuccessfulTurnAt", () => {
  test("uses wall clock when there is no previous stamp", () => {
    expect(nextSuccessfulTurnAt(null, 1000)).toBe(1000);
  });

  test("keeps wall clock when time advances", () => {
    expect(nextSuccessfulTurnAt(1000, 1005)).toBe(1005);
  });

  test("bumps by 1ms when two turns finish in the same millisecond", () => {
    expect(nextSuccessfulTurnAt(1000, 1000)).toBe(1001);
  });

  test("stays monotonic when wall clock moves backwards", () => {
    expect(nextSuccessfulTurnAt(1000, 999)).toBe(1001);
  });
});

describe("the edit flow", () => {
  /** Two finished turns, so editing the second prompt has somewhere to branch. */
  function transcript(): ChatListItem[] {
    return [
      user("deploy command?", { historyIndex: 0 }),
      assistant("bun run deploy", { historyIndex: 1 }),
      user("and for staging?", { historyIndex: 2 }),
      assistant("bun run deploy:staging", { historyIndex: 3 }),
    ];
  }

  test("branches before the edited prompt and carries the turns before it", () => {
    const messages = transcript();
    const edited = messages[2]!;

    const plan = planPromptBranch(messages, edited);

    expect(plan?.messageIndex).toBe(1);
    expect(
      plan?.initialMessages.map((message) => message.historyIndex)
    ).toEqual([0, 1]);
  });

  test("sends the trimmed edit, not the original text", () => {
    const messages = transcript();
    const edited = messages[2]!;

    expect(editedPromptText(edited, "  and for production?  ")).toBe(
      "and for production?"
    );
  });

  test("stops before branching when the text did not change", () => {
    const messages = transcript();
    const edited = messages[2]!;

    expect(editedPromptText(edited, "and for staging?")).toBeNull();
    expect(editedPromptText(edited, "  and for staging?  ")).toBeNull();
    expect(editedPromptText(edited, "   ")).toBeNull();
  });

  test("starts a fresh session when the edited prompt opens the session", () => {
    const messages = transcript();

    expect(planPromptBranch(messages, messages[0]!)).toBeNull();
  });

  test("starts a fresh session for a prompt that is not in history yet", () => {
    const messages = transcript();

    expect(planPromptBranch(messages, user("not sent yet"))).toBeNull();
  });

  test("ignores rows the branch cannot replay", () => {
    const messages = [
      ...transcript(),
      user("unsent follow-up"),
      assistant("failed", { failed: true }),
    ];
    const edited = messages[2]!;

    const plan = planPromptBranch(messages, edited);

    expect(plan?.initialMessages).toHaveLength(2);
  });
});
