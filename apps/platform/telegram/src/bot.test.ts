import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { Bot } from "grammy";
import { redactBotToken } from "./bot";

const TOKEN = "7654321098:AAF_fakeTokenValueDoNotUse_zzzz12345";

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
