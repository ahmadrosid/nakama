import { describe, expect, test } from "bun:test";
import { replyAsChat } from "./reply";
import type { TelegramRichMessenger } from "./rich-message";

function createMessenger(): TelegramRichMessenger & {
  rich: string[];
  plain: string[];
} {
  const rich: string[] = [];
  const plain: string[] = [];

  return {
    rich,
    plain,
    async send(text: string) {
      rich.push(text);
      return { message_id: rich.length };
    },
    async sendPlain(text: string) {
      plain.push(text);
      return { message_id: plain.length };
    },
    async sendRaw(text: string) {
      plain.push(text);
      return { message_id: plain.length };
    },
    async edit() {},
  };
}

describe("replyAsChat", () => {
  test("sends replies as rich text", async () => {
    const messenger = createMessenger();

    await replyAsChat(messenger, "Hello **world**", { delayMs: 0 });

    expect(messenger.rich).toEqual(["Hello **world**"]);
    expect(messenger.plain).toEqual([]);
  });

  test("does not split normal multi-paragraph rich replies", async () => {
    const messenger = createMessenger();
    const text = "First paragraph.\n\nSecond paragraph.".repeat(30);

    await replyAsChat(messenger, text, { delayMs: 0 });

    expect(messenger.rich).toEqual([text]);
    expect(messenger.plain).toEqual([]);
  });

  test("splits only when a reply exceeds Telegram's message limit", async () => {
    const messenger = createMessenger();

    await replyAsChat(messenger, "x".repeat(5000), { delayMs: 0 });

    expect(messenger.rich).toHaveLength(2);
    expect(messenger.plain).toEqual([]);
  });
});
