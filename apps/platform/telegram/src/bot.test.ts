import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { Bot } from "grammy";
import { redactBotToken, runTelegramBot } from "./bot";

const TOKEN = "7654321098:AAF_fakeTokenValueDoNotUse_zzzz12345";

const BOT_INFO = {
  can_connect_to_business: false,
  can_join_groups: true,
  can_read_all_group_messages: false,
  first_name: "test",
  has_main_web_app: false,
  id: 9,
  is_bot: true,
  supports_inline_queries: false,
  username: "test_bot",
};

describe("redactBotToken", () => {
  // The leak is not hypothetical: grammY keeps the failed request path on the
  // error, and the Bot API puts the token in that path. Use a real grammY error
  // rather than a hand-written one, or the test stops tracking the library.
  test("keeps the bot token out of a logged grammY network error", async () => {
    let captured: unknown;

    try {
      await new Bot(TOKEN, {
        client: { apiRoot: "http://127.0.0.1:9" },
      }).api.getMe();
    } catch (error) {
      captured = error;
    }

    const logged = inspect(captured);
    expect(logged).toContain(TOKEN);
    expect(redactBotToken(logged, TOKEN)).not.toContain(TOKEN);
    expect(redactBotToken(logged, TOKEN)).toContain("/bot<redacted>/getMe");
  });

  test("leaves the text alone when no token is configured", () => {
    expect(redactBotToken("Network request for 'getMe' failed!", "")).toBe(
      "Network request for 'getMe' failed!"
    );
  });
});

describe("runTelegramBot", () => {
  test("starts later updates while an earlier message is still running", async () => {
    const pending = <T>() => {
      let resolve!: (value: T | PromiseLike<T>) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });

      return { promise, resolve };
    };
    const longTurn = pending<void>();
    const laterUpdatesStarted = pending<void>();
    const seen: string[] = [];
    const updates = [
      [message(1, 1, "long job")],
      [message(2, 1, "/stop"), message(3, 2, "hello from chat 2")],
    ];
    const fetch = async (url: string | URL) => {
      const result = String(url).endsWith("/getUpdates")
        ? (updates.shift() ?? [])
        : true;

      if (Array.isArray(result) && result.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      return new Response(JSON.stringify({ ok: true, result }));
    };
    const bot = new Bot(TOKEN, {
      botInfo: BOT_INFO,
      client: { fetch },
    });

    bot.on("message", async (ctx) => {
      const text = ctx.message.text ?? "";
      seen.push(text);

      if (text === "long job") {
        await longTurn.promise;
      }

      if (seen.includes("/stop") && seen.includes("hello from chat 2")) {
        laterUpdatesStarted.resolve();
      }
    });

    const runner = runTelegramBot(bot);

    try {
      const timeout = new Promise<false>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1500);
        void laterUpdatesStarted.promise.then(() => clearTimeout(timer));
      });
      const started = await Promise.race([
        laterUpdatesStarted.promise.then(() => true),
        timeout,
      ]);

      expect(started).toBe(true);
      expect(seen).toEqual(["long job", "/stop", "hello from chat 2"]);
    } finally {
      longTurn.resolve();
      await runner.stop();
      await runner.running;
    }
  });
});

function message(updateId: number, chatId: number, text: string) {
  return {
    message: {
      chat: { id: chatId, type: "private" as const },
      date: 0,
      from: { first_name: "test", id: chatId, is_bot: false },
      message_id: updateId,
      text,
    },
    update_id: updateId,
  };
}
