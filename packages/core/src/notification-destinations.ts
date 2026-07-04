import type {
  CreateNotificationDestinationRequest,
  NotificationWebhookLevel,
  NotificationWebhookRequest,
  TelegramNotificationDestinationConfig,
  UpdateNotificationDestinationRequest,
} from "./contract";

function isNonZeroInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value !== 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeTelegramConfig(
  value: unknown,
  fieldName: string,
): TelegramNotificationDestinationConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const chatId = record.chatId;

  if (!isNonZeroInteger(chatId)) {
    throw new Error(`${fieldName}.chatId must be a non-zero integer.`);
  }

  const topicId = record.topicId;
  if (topicId === undefined || topicId === null) {
    return { chatId, topicId: null };
  }

  if (!isPositiveInteger(topicId)) {
    throw new Error(`${fieldName}.topicId must be a positive integer when provided.`);
  }

  return { chatId, topicId };
}

export function normalizeNotificationWebhookLevel(
  value: unknown,
): NotificationWebhookLevel | undefined {
  if (value === undefined || value === null) {
    return undefined;
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
  value: unknown,
): NotificationWebhookRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("notification payload must be an object.");
  }

  const record = value as Record<string, unknown>;
  const body = record.body;

  if (typeof body !== "string" || !body.trim()) {
    throw new Error("body must be a non-empty string.");
  }

  const title = record.title;
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    throw new Error("title must be a non-empty string when provided.");
  }

  return {
    body: body.trim(),
    ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    ...(record.level !== undefined
      ? { level: normalizeNotificationWebhookLevel(record.level) }
      : {}),
  };
}

export function normalizeCreateNotificationDestinationRequest(
  value: unknown,
): CreateNotificationDestinationRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("destination request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const name = record.name;

  if (typeof name !== "string" || !name.trim()) {
    throw new Error("name must be a non-empty string.");
  }

  if (record.channel !== "telegram") {
    throw new Error('channel must be "telegram".');
  }

  return {
    name: name.trim(),
    channel: "telegram",
    telegram: normalizeTelegramConfig(record.telegram, "telegram"),
  };
}

export function normalizeUpdateNotificationDestinationRequest(
  value: unknown,
): UpdateNotificationDestinationRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("destination request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const name = record.name;

  if (typeof name !== "string" || !name.trim()) {
    throw new Error("name must be a non-empty string.");
  }

  return {
    name: name.trim(),
    telegram: normalizeTelegramConfig(record.telegram, "telegram"),
  };
}
