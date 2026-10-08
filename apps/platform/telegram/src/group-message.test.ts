import { describe, expect, test } from "bun:test";
import type { Context } from "grammy";
import {
  isTelegramGroupChat,
  resolveBotInfo,
  resolveChannelOrgKey,
  resolveConversationKey,
  shouldHandleGroupMessage,
  stripBotMention,
  type TelegramBotInfo,
} from "./group-message";

const botInfo: TelegramBotInfo = { id: 999, username: "mybot" };

function groupContext(
  options: {
    text?: string;
    entities?: Array<{ type: "mention"; offset: number; length: number }>;
    replyToBot?: boolean;
    chatType?: "group" | "private" | "supergroup";
    messageThreadId?: number;
  } = {}
): Context {
  const text = options.text ?? "";

  const replyFrom = options.replyToBot
    ? { id: botInfo.id, is_bot: true as const }
    : undefined;

  const context = {
    chat: { id: -100_123, type: options.chatType ?? "supergroup" },
    message: {
      entities: options.entities,
      message_thread_id: options.messageThreadId,
      reply_to_message: replyFrom ? { from: replyFrom } : undefined,
      text,
    },
  };

  // SAFETY: The fixture supplies the chat and message fields used by these helpers.
  return context as Context;
}

describe("group-message helpers", () => {
  test("isTelegramGroupChat detects group and supergroup", () => {
    expect(isTelegramGroupChat(groupContext({ chatType: "group" }))).toBe(true);
    expect(isTelegramGroupChat(groupContext({ chatType: "supergroup" }))).toBe(
      true
    );
    expect(isTelegramGroupChat(groupContext({ chatType: "private" }))).toBe(
      false
    );
  });

  test("shouldHandleGroupMessage accepts mention, reply, and slash commands", () => {
    expect(
      shouldHandleGroupMessage(
        groupContext({
          entities: [{ length: 6, offset: 0, type: "mention" }],
          text: "@mybot hello",
        }),
        botInfo
      )
    ).toBe(true);

    expect(stripBotMention("hi @mybot there", "mybot")).toBe("hi there");

    expect(
      shouldHandleGroupMessage(groupContext({ text: "hello" }), botInfo)
    ).toBe(false);

    expect(
      shouldHandleGroupMessage(groupContext({ replyToBot: true }), botInfo)
    ).toBe(true);

    expect(
      shouldHandleGroupMessage(groupContext({ text: "/status@mybot" }), botInfo)
    ).toBe(true);
  });

  test("shouldHandleGroupMessage matches @username using ctx.me", () => {
    const fixture = {
      chat: { id: -100_123, type: "supergroup" as const },
      me: {
        first_name: "Gavin",
        id: 999,
        is_bot: true,
        username: "try_gavin_bot",
      },
      message: {
        entities: [{ length: 14, offset: 0, type: "mention" as const }],
        text: "@try_gavin_bot what is in your memory",
      },
    };

    // SAFETY: The fixture supplies `me`, chat, and mention fields used by the helper.
    const ctx = fixture as Context;

    expect(shouldHandleGroupMessage(ctx)).toBe(true);
  });

  test("resolveBotInfo prefers ctx.me over stored bot info", () => {
    const fixture = {
      me: { first_name: "Bot", id: 42, is_bot: true, username: "live_bot" },
    };

    // SAFETY: The fixture supplies the live bot identity used by the helper.
    const ctx = fixture as Context;

    expect(resolveBotInfo(ctx, { id: 1, username: "stale" })).toEqual({
      id: 42,
      username: "live_bot",
    });
  });

  test("shouldHandleGroupMessage accepts text_mention entity from mention picker", () => {
    const fixture = {
      chat: { id: -100_123, type: "supergroup" as const },
      message: {
        entities: [
          {
            length: 8,
            offset: 0,
            type: "text_mention" as const,
            user: { first_name: "Nakama", id: botInfo.id, is_bot: true },
          },
        ],
        text: "Nakama hello",
      },
    };

    // SAFETY: The fixture supplies the chat and text mention fields used by the helper.
    const ctx = fixture as Context;

    expect(shouldHandleGroupMessage(ctx, botInfo)).toBe(true);
  });

  test("resolveChannelOrgKey scopes org store by group or user", () => {
    expect(resolveChannelOrgKey("-100123", 42, true)).toBe("g:-100123");
    expect(resolveChannelOrgKey("42", 42, false)).toBe("u:42");
  });

  test("resolveConversationKey preserves private and group keys without topics", () => {
    const privateContext = {
      chat: { id: 42, type: "private" },
      message: { text: "hello" },
    };

    // SAFETY: The fixture supplies the chat and text fields used by this helper.
    const ctx = privateContext as Context;

    expect(resolveConversationKey(ctx, "42", false)).toBe("42");
    expect(resolveConversationKey(groupContext(), "-100123", true)).toBe(
      "-100123"
    );
  });

  test("resolveConversationKey isolates group topics", () => {
    expect(
      resolveConversationKey(
        groupContext({ messageThreadId: 10 }),
        "-100123",
        true
      )
    ).toBe("g:-100123:t:10");
    expect(
      resolveConversationKey(
        groupContext({ messageThreadId: 11 }),
        "-100123",
        true
      )
    ).toBe("g:-100123:t:11");
  });

  test("resolveConversationKey tolerates missing message or chat", () => {
    // SAFETY: This test covers a missing chat and message.
    const emptyContext = {} as Context;

    expect(resolveConversationKey(emptyContext, "-100123", true)).toBe(
      "-100123"
    );
    const chatOnly = { chat: { id: -100_123, type: "supergroup" } };

    // SAFETY: This test covers a group chat without a message.
    const chatContext = chatOnly as Context;
    expect(
      resolveConversationKey(
        chatContext,
        "-100123",
        true
      )
    ).toBe("-100123");
  });
});
