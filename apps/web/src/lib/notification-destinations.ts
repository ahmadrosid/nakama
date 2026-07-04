import type { TelegramNotificationDestinationConfig } from "@tinyclaw/core/contract";

export function buildNotificationWebhookUrl(
  origin: string,
  webhookPath: string,
): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${webhookPath}`;
}

export function formatTelegramDestinationLabel(
  telegram: TelegramNotificationDestinationConfig,
): string {
  if (telegram.topicId) {
    return `Chat ${telegram.chatId} / Topic ${telegram.topicId}`;
  }

  return `Chat ${telegram.chatId}`;
}

export function parseTelegramTopicLink(input: string): {
  chatId: number;
  topicId: number;
} | null {
  const value = input.trim();
  const match = value.match(
    /^https?:\/\/t\.me\/c\/(\d+)\/(\d+)\/?$/i,
  );

  if (!match) {
    return null;
  }

  const [, rawChatId, rawTopicId] = match;
  const chatId = Number(`-100${rawChatId}`);
  const topicId = Number(rawTopicId);

  if (!Number.isInteger(chatId) || chatId === 0) {
    return null;
  }

  if (!Number.isInteger(topicId) || topicId <= 0) {
    return null;
  }

  return { chatId, topicId };
}
