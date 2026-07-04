import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { saveTelegramConfig } from "../telegram-config";
import { createTelegramOutboundAdapter } from "./telegram-outbound";

describe("createTelegramOutboundAdapter", () => {
  let tempHome = "";
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">> | null = null;

  afterEach(async () => {
    homedirSpy?.mockRestore();
    homedirSpy = null;

    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = "";
    }
  });

  async function useTempHome(run: () => Promise<void>): Promise<void> {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-tg-outbound-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    await saveTelegramConfig({ botToken: "1234567890:TEST" });
    await run();
  }

  test("sends to a plain chat", async () => {
    await useTempHome(async () => {
      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      const adapter = createTelegramOutboundAdapter({
        fetchImpl: async (input, init) => {
          calls.push({
            url: String(input),
            body: JSON.parse(String(init?.body)),
          });
          return new Response("ok", { status: 200 });
        },
      });

      await expect(adapter.send({ text: "hello", chatIds: [1001] })).resolves.toEqual({
        ok: true,
      });
      expect(calls[0]?.body).toEqual({ chat_id: 1001, text: "hello" });
    });
  });

  test("sends to a topic when topicId is provided", async () => {
    await useTempHome(async () => {
      const calls: Array<Record<string, unknown>> = [];
      const adapter = createTelegramOutboundAdapter({
        fetchImpl: async (_input, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return new Response("ok", { status: 200 });
        },
      });

      await expect(
        adapter.send({ text: "hello", chatIds: [1001], topicId: 22 }),
      ).resolves.toEqual({ ok: true });
      expect(calls[0]).toEqual({
        chat_id: 1001,
        text: "hello",
        message_thread_id: 22,
      });
    });
  });

  test("renders markdown as Telegram HTML when parse mode is requested", async () => {
    await useTempHome(async () => {
      const calls: Array<Record<string, unknown>> = [];
      const adapter = createTelegramOutboundAdapter({
        fetchImpl: async (_input, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return new Response("ok", { status: 200 });
        },
      });

      await expect(
        adapter.send({
          text: "✅ **New payment**\n\nCustomer: [Ahmad](https://example.com)",
          chatIds: [1001],
          parseMode: "HTML",
        }),
      ).resolves.toEqual({ ok: true });

      expect(calls[0]).toEqual({
        chat_id: 1001,
        text: '✅ <b>New payment</b>\n\nCustomer: <a href="https://example.com">Ahmad</a>',
        parse_mode: "HTML",
      });
    });
  });
});
