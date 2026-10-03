import {
  type CreateNotificationDestinationRequest,
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
  const common = {
    createdAt: record.createdAt,
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    webhookPath: notificationDestinationWebhookPath(record.id),
  };
  if (record.channel === "telegram") {
    return {
      ...common,
      channel: record.channel,
      telegram: { ...record.config, topicId: record.config.topicId ?? null },
    };
  }
  if (record.channel === "discord") {
    return { ...common, channel: record.channel, discord: record.config };
  }
  return { ...common, channel: record.channel, whatsapp: record.config };
}

function destinationConfig(request: CreateNotificationDestinationRequest) {
  if (request.channel === "telegram") {
    return { channel: request.channel, config: request.telegram };
  }
  if (request.channel === "discord") {
    return { channel: request.channel, config: request.discord };
  }
  return { channel: request.channel, config: request.whatsapp };
}

export class NotificationDestinationService {
  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService
  ) {}

  private async requireChannelProfile(orgId: string, profileId?: string) {
    const profiles = await this.databaseAdapter.listProfilesForOrg(orgId);
    if (!(profileId && profiles.some((profile) => profile.id === profileId))) {
      throw new NakamaApiError("Choose an agent in this organization.", 400);
    }
  }

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
    const configured = destinationConfig(request);
    await this.requireChannelProfile(orgId, configured.config.profileId);
    const apiKey = nanoid(32);
    const now = new Date().toISOString();
    const record: StoredNotificationDestinationRecord = {
      ...configured,
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
    const request = normalizeUpdateNotificationDestinationRequest(
      input,
      existing.channel
    );
    const configured = destinationConfig(request);
    await this.requireChannelProfile(orgId, configured.config.profileId);
    const updated: StoredNotificationDestinationRecord = {
      ...existing,
      ...configured,
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
