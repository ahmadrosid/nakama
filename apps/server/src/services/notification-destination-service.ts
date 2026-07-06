import { createId, nanoid, NakamaApiError } from "@nakama/core";
import {
  normalizeCreateNotificationDestinationRequest,
  normalizeUpdateNotificationDestinationRequest,
  type CreateNotificationDestinationRequest,
  type ListNotificationDestinationsResponse,
  type NotificationDestinationSummary,
  type NotificationDestinationWithSecret,
  type RegenerateNotificationDestinationKeyResponse,
  type UpdateNotificationDestinationRequest,
} from "@nakama/core";
import type { DatabaseAdapter, StoredNotificationDestinationRecord } from "@nakama/db";
import type { AuthService } from "./auth-service";

export function notificationDestinationWebhookPath(destinationId: string): string {
  return `/v1/notify/${encodeURIComponent(destinationId)}`;
}

function toSummary(
  record: StoredNotificationDestinationRecord,
): NotificationDestinationSummary {
  return {
    id: record.id,
    name: record.name,
    channel: record.channel,
    telegram: {
      chatId: record.config.chatId,
      topicId: record.config.topicId ?? null,
    },
    webhookPath: notificationDestinationWebhookPath(record.id),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class NotificationDestinationService {
  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService,
  ) {}

  async list(orgId: string): Promise<ListNotificationDestinationsResponse> {
    const destinations = await this.databaseAdapter.listNotificationDestinationsForOrg(orgId);
    return { destinations: destinations.map(toSummary) };
  }

  async create(
    orgId: string,
    input: unknown,
  ): Promise<NotificationDestinationWithSecret> {
    const request = normalizeCreateNotificationDestinationRequest(input);
    const apiKey = nanoid(32);
    const now = new Date().toISOString();
    const record: StoredNotificationDestinationRecord = {
      id: createId("dest"),
      name: request.name,
      channel: request.channel,
      config: {
        chatId: request.telegram.chatId,
        topicId: request.telegram.topicId ?? null,
      },
      secretHash: this.authService.hashToken(apiKey),
      orgId,
      createdAt: now,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertNotificationDestination(record);

    return {
      destination: toSummary(record),
      apiKey,
    };
  }

  async update(
    orgId: string,
    destinationId: string,
    input: unknown,
  ): Promise<NotificationDestinationSummary> {
    const existing = await this.getOwnedRecord(orgId, destinationId);
    const request = normalizeUpdateNotificationDestinationRequest(input);
    const updated: StoredNotificationDestinationRecord = {
      ...existing,
      name: request.name,
      config: {
        chatId: request.telegram.chatId,
        topicId: request.telegram.topicId ?? null,
      },
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertNotificationDestination(updated);
    return toSummary(updated);
  }

  async regenerateKey(
    orgId: string,
    destinationId: string,
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
      destination: toSummary(updated),
      apiKey,
    };
  }

  async delete(orgId: string, destinationId: string): Promise<void> {
    await this.getOwnedRecord(orgId, destinationId);
    await this.databaseAdapter.deleteNotificationDestination(destinationId);
  }

  async getOwnedRecord(
    orgId: string,
    destinationId: string,
  ): Promise<StoredNotificationDestinationRecord> {
    const record = await this.databaseAdapter.getNotificationDestination(destinationId);

    if (!record || record.orgId !== orgId) {
      throw new NakamaApiError("Notification destination not found", 404);
    }

    return record;
  }
}
