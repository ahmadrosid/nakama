import type {
  ComposioConnectRequest,
  ComposioConnectResponse,
  ComposioSettingsResponse,
  ComposioToolkitSummary,
  CreateNotificationDestinationRequest,
  DiscordSettingsResponse,
  ListComposioToolkitsResponse,
  ListNotificationDestinationsResponse,
  ListProfileComposioToolkitsResponse,
  NotificationDestinationSummary,
  NotificationDestinationWithSecret,
  RegenerateNotificationDestinationKeyResponse,
  SlackSettingsResponse,
  StartTelegramPairingRequest,
  TeamsSettingsResponse,
  TelegramAccessRequestsResponse,
  TelegramPairingStartResponse,
  TelegramPairingStatusResponse,
  TelegramSettingsResponse,
  UpdateComposioSettingsRequest,
  UpdateDiscordSettingsRequest,
  UpdateNotificationDestinationRequest,
  UpdateProfileComposioToolkitsRequest,
  UpdateSlackSettingsRequest,
  UpdateTeamsSettingsRequest,
  UpdateTelegramSettingsRequest,
  UpdateWhatsAppSettingsRequest,
  WhatsAppSettingsResponse,
} from "@nakama/core/contract";
import type {
  MeetAction,
  MeetActionInput,
  MeetActionResults,
} from "@nakama/core/google-meet";
import { readBrowserOrigin } from "./browser";
import { AutomationsClient } from "./client-automations";

/** Channels and connectors: Telegram, Discord, Slack, WhatsApp, Composio, notifications, Google Meet. */
export class ChannelsClient extends AutomationsClient {
  invokeGoogleMeet<Action extends MeetAction>(
    action: Action,
    input: MeetActionInput | undefined,
    orgId: string,
    signal?: AbortSignal
  ): Promise<MeetActionResults[Action]> {
    return this.request(`/v1/meet/actions/${encodeURIComponent(action)}`, {
      body: JSON.stringify(input ?? {}),
      headers: { "X-Org-Id": orgId },
      method: "POST",
      signal,
    });
  }

