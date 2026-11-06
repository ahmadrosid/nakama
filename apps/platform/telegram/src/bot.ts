import { inspect } from "node:util";
import { run } from "@grammyjs/runner";
import { Bot, type BotError } from "grammy";
import { type ChatHandlerDeps, createChatHandler } from "./chat-handler";
import type { TelegramBridgeConfig } from "./config";
import type { TelegramBotInfo } from "./group-message";

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

export function runTelegramBot(bot: Bot) {
  const pending = new Set<Promise<void>>();
  let webhookReady = false;

  const runner = run(
    {
      api: {
        async getUpdates(...args: Parameters<Bot["api"]["getUpdates"]>) {
          try {
            if (!webhookReady) {
              await bot.api.deleteWebhook({}, args[1]);
              webhookReady = true;
            }

            return await bot.api.getUpdates(...args);
          } catch (error) {
            if (!args[1]?.aborted) {
              console.error(
                "Telegram polling error:",
                redactBotToken(inspect(error), bot.token)
              );
            }

            throw error;
          }
        },
      },
      errorHandler: (error: BotError) => bot.errorHandler(error),
      handleUpdate(update: Parameters<Bot["handleUpdate"]>[0]) {
        const task = bot.handleUpdate(update).catch(async (error) => {
          await bot.errorHandler(error);
        });

        pending.add(task);
        void task.then(
          () => pending.delete(task),
          () => pending.delete(task)
        );

        return task;
      },
      init: () => bot.init(),
    },
    {
      runner: { silent: true },
      sink: { concurrency: 20 },
    }
  );

  const task = runner.task();

  if (!task) {
    throw new Error("Telegram polling did not start");
  }

  const running = task.catch((error) => {
    throw new Error(redactBotToken(inspect(error), bot.token));
  });

  return {
    running,
    async stop() {
      try {
        await runner.stop();
      } finally {
        // runner.stop() stops polling, but 2.0.3 does not wait for middleware.
        await Promise.allSettled(pending);
      }
    },
  };
}
