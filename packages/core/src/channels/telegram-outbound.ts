import { loadTelegramConfigFile } from "../telegram-config";
import { splitTelegramChunks } from "./message-format";
import {
  renderTelegramPlainText,
  renderTelegramRichText,
  splitTelegramRichChunks,
} from "./telegram-rich-text";
import type { ChannelSendResult, TelegramOutboundAdapter } from "./types";

interface TelegramMessagePayload {
  chat_id: number | string;
  message_thread_id?: number;
  parse_mode?: "HTML";
  text: string;
}

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
        if (!(input.orgId && input.profileId)) {
          return {
            error: "Choose an agent connection before sending.",
            ok: false,
          };
        }

        const owner = { orgId: input.orgId, profileId: input.profileId };
        const config = await loadTelegramConfigFile(owner);
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

        const chunks =
          input.parseMode === "HTML"
            ? splitTelegramRichChunks(input.text)
            : splitTelegramChunks(input.text);

        if (chunks.length === 0) {
          return { error: "Message text is empty.", ok: false };
        }

        const url = `https://api.telegram.org/bot${token}/sendMessage`;

        const post = (payload: TelegramMessagePayload) =>
          fetchImpl(url, {
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });

        for (const chatId of chatIds) {
          for (const chunk of chunks) {
            const html = input.parseMode === "HTML";

            const payload: TelegramMessagePayload = {
              chat_id: chatId,
              text: html ? renderTelegramRichText(chunk) : chunk,
            };

            if (input.parseMode) {
              payload.parse_mode = input.parseMode;
            }

            if (input.topicId) {
              payload.message_thread_id = input.topicId;
            }

            let response = await post(payload);

            // Telegram rejects unsupported HTML with 400: resend this chunk as
            // plain text so the delivery still reaches the chat.
            if (html && response.status === 400) {
              const plainPayload: TelegramMessagePayload = {
                chat_id: chatId,
                text: renderTelegramPlainText(chunk),
              };

              if (input.topicId) {
                plainPayload.message_thread_id = input.topicId;
              }

              response = await post(plainPayload);
            }

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
