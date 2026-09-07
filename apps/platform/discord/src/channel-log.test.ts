import { describe, expect, test } from "bun:test";
import { formatDiscordInboundMessageLog } from "./channel-log";

describe("formatDiscordInboundMessageLog", () => {
  test("includes author and channel ids", () => {
    const line = formatDiscordInboundMessageLog({
      author: { id: "user_secret_9" },
      channelId: "channel_secret_9",
      content: "hello",
      id: "msg_1",
    });
    expect(line).toContain("messageId=msg_1");
    expect(line).toContain("authorId=user_secret_9");
    expect(line).toContain("channelId=channel_secret_9");
    expect(line).toContain("textBytes=5");
  });
});
