import { inspect } from "node:util";
import { run } from "@grammyjs/runner";
import { Bot } from "grammy";
import { type ChatHandlerDeps, createChatHandler } from "./chat-handler";
import type { TelegramBridgeConfig } from "./config";
import type { TelegramBotInfo } from "./group-message";

// Bound concurrent turns so long replies do not create an unbounded queue.
const MAX_CONCURRENT_UPDATES = 20;

/**
 * grammY's HttpError keeps the failed request on the error, and the Bot API
 * carries the token in the request path (`/bot<token>/getMe`), so logging the
 * error object writes the token into the log on every network failure.
 */
export function redactBotToken(text: string, botToken: string): string {
  return botToken ? text.replaceAll(botToken, "<redacted>") : text;
}

export async function createBot(
  config: TelegramBridgeConfig,
  deps: Omit<ChatHandlerDeps, "config" | "getBotInfo"> & {
    getBotInfo?: () => TelegramBotInfo | undefined;
  }
): Promise<Bot> {
  const bot = new Bot(config.botToken);
  await bot.init();

  const initializedBotInfo: TelegramBotInfo = {
    id: bot.botInfo.id,
    username: bot.botInfo.username,
  };

  const handleMessage = createChatHandler({
    ...deps,
    config,
    getBotInfo: () => deps.getBotInfo?.() ?? initializedBotInfo,
  });

  bot.on("message", handleMessage);

  bot.catch((error) => {
    console.error(
      "Telegram bot error:",
      redactBotToken(inspect(error), config.botToken)
    );
  });

  return bot;
}

export function runTelegramBot(bot: Bot): {
  running: Promise<void>;
  stop: () => Promise<void>;
} {
  const runner = run(bot, {
    sink: { concurrency: MAX_CONCURRENT_UPDATES },
  });
  const running = runner.task();

  if (!running) {
    throw new Error("Telegram polling runner did not start");
  }

  return {
    running,
    stop: () => runner.stop(),
  };
}
