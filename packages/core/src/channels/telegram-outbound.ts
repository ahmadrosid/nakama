import { loadTelegramConfigFile } from "../telegram-config";
import { splitTelegramChunks } from "./message-format";
import { renderTelegramRichText } from "./telegram-rich-text";
import type { ChannelSendResult, TelegramOutboundAdapter } from "./types";

export interface TelegramOutboundOptions {
  fetchImpl?: typeof fetch;
}

export function createTelegramOutboundAdapter(
  options: TelegramOutboundOptions = {}
): TelegramOutboundAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(input): Promise<ChannelSendResult> {
      try {
        const config = await loadTelegramConfigFile();
        const token = config?.botToken.trim();

        if (!token) {
          return { error: "Telegram bot token is not configured.", ok: false };
        }

        const chatIds =
          input.chatIds && input.chatIds.length > 0
            ? input.chatIds
            : (config?.pairedUserIds ?? []);

        if (chatIds.length === 0) {
          return { error: "No Telegram chat is paired.", ok: false };
        }

        const chunks = splitTelegramChunks(input.text);

        if (chunks.length === 0) {
          return { error: "Message text is empty.", ok: false };
        }

        for (const chatId of chatIds) {
          for (const chunk of chunks) {
            const text =
              input.parseMode === "HTML"
                ? renderTelegramRichText(chunk)
                : chunk;
            const response = await fetchImpl(
              `https://api.telegram.org/bot${token}/sendMessage`,
              {
                body: JSON.stringify({
                  chat_id: chatId,
                  text,
                  ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
                  ...(input.topicId
                    ? { message_thread_id: input.topicId }
                    : {}),
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              }
            );

            if (!response.ok) {
              const body = await response.text();
              return {
                error: `Telegram API error (${response.status}): ${body.slice(0, 200)}`,
                ok: false,
              };
            }
          }
        }

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, ok: false };
      }
    },
  };
}
