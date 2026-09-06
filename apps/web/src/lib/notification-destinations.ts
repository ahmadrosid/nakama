import type { TelegramNotificationDestinationConfig } from "@nakama/core/contract";

/** Clear newly minted webhook secrets from React state after this window. */
export const LATEST_WEBHOOK_SECRET_TTL_MS = 60_000;

export function maskWebhookApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "••••";
  }
  return `••••${trimmed.slice(-4)}`;
}

export function buildNotificationWebhookUrl(
  origin: string,
  webhookPath: string
): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${webhookPath}`;
}

export function formatTelegramDestinationLabel(
  telegram: TelegramNotificationDestinationConfig
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
  const match = value.match(/^https?:\/\/t\.me\/c\/(\d+)\/(\d+)\/?$/i);

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
