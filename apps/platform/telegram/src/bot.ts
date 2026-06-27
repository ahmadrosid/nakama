import { Bot } from "grammy";
import type { TelegramBridgeConfig } from "./config";
import { createChatHandler, type ChatHandlerDeps } from "./chat-handler";
import type { TelegramBotInfo } from "./group-message";

export async function createBot(
  config: TelegramBridgeConfig,
  deps: Omit<ChatHandlerDeps, "config" | "getBotInfo"> & {
    getBotInfo?: () => TelegramBotInfo | undefined;
  },
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
    console.error("Telegram bot error:", error);
  });

  return bot;
}
