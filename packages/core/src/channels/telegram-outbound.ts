import { loadTelegramConfigFile } from "../telegram-config";
import { splitTelegramChunks } from "./message-format";
import type { ChannelSendResult, TelegramOutboundAdapter } from "./types";

export interface TelegramOutboundOptions {
  fetchImpl?: typeof fetch;
}

export function createTelegramOutboundAdapter(
  options: TelegramOutboundOptions = {},
): TelegramOutboundAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(input): Promise<ChannelSendResult> {
      try {
        const config = await loadTelegramConfigFile();
        const token = config?.botToken.trim();

        if (!token) {
          return { ok: false, error: "Telegram bot token is not configured." };
        }

        const chatIds =
          input.chatIds && input.chatIds.length > 0
            ? input.chatIds
            : config?.pairedUserIds ?? [];

        if (chatIds.length === 0) {
          return { ok: false, error: "No Telegram chat is paired." };
        }

        const chunks = splitTelegramChunks(input.text);

        if (chunks.length === 0) {
          return { ok: false, error: "Message text is empty." };
        }

        for (const chatId of chatIds) {
          for (const chunk of chunks) {
            const response = await fetchImpl(
              `https://api.telegram.org/bot${token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: chunk,
                }),
              },
            );

            if (!response.ok) {
              const body = await response.text();
              return {
                ok: false,
                error: `Telegram API error (${response.status}): ${body.slice(0, 200)}`,
              };
            }
          }
        }

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    },
  };
}
