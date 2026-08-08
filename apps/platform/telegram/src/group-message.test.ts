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
    chatType?: "group" | "supergroup";
    messageThreadId?: number;
  } = {}
): Context {
  const text = options.text ?? "";
  const replyFrom = options.replyToBot
    ? { id: botInfo.id, is_bot: true as const }
    : undefined;

  return {
    chat: { id: -100_123, type: options.chatType ?? "supergroup" },
    message: {
      entities: options.entities,
      message_thread_id: options.messageThreadId,
      reply_to_message: replyFrom ? { from: replyFrom } : undefined,
      text,
    },
  } as unknown as Context;
}

describe("group-message helpers", () => {
  test("isTelegramGroupChat detects group and supergroup", () => {
    expect(isTelegramGroupChat(groupContext({ chatType: "group" }))).toBe(true);
    expect(isTelegramGroupChat(groupContext({ chatType: "supergroup" }))).toBe(
      true
    );
    expect(
      isTelegramGroupChat({
        chat: { id: 1, type: "private" },
      } as Context)
    ).toBe(false);
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
    const ctx = {
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
    } as unknown as Context;

    expect(shouldHandleGroupMessage(ctx)).toBe(true);
  });

  test("resolveBotInfo prefers ctx.me over stored bot info", () => {
    const ctx = {
      me: { first_name: "Bot", id: 42, is_bot: true, username: "live_bot" },
    } as Context;

    expect(resolveBotInfo(ctx, { id: 1, username: "stale" })).toEqual({
      id: 42,
      username: "live_bot",
    });
  });

  test("shouldHandleGroupMessage accepts text_mention entity from mention picker", () => {
    const ctx = {
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
    } as unknown as Context;

    expect(shouldHandleGroupMessage(ctx, botInfo)).toBe(true);
  });

  test("resolveChannelOrgKey scopes org store by group or user", () => {
    expect(resolveChannelOrgKey("-100123", 42, true)).toBe("g:-100123");
    expect(resolveChannelOrgKey("42", 42, false)).toBe("u:42");
  });

  test("resolveConversationKey preserves private and group keys without topics", () => {
    expect(
      resolveConversationKey(
        {
          chat: { id: 42, type: "private" },
          message: { text: "hello" },
        } as unknown as Context,
        "42",
        false
      )
    ).toBe("42");
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
    expect(resolveConversationKey({} as Context, "-100123", true)).toBe(
      "-100123"
    );
    expect(
      resolveConversationKey(
        { chat: { id: -100_123, type: "supergroup" } } as Context,
        "-100123",
        true
      )
    ).toBe("-100123");
  });
});
