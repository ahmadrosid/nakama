import { describe, expect, test } from "bun:test";
import { formatDiscordInboundMessageLog } from "./bot";

describe("formatDiscordInboundMessageLog", () => {
  test("keeps identifiers and UTF-8 size without message content", () => {
    const privateMessage = "private 🔒 message";
    const output = formatDiscordInboundMessageLog({
      authorId: "author-123",
      channelId: "channel-456",
      messageId: "message-789",
      text: privateMessage,
    });

    expect(output).toContain("messageId=message-789");
    expect(output).toContain("authorId=author-123");
    expect(output).toContain("channelId=channel-456");
    expect(output).toContain("textBytes=20");
    expect(output).not.toContain(privateMessage);
  });
});
