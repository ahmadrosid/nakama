import { describe, expect, test } from "bun:test";
import { createTelegramRichMessenger } from "./rich-message";
import { createMessageContext } from "./test-helpers";

describe("createTelegramRichMessenger", () => {
  test("sends formatted text with Telegram HTML parse mode", async () => {
    const { ctx, replies, replyOptions } = createMessageContext({
      userId: 42,
      text: "hello",
    });
    const messenger = createTelegramRichMessenger(ctx);

    await messenger.send("Hello **world** and `code`");

    expect(replies).toEqual(["Hello <b>world</b> and <code>code</code>"]);
    expect(replyOptions).toEqual([{ parse_mode: "HTML" }]);
  });

  test("edits formatted text with Telegram HTML parse mode", async () => {
    const { ctx, edits, editOptions } = createMessageContext({
      userId: 42,
      chatId: 99,
      text: "hello",
    });
    const messenger = createTelegramRichMessenger(ctx);

    await messenger.edit(7, "Done **now**");

    expect(edits).toEqual([{ chatId: 99, messageId: 7, text: "Done <b>now</b>" }]);
    expect(editOptions).toEqual([{ parse_mode: "HTML" }]);
  });
});
