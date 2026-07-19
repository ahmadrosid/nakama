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

  test("falls back to plain text when rich send fails", async () => {
    const { ctx, replies, replyOptions } = createMessageContext({
      userId: 42,
      text: "hello",
      failRichReply: true,
    });
    const messenger = createTelegramRichMessenger(ctx);

    await messenger.send("Hello **world** and `code`");

    expect(replies).toEqual(["Hello world and code"]);
    expect(replyOptions).toEqual([undefined]);
  });

  test("falls back to plain text when rich edit fails", async () => {
    const { ctx, edits, editOptions } = createMessageContext({
      userId: 42,
      chatId: 99,
      text: "hello",
      failRichEdit: true,
    });
    const messenger = createTelegramRichMessenger(ctx);

    await messenger.edit(7, "Done **now**");

    expect(edits).toEqual([{ chatId: 99, messageId: 7, text: "Done now" }]);
    expect(editOptions).toEqual([undefined]);
  });

  test("sendRaw preserves share URLs without markdown stripping", async () => {
    const shareUrl =
      "http://127.0.0.1:4310/s/tc_share_a7e24436b9bd4ec8bd60edba6d403c74f0b19596f27b440db85d7f171299bbdc";
    const footer = `slides.html: ${shareUrl}`;
    const { ctx, replies, replyOptions } = createMessageContext({
      userId: 42,
      text: "hello",
    });
    const messenger = createTelegramRichMessenger(ctx);

    await messenger.sendRaw(footer);

    expect(replies).toEqual([footer]);
    expect(replyOptions).toEqual([undefined]);
  });
});
