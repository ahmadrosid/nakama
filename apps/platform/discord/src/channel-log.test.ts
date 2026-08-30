import { afterEach, describe, expect, test } from "bun:test";
import {
  formatDiscordInboundMessageLog,
  isChannelDebugEnabled,
} from "./channel-log";

describe("formatDiscordInboundMessageLog", () => {
  const previousDebug = process.env.NAKAMA_CH_DEBUG;

  afterEach(() => {
    if (previousDebug === undefined) {
      delete process.env.NAKAMA_CH_DEBUG;
    } else {
      process.env.NAKAMA_CH_DEBUG = previousDebug;
    }
  });

  test("omits author and channel ids by default", () => {
    delete process.env.NAKAMA_CH_DEBUG;
    expect(isChannelDebugEnabled()).toBe(false);
    const line = formatDiscordInboundMessageLog({
      author: { id: "user_secret_9" },
      channelId: "channel_secret_9",
      content: "hello",
      id: "msg_1",
    });
    expect(line).toContain("messageId=msg_1");
    expect(line).toContain("textBytes=5");
    expect(line).not.toContain("user_secret_9");
    expect(line).not.toContain("channel_secret_9");
    expect(line).not.toContain("authorId=");
    expect(line).not.toContain("channelId=");
  });

  test("includes author and channel ids when NAKAMA_CH_DEBUG=1", () => {
    process.env.NAKAMA_CH_DEBUG = "1";
    expect(isChannelDebugEnabled()).toBe(true);
    const line = formatDiscordInboundMessageLog({
      author: { id: "user_secret_9" },
      channelId: "channel_secret_9",
      content: "hello",
      id: "msg_1",
    });
    expect(line).toContain("authorId=user_secret_9");
    expect(line).toContain("channelId=channel_secret_9");
  });
});
