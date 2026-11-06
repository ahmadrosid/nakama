import { inspect } from "node:util";
import { run } from "@grammyjs/runner";
import { Bot, BotError } from "grammy";
import { type ChatHandlerDeps, createChatHandler } from "./chat-handler";
import type { TelegramBridgeConfig } from "./config";
import type { TelegramBotInfo } from "./group-message";

const MAX_PENDING_TURNS = 20;

const MAX_TURNS_PER_CHAT = 2;

/** grammY network errors include the token in the failed request URL. */
export function redactBotToken(text: string, botToken: string): string {
  return botToken ? text.replaceAll(botToken, "<redacted>") : text;
}

export async function createBot(
  config: TelegramBridgeConfig,
  deps: Omit<ChatHandlerDeps, "config" | "getBotInfo" | "dispatchTurn"> & {
    getBotInfo?: () => TelegramBotInfo | undefined;
  },
  bot = new Bot(config.botToken)
) {
  await bot.init();

  const initializedBotInfo: TelegramBotInfo = {
    id: bot.botInfo.id,
    username: bot.botInfo.username,
  };

  const pendingTurns = new Set<Promise<void>>();
  const turnsPerChat = new Map<string, number>();
  let accepting = true;

  const handleMessage = createChatHandler({
    ...deps,
    config,
    dispatchTurn(key, work, ctx) {
      const count = turnsPerChat.get(key) ?? 0;

      if (
        !accepting ||
        pendingTurns.size >= MAX_PENDING_TURNS ||
        count >= MAX_TURNS_PER_CHAT
      ) {
        return false;
      }

      const task = work().catch(async (error) => {
        await bot.errorHandler(new BotError(error, ctx));
      });

      pendingTurns.add(task);
      turnsPerChat.set(key, count + 1);

      const finish = () => {
        pendingTurns.delete(task);
        const remaining = (turnsPerChat.get(key) ?? 1) - 1;

        if (remaining === 0) {
          turnsPerChat.delete(key);
        } else {
          turnsPerChat.set(key, remaining);
        }
      };

      void task.then(finish, finish);

      return true;
    },
    getBotInfo: () => deps.getBotInfo?.() ?? initializedBotInfo,
  });

  bot.on("message", handleMessage);
  bot.catch((error) => {
    console.error(
      "Telegram bot error:",
      redactBotToken(inspect(error), config.botToken)
    );
  });

  return {
    bot,
    start() {
      const pendingHandlers = new Set<Promise<void>>();
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

                return await bot.api.getUpdates(
                  {
                    ...args[0],
                    limit: Math.min(
                      args[0]?.limit ?? MAX_PENDING_TURNS,
                      MAX_PENDING_TURNS
                    ),
                  },
                  args[1]
                );
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

            pendingHandlers.add(task);
            void task.then(
              () => pendingHandlers.delete(task),
              () => pendingHandlers.delete(task)
            );

            return task;
          },
          init: () => bot.init(),
        },
        {
          runner: { silent: true },
          sink: { concurrency: MAX_PENDING_TURNS },
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
          accepting = false;

          try {
            await runner.stop();
          } finally {
            // The runner stops polling before its handlers finish.
            await Promise.allSettled(pendingHandlers);
            await Promise.allSettled(pendingTurns);
          }
        },
      };
    },
  };
}
