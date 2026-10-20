import type {
  AutomationWorkerSettingsResponse,
  ChatgptOAuthDeviceCompleteRequest,
  ChatgptOAuthDeviceCompleteResponse,
  ChatgptOAuthDeviceStartResponse,
  CodingHarnessSettingsResponse,
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CreateProviderRequest,
  CreateProviderResponse,
  DataImportPreviewResponse,
  DeleteProviderResponse,
  HealthResponse,
  ListProvidersResponse,
  ModelsResponse,
  PluginWorkerStatus,
  PreviewDataImportRequest,
  ProfilePackImportRequest,
  ProfilePackImportResponse,
  ProfilePackPreviewResponse,
  RestoreDataImportRequest,
  RestoreDataImportResponse,
  SetupRestoreDataImportResponse,
  SystemStatusResponse,
  UpdateAutomationWorkerSettingsRequest,
  UpdateProviderRequest,
  UpdateProviderResponse,
  UpdateWebPublicUrlRequest,
  WebPublicUrlSettingsResponse,
  WorkerLogsResponse,
  XaiOAuthDeviceCompleteRequest,
  XaiOAuthDeviceCompleteResponse,
  XaiOAuthDeviceStartResponse,
} from "@nakama/core/contract";
import { NakamaClientCore } from "./client-core";
import type { JsonValue } from "./client-helpers";
import {
  encodeArchiveData,
  readContentDispositionFilename,
} from "./client-helpers";

/** Server status, data import and export, workers, models, and providers. */
export class SystemClient extends NakamaClientCore {
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  async getSystemStatus(profileId?: string): Promise<SystemStatusResponse> {
    return this.request<SystemStatusResponse>(
      `/v1/system/status?profileId=${encodeURIComponent(profileId ?? "")}`
    );
  }

  async getAutomationWorkerSettings(): Promise<AutomationWorkerSettingsResponse> {
    return this.request<AutomationWorkerSettingsResponse>(
      "/v1/settings/automation-worker"
    );
  }

  async setAutomationWorkerSettings(
    pollIntervalMinutes: number
  ): Promise<AutomationWorkerSettingsResponse> {
    return this.request<AutomationWorkerSettingsResponse>(
      "/v1/settings/automation-worker",
      {
        body: JSON.stringify({
          pollIntervalMinutes,
        } satisfies UpdateAutomationWorkerSettingsRequest),
        method: "PUT",
      }
    );
  }

  async getCodingHarnessSettings(): Promise<CodingHarnessSettingsResponse> {
    return this.request<CodingHarnessSettingsResponse>(
      "/v1/settings/coding-harnesses"
    );
  }

  async setCodingHarnessSettings(
    providerPassthroughEnabled: boolean
  ): Promise<CodingHarnessSettingsResponse> {
    return this.request<CodingHarnessSettingsResponse>(
      "/v1/settings/coding-harnesses",
      {
        body: JSON.stringify({ providerPassthroughEnabled }),
        method: "PUT",
      }
    );
  }

  async getWebPublicUrl(): Promise<WebPublicUrlSettingsResponse> {
    return this.request<WebPublicUrlSettingsResponse>(
      "/v1/system/web-public-url"
    );
  }

  async updateWebPublicUrl(
    webPublicUrl: string
  ): Promise<{ webPublicUrl: string }> {
    return this.request<{ webPublicUrl: string }>("/v1/system/web-public-url", {
      body: JSON.stringify({
        webPublicUrl,
      } satisfies UpdateWebPublicUrlRequest),
      method: "PUT",
    });
  }

  async exportData(): Promise<{
    filename: string;
    data: ArrayBuffer;
  }> {
    const response = await this.fetchRaw("/v1/platform/data/export");

    return {
      data: await response.arrayBuffer(),
      filename:
        readContentDispositionFilename(response.headers) ?? "nakama-export.zip",
    };
  }

  async exportUserData(userId: string): Promise<{
    filename: string;
    data: ArrayBuffer;
  }> {
    const response = await this.fetchRaw(
      `/v1/platform/users/${encodeURIComponent(userId)}/data/export`
    );

    return {
      data: await response.arrayBuffer(),
      filename:
        readContentDispositionFilename(response.headers) ??
        "nakama-user-export.zip",
    };
  }