  async getTelegramSettings(
    profileId?: string
  ): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>(
      `/v1/settings/telegram?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async setTelegramSettings(
    request: UpdateTelegramSettingsRequest,
    profileId?: string
  ): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>(
      `/v1/settings/telegram?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async regenerateTelegramHandshake(
    profileId?: string
  ): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>(
      `/v1/settings/telegram/handshake?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async getTelegramAccessRequests(
    profileId?: string
  ): Promise<TelegramAccessRequestsResponse> {
    return this.request<TelegramAccessRequestsResponse>(
      `/v1/settings/telegram/requests?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async approveTelegramAccessRequest(
    userId: number,
    profileId?: string
  ): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>(
      `/v1/settings/telegram/requests/${userId}/approve?profileId=${encodeURIComponent(profileId ?? "")}`,
      { method: "POST" }
    );
  }

  async denyTelegramAccessRequest(
    userId: number,
    profileId?: string
  ): Promise<TelegramAccessRequestsResponse> {
    return this.request<TelegramAccessRequestsResponse>(
      `/v1/settings/telegram/requests/${userId}/deny?profileId=${encodeURIComponent(profileId ?? "")}`,
      { method: "POST" }
    );
  }

  async startTelegramPairing(
    request: StartTelegramPairingRequest,
    profileId?: string
  ): Promise<TelegramPairingStartResponse> {
    return this.request<TelegramPairingStartResponse>(
      `/v1/settings/telegram/pairing?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async getTelegramPairingStatus(
    pairingId: string,
    profileId?: string
  ): Promise<TelegramPairingStatusResponse> {
    return this.request<TelegramPairingStatusResponse>(
      `/v1/settings/telegram/pairing/${encodeURIComponent(pairingId)}?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async cancelTelegramPairing(
    pairingId: string,
    profileId?: string
  ): Promise<TelegramPairingStatusResponse> {
    return this.request<TelegramPairingStatusResponse>(
      `/v1/settings/telegram/pairing/${encodeURIComponent(pairingId)}/cancel?profileId=${encodeURIComponent(profileId ?? "")}`,
      { method: "POST" }
    );
  }

  async applyTelegramPairing(
    pairingId: string,
    profileId: string
  ): Promise<TelegramPairingStatusResponse> {
    return this.request<TelegramPairingStatusResponse>(
      `/v1/settings/telegram/pairing/${encodeURIComponent(pairingId)}/apply?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        body: JSON.stringify({ profileId }),
        method: "POST",
      }
    );
  }

  async getDiscordSettings(
    profileId?: string
  ): Promise<DiscordSettingsResponse> {
    return this.request<DiscordSettingsResponse>(
      `/v1/settings/discord?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async setDiscordSettings(
    request: UpdateDiscordSettingsRequest,
    profileId?: string
  ): Promise<DiscordSettingsResponse> {
    return this.request<DiscordSettingsResponse>(
      `/v1/settings/discord?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async regenerateDiscordHandshake(
    profileId?: string
  ): Promise<DiscordSettingsResponse> {
    return this.request<DiscordSettingsResponse>(
      `/v1/settings/discord/handshake?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async getSlackSettings(profileId?: string): Promise<SlackSettingsResponse> {
    return this.request<SlackSettingsResponse>(
      `/v1/settings/slack?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async setSlackSettings(
    request: UpdateSlackSettingsRequest,
    profileId?: string
  ): Promise<SlackSettingsResponse> {
    return this.request<SlackSettingsResponse>(
      `/v1/settings/slack?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async getTeamsSettings(profileId?: string): Promise<TeamsSettingsResponse> {
    return this.request<TeamsSettingsResponse>(
      `/v1/settings/teams?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async setTeamsSettings(
    request: UpdateTeamsSettingsRequest,
    profileId?: string
  ): Promise<TeamsSettingsResponse> {
    return this.request<TeamsSettingsResponse>(
      `/v1/settings/teams?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async regenerateSlackHandshake(
    profileId?: string
  ): Promise<SlackSettingsResponse> {
    return this.request<SlackSettingsResponse>(
      `/v1/settings/slack/handshake?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async getComposioSettings(): Promise<ComposioSettingsResponse> {
    return this.request<ComposioSettingsResponse>("/v1/settings/composio");
  }

  async setComposioSettings(
    request: UpdateComposioSettingsRequest
  ): Promise<ComposioSettingsResponse> {
    return this.request<ComposioSettingsResponse>("/v1/settings/composio", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async setComposioSecret(apiKey: string): Promise<ComposioSettingsResponse> {
    return this.request<ComposioSettingsResponse>(
      "/v1/settings/composio/secret",
      {
        body: JSON.stringify({ apiKey }),
        method: "PUT",
      }
    );
  }
  async listNotificationDestinations(): Promise<ListNotificationDestinationsResponse> {
    return this.request<ListNotificationDestinationsResponse>(
      "/v1/notification-destinations"
    );
  }

  async createNotificationDestination(
    request: CreateNotificationDestinationRequest
  ): Promise<NotificationDestinationWithSecret> {
    return this.request<NotificationDestinationWithSecret>(
      "/v1/notification-destinations",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async updateNotificationDestination(
    destinationId: string,
    request: UpdateNotificationDestinationRequest
  ): Promise<NotificationDestinationSummary> {
    return this.request<NotificationDestinationSummary>(
      `/v1/notification-destinations/${encodeURIComponent(destinationId)}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async regenerateNotificationDestinationKey(
    destinationId: string
  ): Promise<RegenerateNotificationDestinationKeyResponse> {
    return this.request<RegenerateNotificationDestinationKeyResponse>(
      `/v1/notification-destinations/${encodeURIComponent(destinationId)}/rotate-key`,
      {
        method: "POST",
      }
    );
  }

  async deleteNotificationDestination(destinationId: string): Promise<void> {
    await this.request(
      `/v1/notification-destinations/${encodeURIComponent(destinationId)}`,
      {
        method: "DELETE",
      }
    );
  }

  async listComposioToolkits(): Promise<ListComposioToolkitsResponse> {
    return this.request<ListComposioToolkitsResponse>("/v1/composio/toolkits");
  }

  async enableComposioToolkit(
    toolkitSlug: string
  ): Promise<ComposioToolkitSummary> {
    return this.request<ComposioToolkitSummary>(
      `/v1/composio/toolkits/${encodeURIComponent(toolkitSlug)}/enable`,
      { body: JSON.stringify({ toolkitSlug }), method: "POST" }
    );
  }

  async disableComposioToolkit(
    toolkitSlug: string
  ): Promise<ComposioToolkitSummary> {
    return this.request<ComposioToolkitSummary>(
      `/v1/composio/toolkits/${encodeURIComponent(toolkitSlug)}/disable`,
      { method: "POST" }
    );
  }

  async connectComposioToolkit(
    toolkitSlug: string
  ): Promise<ComposioConnectResponse> {
    const body: ComposioConnectRequest = {};

    const callbackOrigin = readBrowserOrigin();

    if (callbackOrigin) {
      body.callbackOrigin = callbackOrigin;
    }

    return this.request<ComposioConnectResponse>(
      `/v1/composio/toolkits/${encodeURIComponent(toolkitSlug)}/connect`,
      {
        body: JSON.stringify(body),
        method: "POST",
      }
    );
  }

  async connectMeetRecordingSource(
    toolkitSlug: string
  ): Promise<ComposioConnectResponse> {
    const body: ComposioConnectRequest = {};

    const callbackOrigin = readBrowserOrigin();

    if (callbackOrigin) {
      body.callbackOrigin = callbackOrigin;
    }

    return this.request<ComposioConnectResponse>(
      `/v1/composio/meet/${encodeURIComponent(toolkitSlug)}/connect`,
      {
        body: JSON.stringify(body),
        method: "POST",
      }
    );
  }

  async disconnectComposioToolkit(
    toolkitSlug: string
  ): Promise<ComposioToolkitSummary> {
    return this.request<ComposioToolkitSummary>(
      `/v1/composio/toolkits/${encodeURIComponent(toolkitSlug)}/disconnect`,
      { method: "POST" }
    );
  }

  async syncComposioToolkit(
    toolkitSlug: string
  ): Promise<ComposioToolkitSummary> {
    return this.request<ComposioToolkitSummary>(
      `/v1/composio/toolkits/${encodeURIComponent(toolkitSlug)}/sync`,
      { method: "POST" }
    );
  }

  async listProfileComposioToolkits(
    profileId: string
  ): Promise<ListProfileComposioToolkitsResponse> {
    return this.request<ListProfileComposioToolkitsResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/composio-toolkits`
    );
  }

  async updateProfileComposioToolkits(
    profileId: string,
    request: UpdateProfileComposioToolkitsRequest
  ): Promise<ListProfileComposioToolkitsResponse> {
    return this.request<ListProfileComposioToolkitsResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/composio-toolkits`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async getWhatsAppSettings(
    profileId?: string
  ): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>(
      `/v1/settings/whatsapp?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async setWhatsAppSettings(
    request: UpdateWhatsAppSettingsRequest,
    profileId?: string
  ): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>(
      `/v1/settings/whatsapp?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async regenerateWhatsAppPairingCode(
    profileId?: string
  ): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>(
      `/v1/settings/whatsapp/pairing-code?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async reconnectWhatsApp(
    profileId?: string
  ): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>(
      `/v1/settings/whatsapp/reconnect?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }
}
