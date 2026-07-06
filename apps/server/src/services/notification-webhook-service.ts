import { NakamaApiError } from "@nakama/core";
import {
  createTelegramOutboundAdapter,
  normalizeNotificationWebhookRequest,
  type NotificationWebhookRequest,
  type TelegramOutboundAdapter,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "./auth-service";

function levelPrefix(level: NotificationWebhookRequest["level"]): string {
  switch (level) {
    case "success":
      return "✅";
    case "warning":
      return "⚠️";
    case "error":
      return "❌";
    case "info":
      return "ℹ️";
    default:
      return "🔔";
  }
}

function formatNotificationMessage(payload: NotificationWebhookRequest): string {
  const prefix = levelPrefix(payload.level);

  if (payload.title) {
    return `${prefix} **${payload.title}**\n\n${payload.body}`;
  }

  return `${prefix} ${payload.body}`;
}

export class NotificationWebhookService {
  private readonly telegram: TelegramOutboundAdapter;

  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService,
    telegram?: TelegramOutboundAdapter,
  ) {
    this.telegram = telegram ?? createTelegramOutboundAdapter();
  }

  async deliver(destinationId: string, apiKey: string | null, payload: unknown): Promise<void> {
    const destination = await this.databaseAdapter.getNotificationDestination(destinationId);
    if (!destination || !apiKey || this.authService.hashToken(apiKey) !== destination.secretHash) {
      throw new NakamaApiError("Invalid notification credentials.", 401);
    }

    const normalized = normalizeNotificationWebhookRequest(payload);
    const result = await this.telegram.send({
      text: formatNotificationMessage(normalized),
      chatIds: [destination.config.chatId],
      parseMode: "HTML",
      ...(destination.config.topicId ? { topicId: destination.config.topicId } : {}),
    });

    if (!result.ok) {
      throw new NakamaApiError(result.error ?? "Notification delivery failed.", 502);
    }
  }
}