  async previewDataImport(
    data: Blob | BufferSource | string
  ): Promise<DataImportPreviewResponse> {
    const request: PreviewDataImportRequest = {
      data: await encodeArchiveData(data),
    };

    return this.request<DataImportPreviewResponse>(
      "/v1/platform/data/import/preview",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async restoreDataImport(
    data: Blob | BufferSource | string,
    options: { confirm: boolean }
  ): Promise<RestoreDataImportResponse> {
    const request: RestoreDataImportRequest = {
      confirm: options.confirm,
      data: await encodeArchiveData(data),
    };

    return this.request<RestoreDataImportResponse>(
      "/v1/platform/data/import/restore",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async previewSetupDataImport(
    data: Blob | BufferSource | string
  ): Promise<DataImportPreviewResponse> {
    const request: PreviewDataImportRequest = {
      data: await encodeArchiveData(data),
    };

    return this.request<DataImportPreviewResponse>(
      "/v1/auth/setup/import/preview",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async restoreSetupDataImport(
    data: Blob | BufferSource | string,
    options: { confirm: boolean }
  ): Promise<SetupRestoreDataImportResponse> {
    const request: RestoreDataImportRequest = {
      confirm: options.confirm,
      data: await encodeArchiveData(data),
    };

    return this.request<SetupRestoreDataImportResponse>(
      "/v1/auth/setup/import/restore",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async exportProfilePack(profileId: string): Promise<{
    data: ArrayBuffer;
    filename: string;
  }> {
    const response = await this.fetchRaw(
      `/v1/profiles/${encodeURIComponent(profileId)}/pack/export`
    );

    return {
      data: await response.arrayBuffer(),
      filename:
        readContentDispositionFilename(response.headers) ??
        "nakama-profile-export.zip",
    };
  }

  async previewProfilePackImport(
    data: Blob | BufferSource | string,
    options: { name?: string } = {}
  ): Promise<ProfilePackPreviewResponse> {
    const request = {
      data: await encodeArchiveData(data),
      name: options.name?.trim() || undefined,
    } satisfies Pick<ProfilePackImportRequest, "data" | "name">;

    return this.request<ProfilePackPreviewResponse>(
      "/v1/profiles/pack/import/preview",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async importProfilePack(
    data: Blob | BufferSource | string,
    options: { confirm: boolean; name?: string }
  ): Promise<ProfilePackImportResponse> {
    const request: ProfilePackImportRequest = {
      confirm: options.confirm,
      data: await encodeArchiveData(data),
      name: options.name,
    };

    return this.request<ProfilePackImportResponse>("/v1/profiles/pack/import", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listPluginWorkers(orgId?: string): Promise<PluginWorkerStatus[]> {
    return this.request<PluginWorkerStatus[]>("/v1/workers/plugins", {
      headers: orgId ? { "X-Org-Id": orgId } : undefined,
    });
  }

  async disconnectChannel(
    name: string,
    profileId: string
  ): Promise<{ ok: boolean }> {
    return this.request(
      `/v1/workers/${encodeURIComponent(name)}/disconnect?profileId=${encodeURIComponent(profileId)}`,
      { method: "POST" }
    );
  }

  async listLegacyChannels(): Promise<
    Array<{ platform: "telegram" | "discord" | "whatsapp"; global: boolean }>
  > {
    return this.request("/v1/settings/channel-legacy");
  }

  async claimLegacyChannel(
    platform: string,
    global: boolean,
    profileId: string
  ): Promise<{ ok: boolean }> {
    return this.request(
      `/v1/settings/channel-legacy/claim?profileId=${encodeURIComponent(profileId)}`,
      { body: JSON.stringify({ global, platform }), method: "POST" }
    );
  }

  async startWorker(
    name: string,
    profileId?: string
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/start?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async stopWorker(name: string, profileId?: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/stop?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async restartWorker(
    name: string,
    profileId?: string
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/restart?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async getWorkerLogs(
    name: string,
    lines?: number,
    profileId?: string
  ): Promise<WorkerLogsResponse> {
    const params = new URLSearchParams();

    if (lines !== undefined) {
      params.set("lines", String(lines));
    }

    if (profileId) {
      params.set("profileId", profileId);
    }

    const query = `?${params}`;

    return this.request<WorkerLogsResponse>(
      `/v1/workers/${encodeURIComponent(name)}/logs${query}`
    );
  }

  async clearWorkerLogs(
    name: string,
    profileId?: string
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/clear-logs?profileId=${encodeURIComponent(profileId ?? "")}`,
      {
        method: "POST",
      }
    );
  }

  async getModels(
    options: { source?: "catalog" | "remote" } = {}
  ): Promise<ModelsResponse> {
    const query = options.source === "remote" ? "?source=remote" : "";

    return this.request<ModelsResponse>(`/v1/models${query}`);
  }

  async getExternalModelCatalog(
    catalogId: "models-dev" | "openrouter" | "cerebras"
  ): Promise<JsonValue> {
    return this.request<JsonValue>(
      `/v1/model-catalogs/${encodeURIComponent(catalogId)}`
    );
  }

  async discoverModels(request: {
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
    provider?: "ollama" | "openai_compatible" | "fireworks" | "netra";
    hostMode?: "local" | "cloud";
  }): Promise<ModelsResponse> {
    return this.request<ModelsResponse>("/v1/models/discover", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listProviders(): Promise<ListProvidersResponse> {
    return this.request<ListProvidersResponse>("/v1/providers");
  }

  async createProvider(
    request: CreateProviderRequest
  ): Promise<CreateProviderResponse> {
    return this.request<CreateProviderResponse>("/v1/providers", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async updateProvider(
    providerId: string,
    request: UpdateProviderRequest
  ): Promise<UpdateProviderResponse> {
    return this.request<UpdateProviderResponse>(
      `/v1/providers/${encodeURIComponent(providerId)}`,
      {
        body: JSON.stringify(request),
        method: "PATCH",
      }
    );
  }

  async setProviderSecret(
    providerId: string,
    apiKey: string
  ): Promise<UpdateProviderResponse> {
    return this.request<UpdateProviderResponse>(
      `/v1/providers/${encodeURIComponent(providerId)}/secret`,
      { body: JSON.stringify({ apiKey }), method: "PUT" }
    );
  }

  async manageProviderSecret(
    providerId: string,
    action: "clear" | "use-stored"
  ): Promise<UpdateProviderResponse> {
    return this.request<UpdateProviderResponse>(
      `/v1/providers/${encodeURIComponent(providerId)}/secret${action === "use-stored" ? "/use-stored" : ""}`,
      { method: action === "clear" ? "DELETE" : "POST" }
    );
  }

  async deleteProvider(providerId: string): Promise<DeleteProviderResponse> {
    return this.request<DeleteProviderResponse>(
      `/v1/providers/${encodeURIComponent(providerId)}`,
      { method: "DELETE" }
    );
  }

  async startXaiOAuthDevice(): Promise<XaiOAuthDeviceStartResponse> {
    return this.request<XaiOAuthDeviceStartResponse>(
      "/v1/xai-oauth/device/start",
      { method: "POST" }
    );
  }

  async completeXaiOAuthDevice(
    request: XaiOAuthDeviceCompleteRequest,
    signal?: AbortSignal
  ): Promise<XaiOAuthDeviceCompleteResponse> {
    return this.request<XaiOAuthDeviceCompleteResponse>(
      "/v1/xai-oauth/device/complete",
      {
        body: JSON.stringify(request),
        method: "POST",
        signal,
      }
    );
  }
  async startChatgptOAuthDevice(): Promise<ChatgptOAuthDeviceStartResponse> {
    return this.request<ChatgptOAuthDeviceStartResponse>(
      "/v1/chatgpt-oauth/device/start",
      { method: "POST" }
    );
  }

  async completeChatgptOAuthDevice(
    request: ChatgptOAuthDeviceCompleteRequest
  ): Promise<ChatgptOAuthDeviceCompleteResponse> {
    return this.request<ChatgptOAuthDeviceCompleteResponse>(
      "/v1/chatgpt-oauth/device/complete",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async configureProvider(
    request: ConfigureProviderRequest
  ): Promise<ConfigureProviderResponse> {
    return this.request<ConfigureProviderResponse>("/v1/settings/provider", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }
}
