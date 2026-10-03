import { NakamaApiError } from "./api-error";
import type {
  CreateNotificationDestinationRequest,
  NotificationDestinationChannel,
  NotificationWebhookLevel,
  NotificationWebhookRequest,
  TelegramNotificationDestinationConfig,
} from "./contract";

function isNonZeroInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value !== 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeTelegramConfig(
  value: unknown,
  fieldName: string
): TelegramNotificationDestinationConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const profileId =
    typeof record.profileId === "string" ? record.profileId.trim() : undefined;
  const chatId = record.chatId;

  if (!isNonZeroInteger(chatId)) {
    throw new Error(`${fieldName}.chatId must be a non-zero integer.`);
  }
  if (!profileId) {
    throw new Error(`${fieldName}.profileId is required.`);
  }

  const topicId = record.topicId;
  if (topicId === undefined || topicId === null) {
    return { chatId, profileId, topicId: null };
  }

  if (!isPositiveInteger(topicId)) {
    throw new Error(
      `${fieldName}.topicId must be a positive integer when provided.`
    );
  }

  return { chatId, profileId, topicId };
}

export function normalizeNotificationWebhookLevel(
  value: unknown
): NotificationWebhookLevel | undefined {
  if (value === undefined || value === null) {
    return;
  }

  if (
    value !== "info" &&
    value !== "success" &&
    value !== "warning" &&
    value !== "error"
  ) {
    throw new Error('level must be "info", "success", "warning", or "error".');
  }

  return value;
}

export function normalizeNotificationWebhookRequest(
  value: unknown
): NotificationWebhookRequest {
  if (typeof value !== "object" || value === null) {
    throw new NakamaApiError("notification payload must be an object.", 400);
  }

  const record = value as Record<string, unknown>;
  const body = record.body;

  if (typeof body !== "string" || !body.trim()) {
    throw new NakamaApiError("body must be a non-empty string.", 400);
  }

  const title = record.title;
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    throw new NakamaApiError(
      "title must be a non-empty string when provided.",
      400
    );
  }

  return {
    body: body.trim(),
    ...(typeof title === "string" && title.trim()
      ? { title: title.trim() }
      : {}),
    ...(record.level === undefined
      ? {}
      : { level: normalizeNotificationWebhookLevel(record.level) }),
  };
}

export function normalizeCreateNotificationDestinationRequest(
  value: unknown
): CreateNotificationDestinationRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("destination request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const name = record.name;

  if (typeof name !== "string" || !name.trim()) {
    throw new Error("name must be a non-empty string.");
  }

  const channel = record.channel;
  if (
    channel !== "telegram" &&
    channel !== "discord" &&
    channel !== "whatsapp"
  ) {
    throw new Error("Unsupported notification channel.");
  }

  for (const key of ["telegram", "discord", "whatsapp"]) {
    if (key !== channel && record[key] !== undefined) {
      throw new Error("Destination config must match its channel.");
    }
  }
  if (channel === "telegram") {
    return {
      channel,
      name: name.trim(),
      telegram: normalizeTelegramConfig(record.telegram, channel),
    };
  }
  const config = record[channel];
  if (typeof config !== "object" || config === null) {
    throw new Error(`${channel} must be an object.`);
  }
  const fields = config as Record<string, unknown>;
  const profileId =
    typeof fields.profileId === "string" ? fields.profileId.trim() : "";
  if (!profileId) {
    throw new Error(`${channel}.profileId is required.`);
  }
  if (channel === "whatsapp") {
    return { channel, name: name.trim(), whatsapp: { profileId } };
  }
  const channelId =
    typeof fields.channelId === "string" ? fields.channelId.trim() : "";
  if (!/^\d{17,20}$/.test(channelId)) {
    throw new Error("discord.channelId must be a 17–20 digit string.");
  }
  return { channel, discord: { channelId, profileId }, name: name.trim() };
}

export function normalizeUpdateNotificationDestinationRequest(
  value: unknown,
  channel: NotificationDestinationChannel = "telegram"
): CreateNotificationDestinationRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("destination request must be an object.");
  }

  const record = value as Record<string, unknown>;
  if (record.channel !== undefined && record.channel !== channel) {
    throw new Error("A destination's channel cannot be changed.");
  }
  return normalizeCreateNotificationDestinationRequest({ ...record, channel });
}
