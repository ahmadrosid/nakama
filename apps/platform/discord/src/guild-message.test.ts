import { describe, expect, test } from "bun:test";
import {
  explainGuildMessageHandling,
  resolveConversationKey,
  resolveOrgChannelId,
  stripBotMention,
} from "./guild-message";

const BOT_INFO = { id: "999000111222333444", username: "nakamabot" };

function createGuildMessage(options: {
  content?: string;
  mentionsBot?: boolean;
  replyToBot?: boolean;
  thread?: boolean;
  parentId?: string;
}) {
  const channelId = "channel_1";
  const messages = new Map<string, { author: { id: string } }>();

  if (options.replyToBot) {
    messages.set("reply_1", { author: { id: BOT_INFO.id } });
  }

  return {
    author: { id: "user_1", bot: false },
    content: options.content ?? "",
    mentions: {
      users: {
        has: (id: string) => (options.mentionsBot ? id === BOT_INFO.id : false),
      },
    },
    reference: options.replyToBot ? { messageId: "reply_1" } : null,
    client: { user: { id: BOT_INFO.id, username: BOT_INFO.username } },
    channel: {
      id: options.thread ? "thread_1" : channelId,
      isDMBased: () => false,
      isThread: () => options.thread === true,
      parentId: options.parentId ?? channelId,
      messages: { cache: messages },
    },
  } as never;
}

describe("explainGuildMessageHandling", () => {
  test("ignores messages without trigger", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "hello everyone" }),
      BOT_INFO,
    );

    expect(decision.shouldHandle).toBe(false);
    expect(decision.reason).toBe("no-trigger");
  });

  test("handles @mention", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "<@999000111222333444> hi", mentionsBot: true }),
      BOT_INFO,
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("bot-mention");
  });

  test("handles reply to bot", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "follow up", replyToBot: true }),
      BOT_INFO,
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("reply-to-bot");
  });

  test("handles messages in bot-owned threads without mention", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "continue here", thread: true }),
      BOT_INFO,
      { botOwnsThread: true },
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("in-thread");
  });

  test("handles messages in bot-owned threads that also mention the bot as in-thread", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        content: "<@999000111222333444> still in thread",
        mentionsBot: true,
        thread: true,
      }),
      BOT_INFO,
      { botOwnsThread: true },
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("in-thread");
  });

  test("ignores messages in threads the agent did not start", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "continue here", thread: true }),
      BOT_INFO,
      { botOwnsThread: false },
    );

    expect(decision.shouldHandle).toBe(false);
    expect(decision.reason).toBe("foreign-thread");
  });

  test("claims a foreign thread when the bot is @mentioned", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        content: "<@999000111222333444> please join",
        mentionsBot: true,
        thread: true,
      }),
      BOT_INFO,
      { botOwnsThread: false },
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("claim-thread");
  });

  test("claims a foreign thread when the user replies to the bot", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        content: "please join",
        replyToBot: true,
        thread: true,
      }),
      BOT_INFO,
      { botOwnsThread: false },
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("claim-thread");
  });

  test("still requires a trigger in plain channels", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "" }),
      BOT_INFO,
    );

    expect(decision.shouldHandle).toBe(false);
    expect(decision.reason).toBe("no-text");
  });
});

describe("resolveConversationKey", () => {
  test("uses thread suffix for thread channels", () => {
    const key = resolveConversationKey(
      createGuildMessage({ thread: true, parentId: "parent_1" }),
      "thread_1",
      true,
    );

    expect(key).toBe("g:parent_1:t:thread_1");
  });
});

describe("resolveOrgChannelId", () => {
  test("uses parent channel id for guild threads", () => {
    const message = createGuildMessage({ thread: true, parentId: "parent_1" });
    expect(resolveOrgChannelId(message, "thread_1", true)).toBe("parent_1");
  });

  test("uses channel id for plain guild channels", () => {
    const message = createGuildMessage({ content: "hi" });
    expect(resolveOrgChannelId(message, "channel_1", true)).toBe("channel_1");
  });
});

describe("stripBotMention", () => {
  test("removes mention markup", () => {
    expect(stripBotMention(`<@!${BOT_INFO.id}> question`, BOT_INFO)).toBe("question");
  });
});
