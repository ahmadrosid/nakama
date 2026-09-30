import {
  createTelegramOutboundAdapter,
  NakamaApiError,
  type NotificationWebhookRequest,
  normalizeNotificationWebhookRequest,
  type TelegramOutboundAdapter,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AuthService } from "./auth-service";

/** Max length for the required Idempotency-Key header value. */
const NOTIFICATION_WEBHOOK_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

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

function formatNotificationMessage(
  payload: NotificationWebhookRequest
): string {
  const prefix = levelPrefix(payload.level);

  if (payload.title) {
    return `${prefix} **${payload.title}**\n\n${payload.body}`;
  }

  return `${prefix} ${payload.body}`;
}

function normalizeIdempotencyKey(value: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new NakamaApiError(
      "Idempotency-Key header is required for notification webhooks.",
      400
    );
  }
  if (trimmed.length > NOTIFICATION_WEBHOOK_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new NakamaApiError(
      `Idempotency-Key must be at most ${NOTIFICATION_WEBHOOK_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      400
    );
  }
  return trimmed;
}

export class NotificationWebhookService {
  private readonly telegram: TelegramOutboundAdapter;

  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService,
    telegram?: TelegramOutboundAdapter
  ) {
    this.telegram = telegram ?? createTelegramOutboundAdapter();
  }

  async deliver(
    destinationId: string,
    apiKey: string | null,
    payload: unknown,
    /**
     * Required Idempotency-Key header value. Claimed in SQLite before any
     * Telegram send so replays and concurrent duplicates never double-deliver.
     * The claim is kept even when Telegram fails — a lost success response must
     * not unlock a second send.
     */
    idempotencyKey: string | null
  ): Promise<void> {
    const destination =
      await this.databaseAdapter.getNotificationDestination(destinationId);
    if (
      !(destination && apiKey) ||
      this.authService.hashToken(apiKey) !== destination.secretHash
    ) {
      throw new NakamaApiError("Invalid notification credentials.", 401);
    }

    const organization = await this.databaseAdapter.getOrganizationById(
      destination.orgId
    );
    if (!organization || organization.archivedAt) {
      throw new NakamaApiError("Not found", 404);
    }

    const eventId = normalizeIdempotencyKey(idempotencyKey);
    const normalized = normalizeNotificationWebhookRequest(payload);
    if (
      !(
        destination.config.profileId &&
        (await this.databaseAdapter.listProfilesForOrg(destination.orgId)).some(
          (profile) => profile.id === destination.config.profileId
        )
      )
    ) {
      throw new NakamaApiError(
        "Choose an agent connection for this notification destination.",
        409
      );
    }

    const claimed = await this.databaseAdapter.claimNotificationWebhookDelivery(
      destinationId,
      eventId,
      new Date().toISOString()
    );
    if (!claimed) {
      throw new NakamaApiError("Duplicate notification delivery.", 409);
    }

    const result = await this.telegram.send({
      chatIds: [destination.config.chatId],
      orgId: destination.orgId,
      parseMode: "HTML",
      profileId: destination.config.profileId,
      text: formatNotificationMessage(normalized),
      ...(destination.config.topicId
        ? { topicId: destination.config.topicId }
        : {}),
    });

    if (!result.ok) {
      throw new NakamaApiError(
        result.error ?? "Notification delivery failed.",
        502
      );
    }
  }
}
