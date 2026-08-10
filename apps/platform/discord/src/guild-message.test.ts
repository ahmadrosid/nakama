import { describe, expect, test } from "bun:test";
import {
  explainGuildMessageHandling,
  resolveConversationKey,
  resolveOrgChannelId,
  stripBotMention,
} from "./guild-message";

const BOT_INFO = { id: "999000111222333444", username: "nakamabot" };

const GUILD_ID = "guild_1";
const BOT_ROLE_ID = "1525964112708894884";
const OTHER_ROLE_ID = "role_other";

function createGuildMessage(options: {
  content?: string;
  mentionsBot?: boolean;
  mentionedRoleIds?: string[];
  botHeldRoleIds?: string[];
  replyToBot?: boolean;
  thread?: boolean;
  parentId?: string | null;
}) {
  const channelId = "channel_1";
  const messages = new Map<string, { author: { id: string } }>();
  const mentionedRoleIds = options.mentionedRoleIds ?? [];
  const botHeldRoleIds = new Set(options.botHeldRoleIds ?? []);

  if (options.replyToBot) {
    messages.set("reply_1", { author: { id: BOT_INFO.id } });
  }

  return {
    author: { bot: false, id: "user_1" },
    channel: {
      id: options.thread ? "thread_1" : channelId,
      isDMBased: () => false,
      isThread: () => options.thread === true,
      messages: { cache: messages },
      parentId:
        options.parentId === null ? null : (options.parentId ?? channelId),
    },
    client: { user: { id: BOT_INFO.id, username: BOT_INFO.username } },
    content: options.content ?? "",
    guild: {
      id: GUILD_ID,
      members: {
        me: {
          roles: {
            cache: {
              has: (id: string) => botHeldRoleIds.has(id),
            },
          },
        },
      },
    },
    mentions: {
      roles: {
        keys: () => mentionedRoleIds.values(),
      },
      users: {
        has: (id: string) => (options.mentionsBot ? id === BOT_INFO.id : false),
      },
    },
    reference: options.replyToBot ? { messageId: "reply_1" } : null,
  } as never;
}

describe("explainGuildMessageHandling", () => {
  test("ignores messages without trigger", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "hello everyone" }),
      BOT_INFO
    );

    expect(decision.shouldHandle).toBe(false);
    expect(decision.reason).toBe("no-trigger");
  });

  test("handles @mention", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        content: "<@999000111222333444> hi",
        mentionsBot: true,
      }),
      BOT_INFO
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("bot-mention");
  });

  test("handles @mention of a role the bot holds", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        botHeldRoleIds: [BOT_ROLE_ID],
        content: `<@&${BOT_ROLE_ID}> can you pull the latest main branch`,
        mentionedRoleIds: [BOT_ROLE_ID],
      }),
      BOT_INFO
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("bot-mention");
  });

  test("ignores @mention of a role the bot does not hold", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        botHeldRoleIds: [BOT_ROLE_ID],
        content: `<@&${OTHER_ROLE_ID}> hello`,
        mentionedRoleIds: [OTHER_ROLE_ID],
      }),
      BOT_INFO
    );

    expect(decision.shouldHandle).toBe(false);
    expect(decision.reason).toBe("no-trigger");
  });

  test("ignores @everyone role mention", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        botHeldRoleIds: [GUILD_ID],
        content: `<@&${GUILD_ID}> hello`,
        mentionedRoleIds: [GUILD_ID],
      }),
      BOT_INFO
    );

    expect(decision.shouldHandle).toBe(false);
    expect(decision.reason).toBe("no-trigger");
  });

  test("claims a foreign thread when a held role is @mentioned", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({
        botHeldRoleIds: [BOT_ROLE_ID],
        content: `<@&${BOT_ROLE_ID}> please join`,
        mentionedRoleIds: [BOT_ROLE_ID],
        thread: true,
      }),
      BOT_INFO,
      { botOwnsThread: false }
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("claim-thread");
  });

  test("handles reply to bot", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "follow up", replyToBot: true }),
      BOT_INFO
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("reply-to-bot");
  });

  test("handles messages in bot-owned threads without mention", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "continue here", thread: true }),
      BOT_INFO,
      { botOwnsThread: true }
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
      { botOwnsThread: true }
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("in-thread");
  });

  test("ignores messages in threads the agent did not start", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "continue here", thread: true }),
      BOT_INFO,
      { botOwnsThread: false }
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
      { botOwnsThread: false }
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
      { botOwnsThread: false }
    );

    expect(decision.shouldHandle).toBe(true);
    expect(decision.reason).toBe("claim-thread");
  });

  test("still requires a trigger in plain channels", () => {
    const decision = explainGuildMessageHandling(
      createGuildMessage({ content: "" }),
      BOT_INFO
    );

    expect(decision.shouldHandle).toBe(false);
    expect(decision.reason).toBe("no-text");
  });
});

describe("resolveConversationKey", () => {
  test("uses thread suffix for thread channels", () => {
    const key = resolveConversationKey(
      createGuildMessage({ parentId: "parent_1", thread: true }),
      "thread_1",
      true
    );

    expect(key).toBe("g:parent_1:t:thread_1");
  });

  test("uses hydrated parent when partial thread lacks parentId", () => {
    const key = resolveConversationKey(
      createGuildMessage({ parentId: null, thread: true }),
      "thread_1",
      true,
      { parentChannelId: "parent_hydrated" }
    );

    expect(key).toBe("g:parent_hydrated:t:thread_1");
  });
});

describe("resolveOrgChannelId", () => {
  test("uses parent channel id for guild threads", () => {
    const message = createGuildMessage({ parentId: "parent_1", thread: true });
    expect(resolveOrgChannelId(message, "thread_1", true)).toBe("parent_1");
  });

  test("uses channel id for plain guild channels", () => {
    const message = createGuildMessage({ content: "hi" });
    expect(resolveOrgChannelId(message, "channel_1", true)).toBe("channel_1");
  });

  test("prefers resolved parent over thread id when parentId is missing", () => {
    const message = createGuildMessage({ parentId: null, thread: true });
    expect(resolveOrgChannelId(message, "thread_1", true)).toBe("thread_1");
    expect(
      resolveOrgChannelId(message, "thread_1", true, {
        parentChannelId: "parent_1",
      })
    ).toBe("parent_1");
  });
});

describe("stripBotMention", () => {
  test("removes mention markup", () => {
    expect(stripBotMention(`<@!${BOT_INFO.id}> question`, BOT_INFO)).toBe(
      "question"
    );
  });

  test("removes held role mention markup", () => {
    expect(
      stripBotMention(
        `<@&${BOT_ROLE_ID}> can you pull the latest main branch`,
        BOT_INFO,
        [BOT_ROLE_ID]
      )
    ).toBe("can you pull the latest main branch");
  });
});
