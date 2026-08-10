import {
  createId,
  type ListNotificationDestinationsResponse,
  NakamaApiError,
  type NotificationDestinationSummary,
  type NotificationDestinationWithSecret,
  nanoid,
  normalizeCreateNotificationDestinationRequest,
  normalizeUpdateNotificationDestinationRequest,
  type RegenerateNotificationDestinationKeyResponse,
} from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredNotificationDestinationRecord,
} from "@nakama/db";
import type { AuthService } from "./auth-service";

export function notificationDestinationWebhookPath(
  destinationId: string
): string {
  return `/v1/notify/${encodeURIComponent(destinationId)}`;
}

function toSummary(
  record: StoredNotificationDestinationRecord
): NotificationDestinationSummary {
  return {
    channel: record.channel,
    createdAt: record.createdAt,
    id: record.id,
    name: record.name,
    telegram: {
      chatId: record.config.chatId,
      topicId: record.config.topicId ?? null,
    },
    updatedAt: record.updatedAt,
    webhookPath: notificationDestinationWebhookPath(record.id),
  };
}

export class NotificationDestinationService {
  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService
  ) {}

  async list(orgId: string): Promise<ListNotificationDestinationsResponse> {
    const destinations =
      await this.databaseAdapter.listNotificationDestinationsForOrg(orgId);
    return { destinations: destinations.map(toSummary) };
  }

  async create(
    orgId: string,
    input: unknown
  ): Promise<NotificationDestinationWithSecret> {
    const request = normalizeCreateNotificationDestinationRequest(input);
    const apiKey = nanoid(32);
    const now = new Date().toISOString();
    const record: StoredNotificationDestinationRecord = {
      channel: request.channel,
      config: {
        chatId: request.telegram.chatId,
        topicId: request.telegram.topicId ?? null,
      },
      createdAt: now,
      id: createId("dest"),
      name: request.name,
      orgId,
      secretHash: this.authService.hashToken(apiKey),
      updatedAt: now,
    };

    await this.databaseAdapter.upsertNotificationDestination(record);

    return {
      apiKey,
      destination: toSummary(record),
    };
  }

  async update(
    orgId: string,
    destinationId: string,
    input: unknown
  ): Promise<NotificationDestinationSummary> {
    const existing = await this.getOwnedRecord(orgId, destinationId);
    const request = normalizeUpdateNotificationDestinationRequest(input);
    const updated: StoredNotificationDestinationRecord = {
      ...existing,
      config: {
        chatId: request.telegram.chatId,
        topicId: request.telegram.topicId ?? null,
      },
      name: request.name,
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertNotificationDestination(updated);
    return toSummary(updated);
  }

  async regenerateKey(
    orgId: string,
    destinationId: string
  ): Promise<RegenerateNotificationDestinationKeyResponse> {
    const existing = await this.getOwnedRecord(orgId, destinationId);
    const apiKey = nanoid(32);
    const updated: StoredNotificationDestinationRecord = {
      ...existing,
      secretHash: this.authService.hashToken(apiKey),
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertNotificationDestination(updated);

    return {
      apiKey,
      destination: toSummary(updated),
    };
  }

  async delete(orgId: string, destinationId: string): Promise<void> {
    await this.getOwnedRecord(orgId, destinationId);
    await this.databaseAdapter.deleteNotificationDestination(destinationId);
  }

  async getOwnedRecord(
    orgId: string,
    destinationId: string
  ): Promise<StoredNotificationDestinationRecord> {
    const record =
      await this.databaseAdapter.getNotificationDestination(destinationId);

    if (!record || record.orgId !== orgId) {
      throw new NakamaApiError("Notification destination not found", 404);
    }

    return record;
  }
}
