import { z } from "zod";
import { NakamaApiError } from "./api-error";
import type {
  CreateNotificationDestinationRequest,
  NotificationDestinationChannel,
  NotificationWebhookLevel,
  NotificationWebhookRequest,
  TelegramNotificationDestinationConfig,
} from "./contract";

const JsonValueSchema = z.json();

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

const NonZeroIntegerSchema = z
  .number()
  .int()
  .refine((value) => value !== 0);

const PositiveIntegerSchema = z.number().int().positive();

const NotificationChannelSchema = z.enum(["telegram", "discord", "whatsapp"]);

const WebhookLevelSchema = z.enum(["info", "success", "warning", "error"]);

type JsonObject = z.infer<typeof JsonObjectSchema>;

function readObject<Value>(value: Value): JsonObject | null {
  const parsed = JsonObjectSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function readTrimmedString(
  value: JsonObject[string] | undefined
): string | null {
  const parsed = z.string().safeParse(value);

  return parsed.success && parsed.data.trim() ? parsed.data.trim() : null;
}

function normalizeTelegramConfig<Value>(
  value: Value,
  fieldName: string
): TelegramNotificationDestinationConfig {
  const record = readObject(value);

  if (!record) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const profileId = readTrimmedString(record.profileId);
  const chatId = NonZeroIntegerSchema.safeParse(record.chatId);

  if (!chatId.success) {
    throw new Error(`${fieldName}.chatId must be a non-zero integer.`);
  }

  if (!profileId) {
    throw new Error(`${fieldName}.profileId is required.`);
  }

  const topicId = record.topicId;

  if (topicId === undefined || topicId === null) {
    return { chatId: chatId.data, profileId, topicId: null };
  }

  const parsedTopicId = PositiveIntegerSchema.safeParse(topicId);

  if (!parsedTopicId.success) {
    throw new Error(
      `${fieldName}.topicId must be a positive integer when provided.`
    );
  }

  return { chatId: chatId.data, profileId, topicId: parsedTopicId.data };
}

export function normalizeNotificationWebhookLevel<Value>(
  value: Value
): NotificationWebhookLevel | undefined {
  if (value === undefined || value === null) {
    return;
  }

  const level = WebhookLevelSchema.safeParse(value);

  if (!level.success) {
    throw new Error('level must be "info", "success", "warning", or "error".');
  }

  return level.data;
}

export function normalizeNotificationWebhookRequest<Value>(
  value: Value
): NotificationWebhookRequest {
  const record = readObject(value);

  if (!record) {
    throw new NakamaApiError("notification payload must be an object.", 400);
  }

  const body = readTrimmedString(record.body);

  if (!body) {
    throw new NakamaApiError("body must be a non-empty string.", 400);
  }

  const title = record.title;

  if (title !== undefined && !readTrimmedString(title)) {
    throw new NakamaApiError(
      "title must be a non-empty string when provided.",
      400
    );
  }

  const request: NotificationWebhookRequest = { body };

  if (title !== undefined) {
    request.title = readTrimmedString(title) ?? undefined;
  }

  if (record.level !== undefined) {
    request.level = normalizeNotificationWebhookLevel(record.level);
  }

  return request;
}

export function normalizeCreateNotificationDestinationRequest<Value>(
  value: Value
): CreateNotificationDestinationRequest {
  const record = readObject(value);

  if (!record) {
    throw new Error("destination request must be an object.");
  }

  const name = record.name;
  const normalizedName = readTrimmedString(name);

  if (!normalizedName) {
    throw new Error("name must be a non-empty string.");
  }

  const channel = NotificationChannelSchema.safeParse(record.channel);

  if (!channel.success) {
    throw new Error("Unsupported notification channel.");
  }

  const channelName = channel.data;

  for (const key of ["telegram", "discord", "whatsapp"]) {
    if (key !== channelName && record[key] !== undefined) {
      throw new Error("Destination config must match its channel.");
    }
  }

  if (channelName === "telegram") {
    return {
      channel: channelName,
      name: normalizedName,
      telegram: normalizeTelegramConfig(record.telegram, channelName),
    };
  }

  const config = readObject(record[channelName]);

  if (!config) {
    throw new Error(`${channelName} must be an object.`);
  }

  const profileId = readTrimmedString(config.profileId) ?? "";

  if (!profileId) {
    throw new Error(`${channelName}.profileId is required.`);
  }

  if (channelName === "whatsapp") {
    return {
      channel: channelName,
      name: normalizedName,
      whatsapp: { profileId },
    };
  }

  const channelId = readTrimmedString(config.channelId) ?? "";

  if (!/^\d{17,20}$/.test(channelId)) {
    throw new Error("discord.channelId must be a 17–20 digit string.");
  }

  return {
    channel: channelName,
    discord: { channelId, profileId },
    name: normalizedName,
  };
}

export function normalizeUpdateNotificationDestinationRequest<Value>(
  value: Value,
  channel: NotificationDestinationChannel = "telegram"
): CreateNotificationDestinationRequest {
  const record = readObject(value);

  if (!record) {
    throw new Error("destination request must be an object.");
  }

  if (record.channel !== undefined && record.channel !== channel) {
    throw new Error("A destination's channel cannot be changed.");
  }

  return normalizeCreateNotificationDestinationRequest({ ...record, channel });
}
