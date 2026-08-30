import { NakamaApiError, readApiErrorMessage } from "@nakama/core/api-error";
import type {
  AddOrgMemberRequest,
  AddOrgMemberResponse,
  AddOrgMemoryFactRequest,
  AgentBrowserStatusResponse,
  AgentChannel,
  ApplySkillSuggestionResponse,
  ApproveOrgMemoryProposalRequest,
  ArchiveOrgMemoryRequest,
  ArchiveOrgMemoryResponse,
  ArtifactShareStatusResponse,
  AssignMcpServerRequest,
  AssignSkillRequest,
  AssignToolRequest,
  AuthUserResponse,
  AutomationDefinition,
  AutomationResponse,
  AutomationRunRecord,
  AutomationSchedule,
  BranchSessionRequest,
  BranchSessionResponse,
  ChangePasswordRequest,
  CloneProfileRequest,
  CodingHarnessSettingsResponse,
  CompactionResponse,
  ComposioConnectRequest,
  ComposioConnectResponse,
  ComposioSettingsResponse,
  ComposioToolkitSummary,
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CreateAutomationRequest,
  CreateMcpServerRequest,
  CreateNotificationDestinationRequest,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  CreateProfileRequest,
  CreateProviderRequest,
  CreateProviderResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  CreateSkillRequest,
  CreateTaskRequest,
  CreateToolRequest,
  DataImportPreviewResponse,
  DeleteArtifactResponse,
  DeleteKnowledgeBaseResponse,
  DeleteProviderResponse,
  DiscordSettingsResponse,
  DocumentAttachment,
  DraftAutomationResponse,
  DraftTaskPromptRequest,
  DraftTaskPromptResponse,
  EmailSettingsResponse,
  ErrorTrackingSettingsResponse,
  GenerateImageRequest,
  GenerateImageResponse,
  HealthResponse,
  ImageAttachment,
  ImageGenerationSettings,
  ImageGenerationSettingsResponse,
  InitSoulResponse,
  InitUserContextResponse,
  InstallSkillRequest,
  InviteOrgMemberRequest,
  KnowledgeBaseDuplicateAction,
  ListArtifactsResponse,
  ListAutomationRunsResponse,
  ListAutomationsResponse,
  ListComposioToolkitsResponse,
  ListKnowledgeBaseResponse,
  ListMcpServersResponse,
  ListNotificationDestinationsResponse,
  ListOrganizationsResponse,
  ListOrgMembersResponse,
  ListOrgMemoryHistoryResponse,
  ListOrgMemoryProposalsResponse,
  ListProfileComposioToolkitsResponse,
  ListProfilesResponse,
  ListProvidersResponse,
  ListSessionsResponse,
  ListSkillCuratorOrgsResponse,
  ListSkillProposalsResponse,
  ListSkillSuggestionsResponse,
  ListSkillsResponse,
  ListTaskRunsResponse,
  ListTasksResponse,
  ListTimezonesResponse,
  ListToolsResponse,
  ListUserOrgsResponse,
  MarkAutomationRunsReadResponse,
  McpServerResponse,
  ModelsResponse,
  NotificationDestinationSummary,
  NotificationDestinationWithSecret,
  OrganizationResponse,
  OrgInviteCreatedResponse,
  OrgMemberResponse,
  OrgMemoryHistoryRevisionResponse,
  OrgMemoryProposalResponse,
  OrgMemoryResponse,
  OrgMemorySearchRequest,
  OrgMemorySearchResponse,
  PatchSkillRequest,
  PinOrgMemoryRequest,
  PreviewDataImportRequest,
  ProfilePackImportRequest,
  ProfilePackImportResponse,
  ProfilePackPreviewResponse,
  ProfileResponse,
  PublishArtifactShareRequest,
  PublishArtifactShareResponse,
  RegenerateNotificationDestinationKeyResponse,
  RestoreDataImportRequest,
  RestoreDataImportResponse,
  RestoreOrgMemoryHistoryResponse,
  RevokeArtifactShareResponse,
  RotateLocalAuthTokenResponse,
  RunAutomationResponse,
  RunSkillCuratorInternalRequest,
  RunSkillCuratorRequest,
  RunTaskResponse,
  RunToolRequest,
  RunToolResponse,
  SendEmailTestRequest,
  SendEmailTestResponse,
  SendErrorTrackingTestResponse,
  SendMessageResponse,
  SessionMessagesResponse,
  SessionStatusResponse,
  SetActiveOrgRequest,
  SetupAuthRequest,
  SetupRestoreDataImportResponse,
  SkillCuratorLatestResponse,
  SkillCuratorRunResponse,
  SkillProposalResponse,
  SkillResponse,
  SoulStackResponse,
  SoulStatusResponse,
  StoredAutomation,
  StoredTask,
  SuggestToolParamsRequest,
  SuggestToolParamsResponse,
  SyncSkillsResponse,
  SystemStatusResponse,
  TaskMessagesResponse,
  TaskResponse,
  TaskRunRecord,
  TelegramSettingsResponse,
  TestMcpServerResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  TimezoneSettingsResponse,
  TokenOptimizationResponse,
  TokenOptimizationUpdateResponse,
  ToolResponse,
  ToolSourceResponse,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
  TranscriptionSettings,
  TranscriptionSettingsResponse,
  UnpinOrgMemoryRequest,
  UpdateArtifactRequest,
  UpdateArtifactResponse,
  UpdateAuthProfileRequest,
  UpdateAutomationRequest,
  UpdateComposioSettingsRequest,
  UpdateDiscordSettingsRequest,
  UpdateEmailSettingsRequest,
  UpdateErrorTrackingSettingsRequest,
  UpdateImageGenerationRequest,
  UpdateMcpServerRequest,
  UpdateNotificationDestinationRequest,
  UpdateOrganizationRequest,
  UpdateOrgMemberRequest,
  UpdateOrgMemoryRequest,
  UpdateProfileComposioToolkitsRequest,
  UpdateProfileRequest,
  UpdateProviderRequest,
  UpdateProviderResponse,
  UpdateSessionRequest,
  UpdateSoulFileRequest,
  UpdateTaskRequest,
  UpdateTelegramSettingsRequest,
  UpdateThinkingRequest,
  UpdateTimezoneRequest,
  UpdateTranscriptionRequest,
  UpdateUserContextRequest,
  UpdateVisionRequest,
  UpdateWebPublicUrlRequest,
  UpdateWhatsAppSettingsRequest,
  UploadKnowledgeBaseRequest,
  UploadKnowledgeBaseResponse,
  UserContextStatusResponse,
  VisionSettings,
  VisionSettingsResponse,
  WebPublicUrlSettingsResponse,
  WhatsAppSettingsResponse,
  WorkerLogsResponse,
} from "@nakama/core/contract";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveServerUrl } from "@nakama/core/runtime";
import { readBrowserOrigin, readCookie } from "./browser";
import {
  normalizeStreamHandlers,
  readAgentBrowserInstallStream,
  readStreamEvents,
  resolveSendMessageBody,
  retryWhileTurnIsStopping,
  withStreamFetchIdle,
} from "./stream";
import type {
  BinaryBufferSource,
  FetchCredentials,
  NakamaClientOptions,
  RemoteChatSession,
  SendMessageArg,
  SendStreamOptions,
  StreamHandler,
  StreamHandlers,
} from "./types";

export class NakamaClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly credentials: FetchCredentials;
  private readonly clientOrigin: string | null;
  private authToken: string | null;
  private orgId: string | null;

  constructor(options: NakamaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveServerUrl()).replace(/\/$/, "");
    const fetchFn = options.fetch ?? fetch;
    this.fetchImpl = ((input, init) => fetchFn(input, init)) as typeof fetch;
    this.credentials = options.credentials ?? "include";
    this.clientOrigin = options.clientOrigin?.trim().replace(/\/$/, "") || null;
    this.authToken = options.authToken ?? null;
    this.orgId = options.orgId ?? null;
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  setOrgId(orgId: string | null): void {
    this.orgId = orgId?.trim() || null;
  }

  private applyAuthUserResponse(response: AuthUserResponse): void {
    const activeOrgId = response.activeOrgId ?? response.orgId ?? null;
    this.setOrgId(activeOrgId);
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  async getSystemStatus(): Promise<SystemStatusResponse> {
    return this.request<SystemStatusResponse>("/v1/system/status");
  }

  async getTokenOptimization(): Promise<TokenOptimizationResponse> {
    return this.request<TokenOptimizationResponse>("/v1/token-optimization");
  }

  async setTokenOptimization(
    enabled: boolean
  ): Promise<TokenOptimizationUpdateResponse> {
    return this.request<TokenOptimizationUpdateResponse>(
      "/v1/token-optimization",
      {
        body: JSON.stringify({ enabled }),
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

  async previewDataImport(
    data: Blob | BinaryBufferSource | string
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
    data: Blob | BinaryBufferSource | string,
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
    data: Blob | BinaryBufferSource | string
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
    data: Blob | BinaryBufferSource | string,
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
    data: Blob | BinaryBufferSource | string,
    options: { name?: string } = {}
  ): Promise<ProfilePackPreviewResponse> {
    const request: { data: string; name?: string } = {
      data: await encodeArchiveData(data),
    };
    if (options.name?.trim()) {
      request.name = options.name.trim();
    }
    return this.request<ProfilePackPreviewResponse>(
      "/v1/profiles/pack/import/preview",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async importProfilePack(
    data: Blob | BinaryBufferSource | string,
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

  async startWorker(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/start`,
      {
        method: "POST",
      }
    );
  }

  async stopWorker(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/stop`,
      {
        method: "POST",
      }
    );
  }

  async restartWorker(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/restart`,
      {
        method: "POST",
      }
    );
  }

  async getWorkerLogs(
    name: string,
    lines?: number
  ): Promise<WorkerLogsResponse> {
    const query = lines === undefined ? "" : `?lines=${lines}`;
    return this.request<WorkerLogsResponse>(
      `/v1/workers/${encodeURIComponent(name)}/logs${query}`
    );
  }

  async clearWorkerLogs(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/v1/workers/${encodeURIComponent(name)}/clear-logs`,
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
  ): Promise<unknown> {
    return this.request(`/v1/model-catalogs/${encodeURIComponent(catalogId)}`);
  }

  async discoverModels(request: {
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
    provider?: "ollama" | "openai_compatible" | "fireworks";
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

  async deleteProvider(providerId: string): Promise<DeleteProviderResponse> {
    return this.request<DeleteProviderResponse>(
      `/v1/providers/${encodeURIComponent(providerId)}`,
      { method: "DELETE" }
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

  async createSession(
    channel: AgentChannel,
    options: Omit<CreateSessionRequest, "channel"> = {}
  ): Promise<RemoteChatSession> {
    const response = await this.request<CreateSessionResponse>("/v1/sessions", {
      body: JSON.stringify({
        channel,
        model: options.model,
        profileId: options.profileId,
      }),
      method: "POST",
    });

    return this.createChatSession(response.sessionId, channel);
  }

  async getSessionMessages(
    sessionId: string
  ): Promise<SessionMessagesResponse> {
    return this.request<SessionMessagesResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`
    );
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
    return this.request<SessionStatusResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/status`
    );
  }

  async updateSession(
    sessionId: string,
    request: UpdateSessionRequest
  ): Promise<void> {
    await this.request<void>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      body: JSON.stringify(request),
      method: "PATCH",
    });
  }

  async subscribeSessionStream(
    sessionId: string,
    handler: StreamHandler | StreamHandlers,
    options?: SendStreamOptions
  ): Promise<{ reconnected: boolean; reply?: string }> {
    const handlers = normalizeStreamHandlers(handler);
    const headers = this.buildHeaders("GET", {
      Accept: "text/event-stream",
    });
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/stream`,
      withStreamFetchIdle({
        credentials: this.credentials,
        headers,
        method: "GET",
        signal: options?.signal,
      })
    );

    if (response.status === 204) {
      return { reconnected: false };
    }

    if (!response.ok) {
      throw await createApiError(response, `/v1/sessions/${sessionId}/stream`);
    }

    if (!response.body) {
      throw new Error("Server returned an empty stream.");
    }

    const reply = await readStreamEvents(
      response.body,
      handlers,
      options?.signal
    );
    return { reconnected: true, reply };
  }

  async branchSession(
    sessionId: string,
    request: BranchSessionRequest
  ): Promise<BranchSessionResponse> {
    return this.request<BranchSessionResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/branch`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async listSessions(
    profileId: string,
    channel: AgentChannel = "web"
  ): Promise<ListSessionsResponse> {
    const query = new URLSearchParams({ channel, profileId });
    return this.request<ListSessionsResponse>(
      `/v1/sessions?${query.toString()}`
    );
  }

  async listProfiles(orgId?: string): Promise<ListProfilesResponse> {
    return this.request<ListProfilesResponse>(
      "/v1/profiles",
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async getProfile(profileId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}`
    );
  }

  async createProfile(request: CreateProfileRequest): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("/v1/profiles", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async updateProfile(
    profileId: string,
    request: UpdateProfileRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.request(`/v1/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
  }

  async uploadProfileAvatar(
    profileId: string,
    attachment: ImageAttachment
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/avatar`,
      {
        body: JSON.stringify(attachment),
        method: "PUT",
      }
    );
  }

  async deleteProfileAvatar(profileId: string): Promise<void> {
    await this.request(`/v1/profiles/${encodeURIComponent(profileId)}/avatar`, {
      method: "DELETE",
    });
  }

  async listTools(): Promise<ListToolsResponse> {
    return this.request<ListToolsResponse>("/v1/tools");
  }

  async getTool(toolId: string): Promise<ToolResponse> {
    return this.request<ToolResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}`
    );
  }

  async getToolSource(toolId: string): Promise<ToolSourceResponse> {
    return this.request<ToolSourceResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}/source`
    );
  }

  async createTool(request: CreateToolRequest) {
    return this.request<{ tool: ListToolsResponse["tools"][number] }>(
      "/v1/tools",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async deleteTool(toolId: string): Promise<void> {
    await this.request(`/v1/tools/${encodeURIComponent(toolId)}`, {
      method: "DELETE",
    });
  }

  async runTool(
    toolId: string,
    request: RunToolRequest
  ): Promise<RunToolResponse> {
    return this.request<RunToolResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}/run`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async suggestToolParams(
    toolId: string,
    request: SuggestToolParamsRequest
  ): Promise<SuggestToolParamsResponse> {
    return this.request<SuggestToolParamsResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}/params/suggest`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async assignTool(
    profileId: string,
    request: AssignToolRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async unassignTool(
    profileId: string,
    toolId: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools/${encodeURIComponent(toolId)}`,
      {
        method: "DELETE",
      }
    );
  }

  async listMcpServers(): Promise<ListMcpServersResponse> {
    return this.request<ListMcpServersResponse>("/v1/mcp/servers");
  }

  async getMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}`
    );
  }

  async createMcpServer(
    request: CreateMcpServerRequest
  ): Promise<McpServerResponse> {
    return this.request<McpServerResponse>("/v1/mcp/servers", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async updateMcpServer(
    serverId: string,
    request: UpdateMcpServerRequest
  ): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}`,
      {
        body: JSON.stringify(request),
        method: "PATCH",
      }
    );
  }

  async deleteMcpServer(serverId: string): Promise<void> {
    await this.request(`/v1/mcp/servers/${encodeURIComponent(serverId)}`, {
      method: "DELETE",
    });
  }

  async connectMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}/connect`,
      { method: "POST" }
    );
  }

  async syncMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}/sync`,
      { method: "POST" }
    );
  }

  async testMcpServer(
    request: CreateMcpServerRequest
  ): Promise<TestMcpServerResponse> {
    return this.request<TestMcpServerResponse>("/v1/mcp/servers/test", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async assignMcpServer(
    profileId: string,
    request: AssignMcpServerRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/mcp-servers`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async unassignMcpServer(
    profileId: string,
    serverId: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/mcp-servers/${encodeURIComponent(serverId)}`,
      { method: "DELETE" }
    );
  }

  async listSkills(): Promise<ListSkillsResponse> {
    return this.request<ListSkillsResponse>("/v1/skills");
  }

  async cloneProfile(
    profileId: string,
    request: CloneProfileRequest = {}
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/clone`,
      { body: JSON.stringify(request), method: "POST" }
    );
  }

  async createSkill(request: CreateSkillRequest): Promise<SkillResponse> {
    return this.request<SkillResponse>("/v1/skills", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async installSkill(request: InstallSkillRequest): Promise<SkillResponse> {
    return this.request<SkillResponse>("/v1/skills/install", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async getSkill(skillId: string): Promise<SkillResponse> {
    return this.request<SkillResponse>(
      `/v1/skills/${encodeURIComponent(skillId)}`
    );
  }

  async patchSkill(
    skillId: string,
    request: PatchSkillRequest,
    options?: { profileId?: string }
  ): Promise<SkillResponse> {
    const params = new URLSearchParams();
    if (options?.profileId) {
      params.set("profileId", options.profileId);
    }

    const query = params.toString();
    const path = `/v1/skills/${encodeURIComponent(skillId)}${query ? `?${query}` : ""}`;

    return this.request<SkillResponse>(path, {
      body: JSON.stringify(request),
      method: "PATCH",
    });
  }

  async deleteSkill(skillId: string): Promise<void> {
    await this.request(`/v1/skills/${encodeURIComponent(skillId)}`, {
      method: "DELETE",
    });
  }

  async syncSkills(): Promise<SyncSkillsResponse> {
    return this.request<SyncSkillsResponse>("/v1/skills/sync", {
      method: "POST",
    });
  }

  async assignSkill(
    profileId: string,
    request: AssignSkillRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/skills`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async unassignSkill(
    profileId: string,
    skillId: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
      { method: "DELETE" }
    );
  }

  async getProfileSoulStatus(
    profileId: string,
    options: { includeContents?: boolean } = {}
  ): Promise<SoulStatusResponse> {
    const query = options.includeContents ? "?contents=true" : "";
    return this.request<SoulStatusResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul${query}`
    );
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResponse> {
    return this.request<InitSoulResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/init`,
      {
        method: "POST",
      }
    );
  }

  async getProfileSoulStack(profileId: string): Promise<SoulStackResponse> {
    return this.request<SoulStackResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/stack`
    );
  }

  async writeProfileSoulFile(
    profileId: string,
    fileKey: string,
    content: string
  ): Promise<void> {
    await this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/files/${encodeURIComponent(fileKey)}`,
      {
        body: JSON.stringify({ content } satisfies UpdateSoulFileRequest),
        method: "PUT",
      }
    );
  }

  async listProfileArtifacts(
    profileId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ListArtifactsResponse> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) {
      query.set("limit", String(options.limit));
    }
    if (options.offset !== undefined) {
      query.set("offset", String(options.offset));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<ListArtifactsResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts${suffix}`
    );
  }

  async deleteProfileArtifact(
    profileId: string,
    filename: string
  ): Promise<DeleteArtifactResponse> {
    const query = new URLSearchParams({ path: filename });
    return this.request<DeleteArtifactResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts?${query.toString()}`,
      { method: "DELETE" }
    );
  }

  async publishProfileArtifactShare(
    profileId: string,
    path: string
  ): Promise<PublishArtifactShareResponse> {
    const body: PublishArtifactShareRequest = { path };
    if (this.clientOrigin) {
      body.clientOrigin = this.clientOrigin;
    }

    return this.request<PublishArtifactShareResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/shares`,
      {
        body: JSON.stringify(body),
        method: "POST",
      }
    );
  }

  async getProfileArtifactShareStatus(
    profileId: string,
    path: string
  ): Promise<ArtifactShareStatusResponse | null> {
    const query = new URLSearchParams({ path });
    return this.request<ArtifactShareStatusResponse | null>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/shares/status?${query.toString()}`
    );
  }

  async revokeProfileArtifactShare(
    profileId: string,
    shareId: string
  ): Promise<RevokeArtifactShareResponse> {
    return this.request<RevokeArtifactShareResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/shares/${encodeURIComponent(shareId)}`,
      { method: "DELETE" }
    );
  }

  async readProfileArtifactContent(
    profileId: string,
    artifactPath: string,
    options: { inline?: boolean; render?: "markdown" } = {}
  ): Promise<{ contentType: string; data: ArrayBuffer }> {
    const query = new URLSearchParams({ path: artifactPath });
    if (options.inline) {
      query.set("inline", "1");
    }
    if (options.render) {
      query.set("render", options.render);
    }

    const response = await this.fetchRaw(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`
    );

    return {
      contentType:
        response.headers.get("Content-Type") ?? "application/octet-stream",
      data: await response.arrayBuffer(),
    };
  }

  async writeProfileArtifactContent(
    profileId: string,
    artifactPath: string,
    content: string
  ): Promise<UpdateArtifactResponse> {
    const query = new URLSearchParams({ path: artifactPath });

    return this.request<UpdateArtifactResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`,
      {
        body: JSON.stringify({ content } satisfies UpdateArtifactRequest),
        method: "PUT",
      }
    );
  }

  async listKnowledgeBase(
    profileId: string
  ): Promise<ListKnowledgeBaseResponse> {
    return this.request<ListKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base`
    );
  }

  async uploadKnowledgeBaseDocument(
    profileId: string,
    document: DocumentAttachment,
    onDuplicate?: KnowledgeBaseDuplicateAction
  ): Promise<UploadKnowledgeBaseResponse> {
    return this.request<UploadKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base`,
      {
        body: JSON.stringify({
          document,
          ...(onDuplicate ? { onDuplicate } : {}),
        } satisfies UploadKnowledgeBaseRequest),
        method: "POST",
      }
    );
  }

  async deleteKnowledgeBaseDocument(
    profileId: string,
    documentId: string
  ): Promise<DeleteKnowledgeBaseResponse> {
    return this.request<DeleteKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/${encodeURIComponent(documentId)}`,
      { method: "DELETE" }
    );
  }

  async readKnowledgeBaseDocumentContent(
    profileId: string,
    documentId: string,
    options: { inline?: boolean; render?: "text" } = {}
  ): Promise<{ contentType: string; data: ArrayBuffer }> {
    const query = new URLSearchParams();
    if (options.inline) {
      query.set("inline", "1");
    }
    if (options.render) {
      query.set("render", options.render);
    }

    const queryString = query.toString();
    const path = `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/${encodeURIComponent(documentId)}/content${queryString ? `?${queryString}` : ""}`;

    const response = await this.fetchRaw(path);

    return {
      contentType:
        response.headers.get("Content-Type") ?? "application/octet-stream",
      data: await response.arrayBuffer(),
    };
  }

  async getUserContext(
    options: { includeContent?: boolean } = {}
  ): Promise<UserContextStatusResponse> {
    const query = options.includeContent ? "?content=true" : "";
    return this.request<UserContextStatusResponse>(`/v1/user/context${query}`);
  }

  async writeUserContext(content: string): Promise<void> {
    await this.request("/v1/user/context", {
      body: JSON.stringify({ content } satisfies UpdateUserContextRequest),
      method: "PUT",
    });
  }

  async initUserContext(): Promise<InitUserContextResponse> {
    return this.request<InitUserContextResponse>("/v1/user/context/init", {
      method: "POST",
    });
  }

  createChatSession(
    sessionId: string,
    channel: AgentChannel
  ): RemoteChatSession {
    return {
      clear: async () => {
        await this.request(`/v1/sessions/${sessionId}`, {
          method: "DELETE",
        });
      },
      compact: async (options = {}) =>
        this.request<CompactionResponse>(`/v1/sessions/${sessionId}/compact`, {
          body: JSON.stringify(options),
          method: "POST",
        }),
      createAutomation: async (prompt: string) => {
        const response = await this.request<DraftAutomationResponse>(
          "/v1/automations/draft",
          {
            body: JSON.stringify({ channel, prompt }),
            method: "POST",
          }
        );

        return response.automation;
      },
      getMessages: async () => {
        const response = await this.getSessionMessages(sessionId);
        return response.messages;
      },
      id: sessionId,
      purge: async () => {
        await this.request(`/v1/sessions/${sessionId}?purge=true`, {
          method: "DELETE",
        });
      },
      send: async (input: SendMessageArg) => {
        const body = resolveSendMessageBody(
          input,
          this.clientOrigin ?? undefined
        );
        const response = await this.request<SendMessageResponse>(
          `/v1/sessions/${sessionId}/messages`,
          {
            body: JSON.stringify(body),
            method: "POST",
          }
        );

        return response.reply;
      },
      sendStream: async (
        input: SendMessageArg,
        handler: StreamHandler | StreamHandlers,
        options?: SendStreamOptions
      ) => {
        const handlers = normalizeStreamHandlers(handler);
        const body = {
          ...resolveSendMessageBody(input, this.clientOrigin ?? undefined),
          stream: true,
        };
        const headers = this.buildHeaders("POST", {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        });
        const response = await retryWhileTurnIsStopping(
          async () => {
            const attempt = await this.fetchImpl(
              `${this.baseUrl}/v1/sessions/${sessionId}/messages?stream=true`,
              withStreamFetchIdle({
                body: JSON.stringify(body),
                credentials: this.credentials,
                headers,
                method: "POST",
                signal: options?.signal,
              })
            );

            if (!attempt.ok) {
              throw await createApiError(
                attempt,
                `/v1/sessions/${sessionId}/messages`
              );
            }

            return attempt;
          },
          { signal: options?.signal }
        );

        if (!response.body) {
          throw new Error("Server returned an empty stream.");
        }

        return readStreamEvents(response.body, handlers, options?.signal);
      },
      subscribeStream: async (
        handler: StreamHandler | StreamHandlers,
        options?: SendStreamOptions
      ) => this.subscribeSessionStream(sessionId, handler, options),
    };
  }

  async draftAutomation(
    prompt: string,
    channel: AgentChannel
  ): Promise<AutomationDefinition> {
    const response = await this.request<DraftAutomationResponse>(
      "/v1/automations/draft",
      {
        body: JSON.stringify({ channel, prompt }),
        method: "POST",
      }
    );

    return response.automation;
  }

  async listAutomations(): Promise<ListAutomationsResponse> {
    return this.request<ListAutomationsResponse>("/v1/automations");
  }

  async getAutomation(automationId: string): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`
    );
    return response.automation;
  }

  async createAutomation(
    request: CreateAutomationRequest
  ): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>("/v1/automations", {
      body: JSON.stringify(request),
      method: "POST",
    });
    return response.automation;
  }

  async updateAutomation(
    automationId: string,
    request: UpdateAutomationRequest
  ): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
    return response.automation;
  }

  async deleteAutomation(automationId: string): Promise<void> {
    await this.request(`/v1/automations/${encodeURIComponent(automationId)}`, {
      method: "DELETE",
    });
  }

  async runAutomation(automationId: string): Promise<AutomationRunRecord> {
    const response = await this.request<RunAutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/run`,
      withStreamFetchIdle({ method: "POST" })
    );
    return response.run;
  }

  async listAutomationSchedules(): Promise<AutomationSchedule[]> {
    return this.request<AutomationSchedule[]>(
      "/v1/internal/automations/schedules"
    );
  }

  async runAutomationInternal(
    automationId: string,
    orgId: string
  ): Promise<void> {
    await this.request(
      `/v1/internal/automations/${encodeURIComponent(automationId)}/run?orgId=${encodeURIComponent(orgId)}`,
      withStreamFetchIdle({
        method: "POST",
      })
    );
  }

  async listAutomationRuns(
    automationId: string
  ): Promise<AutomationRunRecord[]> {
    const response = await this.request<ListAutomationRunsResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs`
    );
    return response.runs;
  }

  async deleteAutomationRun(
    automationId: string,
    runId: string
  ): Promise<void> {
    await this.request(
      `/v1/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" }
    );
  }

  async markAutomationRunsRead(automationId: string): Promise<string> {
    const response = await this.request<MarkAutomationRunsReadResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs/mark-read`,
      { method: "POST" }
    );
    return response.readThroughAt;
  }

  async listTasks(): Promise<StoredTask[]> {
    const response = await this.request<ListTasksResponse>("/v1/tasks");
    return response.tasks;
  }

  async getTask(taskId: string): Promise<StoredTask> {
    const response = await this.request<TaskResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`
    );
    return response.task;
  }

  async draftTaskPrompt(request: DraftTaskPromptRequest): Promise<string> {
    const response = await this.request<DraftTaskPromptResponse>(
      "/v1/tasks/draft-prompt",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
    return response.prompt;
  }

  async createTask(request: CreateTaskRequest): Promise<StoredTask> {
    const response = await this.request<TaskResponse>("/v1/tasks", {
      body: JSON.stringify(request),
      method: "POST",
    });
    return response.task;
  }

  async updateTask(
    taskId: string,
    request: UpdateTaskRequest
  ): Promise<StoredTask> {
    const response = await this.request<TaskResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
    return response.task;
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request(`/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
    });
  }

  async runTask(taskId: string): Promise<TaskRunRecord> {
    const response = await this.request<RunTaskResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}/run`,
      { method: "POST" }
    );
    return response.run;
  }

  async listTaskRuns(taskId: string): Promise<TaskRunRecord[]> {
    const response = await this.request<ListTaskRunsResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}/runs`
    );
    return response.runs;
  }

  async getTaskMessages(taskId: string): Promise<TaskMessagesResponse> {
    return this.request<TaskMessagesResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}/messages`
    );
  }

  async getTimezone(): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>(
      "/v1/settings/timezone"
    );
    return response.timezone;
  }

  async setTimezone(timezone: string): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>(
      "/v1/settings/timezone",
      {
        body: JSON.stringify({ timezone } satisfies UpdateTimezoneRequest),
        method: "PUT",
      }
    );
    return response.timezone;
  }

  async getThinkingSettings(): Promise<ThinkingSettings> {
    const response = await this.request<ThinkingSettingsResponse>(
      "/v1/settings/thinking"
    );
    return response.thinking;
  }

  async setThinkingSettings(
    settings: UpdateThinkingRequest
  ): Promise<ThinkingSettings> {
    const response = await this.request<ThinkingSettingsResponse>(
      "/v1/settings/thinking",
      {
        body: JSON.stringify(settings satisfies UpdateThinkingRequest),
        method: "PUT",
      }
    );
    return response.thinking;
  }

  async getVisionSettings(): Promise<VisionSettings> {
    const response = await this.request<VisionSettingsResponse>(
      "/v1/settings/vision"
    );
    return response.vision;
  }

  async setVisionSettings(model: string | null): Promise<VisionSettings> {
    const response = await this.request<VisionSettingsResponse>(
      "/v1/settings/vision",
      {
        body: JSON.stringify({ model } satisfies UpdateVisionRequest),
        method: "PUT",
      }
    );
    return response.vision;
  }

  async getTranscriptionSettings(): Promise<TranscriptionSettings> {
    const response = await this.request<TranscriptionSettingsResponse>(
      "/v1/settings/transcription"
    );
    return response.transcription;
  }

  async setTranscriptionSettings(
    model: string | null
  ): Promise<TranscriptionSettings> {
    const response = await this.request<TranscriptionSettingsResponse>(
      "/v1/settings/transcription",
      {
        body: JSON.stringify({ model } satisfies UpdateTranscriptionRequest),
        method: "PUT",
      }
    );
    return response.transcription;
  }

  async transcribeAudio(
    input: TranscribeAudioRequest
  ): Promise<TranscribeAudioResponse> {
    return this.request<TranscribeAudioResponse>("/v1/audio/transcribe", {
      body: JSON.stringify(input satisfies TranscribeAudioRequest),
      method: "POST",
    });
  }

  async getImageGenerationSettings(): Promise<ImageGenerationSettings> {
    const response = await this.request<ImageGenerationSettingsResponse>(
      "/v1/settings/image-generation"
    );
    return response.imageGeneration;
  }

  async setImageGenerationSettings(
    model: string | null
  ): Promise<ImageGenerationSettings> {
    const response = await this.request<ImageGenerationSettingsResponse>(
      "/v1/settings/image-generation",
      {
        body: JSON.stringify({ model } satisfies UpdateImageGenerationRequest),
        method: "PUT",
      }
    );
    return response.imageGeneration;
  }

  async generateImage(
    input: GenerateImageRequest
  ): Promise<GenerateImageResponse> {
    return this.request<GenerateImageResponse>("/v1/images/generate", {
      body: JSON.stringify(input satisfies GenerateImageRequest),
      method: "POST",
    });
  }

  async getTelegramSettings(): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram");
  }

  async setTelegramSettings(
    request: UpdateTelegramSettingsRequest
  ): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async regenerateTelegramHandshake(): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>(
      "/v1/settings/telegram/handshake",
      {
        method: "POST",
      }
    );
  }

  async getDiscordSettings(): Promise<DiscordSettingsResponse> {
    return this.request<DiscordSettingsResponse>("/v1/settings/discord");
  }

  async setDiscordSettings(
    request: UpdateDiscordSettingsRequest
  ): Promise<DiscordSettingsResponse> {
    return this.request<DiscordSettingsResponse>("/v1/settings/discord", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async regenerateDiscordHandshake(): Promise<DiscordSettingsResponse> {
    return this.request<DiscordSettingsResponse>(
      "/v1/settings/discord/handshake",
      {
        method: "POST",
      }
    );
  }

  async getErrorTrackingSettings(): Promise<ErrorTrackingSettingsResponse> {
    return this.request<ErrorTrackingSettingsResponse>(
      "/v1/settings/error-tracking"
    );
  }

  async setErrorTrackingSettings(
    request: UpdateErrorTrackingSettingsRequest
  ): Promise<ErrorTrackingSettingsResponse> {
    return this.request<ErrorTrackingSettingsResponse>(
      "/v1/settings/error-tracking",
      { body: JSON.stringify(request), method: "PUT" }
    );
  }

  async sendErrorTrackingTest(): Promise<SendErrorTrackingTestResponse> {
    return this.request<SendErrorTrackingTestResponse>(
      "/v1/settings/error-tracking/test",
      { method: "POST" }
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

  async getEmailSettings(): Promise<EmailSettingsResponse> {
    return this.request<EmailSettingsResponse>("/v1/settings/email");
  }

  async setEmailSettings(
    request: UpdateEmailSettingsRequest
  ): Promise<EmailSettingsResponse> {
    return this.request<EmailSettingsResponse>("/v1/settings/email", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async sendEmailTest(
    request: SendEmailTestRequest = {}
  ): Promise<SendEmailTestResponse> {
    return this.request<SendEmailTestResponse>("/v1/settings/email/test", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async getAgentBrowserStatus(): Promise<AgentBrowserStatusResponse> {
    return this.request<AgentBrowserStatusResponse>(
      "/v1/settings/agent-browser"
    );
  }

  async installAgentBrowser(
    handlers: {
      onProgress?: (message: string) => void;
      onDone?: (status: AgentBrowserStatusResponse) => void;
    } = {},
    options?: { signal?: AbortSignal }
  ): Promise<AgentBrowserStatusResponse> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/settings/agent-browser/install`,
      withStreamFetchIdle({
        credentials: this.credentials,
        headers: this.buildHeaders("POST", {
          Accept: "text/event-stream",
        }),
        method: "POST",
        signal: options?.signal,
      })
    );

    if (!response.ok) {
      throw await createApiError(
        response,
        "/v1/settings/agent-browser/install"
      );
    }

    if (!response.body) {
      throw new Error("Server returned an empty stream.");
    }

    return readAgentBrowserInstallStream(
      response.body,
      handlers,
      options?.signal
    );
  }

  async getWhatsAppSettings(): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>("/v1/settings/whatsapp");
  }

  async setWhatsAppSettings(
    request: UpdateWhatsAppSettingsRequest
  ): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>("/v1/settings/whatsapp", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async regenerateWhatsAppPairingCode(): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>(
      "/v1/settings/whatsapp/pairing-code",
      {
        method: "POST",
      }
    );
  }

  async reconnectWhatsApp(): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>(
      "/v1/settings/whatsapp/reconnect",
      {
        method: "POST",
      }
    );
  }

  async listTimezones(): Promise<ListTimezonesResponse> {
    return this.request<ListTimezonesResponse>("/v1/timezones");
  }

  async setupUser(request: SetupAuthRequest): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/setup", {
      body: JSON.stringify(request),
      method: "POST",
    });

    this.applyAuthUserResponse(response);
    return response;
  }

  async login(email: string, password: string): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    });

    this.applyAuthUserResponse(response);
    return response;
  }

  async getMe(): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/me");
    this.applyAuthUserResponse(response);
    return response;
  }

  async updateAuthProfile(
    request: UpdateAuthProfileRequest
  ): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/me", {
      body: JSON.stringify(request),
      method: "PATCH",
    });
    this.applyAuthUserResponse(response);
    return response;
  }

  async changePassword(request: ChangePasswordRequest): Promise<void> {
    await this.request("/v1/auth/change-password", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listUserOrgs(): Promise<ListUserOrgsResponse> {
    return this.request<ListUserOrgsResponse>("/v1/auth/orgs");
  }

  async createUserOrganization(
    request: Pick<CreateOrganizationRequest, "name" | "slug">
  ): Promise<CreateOrganizationResponse> {
    return this.request<CreateOrganizationResponse>("/v1/auth/orgs", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async runOrgSkillCurator(
    orgId: string,
    request: RunSkillCuratorRequest = {}
  ): Promise<SkillCuratorRunResponse> {
    return this.request<SkillCuratorRunResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/curator/run`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async getOrgSkillCuratorLatest(
    orgId: string
  ): Promise<SkillCuratorLatestResponse> {
    return this.request<SkillCuratorLatestResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/curator/latest`,
      {
        headers: { "X-Org-Id": orgId },
      }
    );
  }

  async listSkillCuratorOrgs(): Promise<ListSkillCuratorOrgsResponse> {
    return this.request<ListSkillCuratorOrgsResponse>(
      "/v1/internal/curator/orgs"
    );
  }

  async runSkillCuratorInternal(
    orgId: string,
    request: RunSkillCuratorInternalRequest
  ): Promise<SkillCuratorRunResponse> {
    return this.request<SkillCuratorRunResponse>(
      `/v1/internal/curator/orgs/${encodeURIComponent(orgId)}/run`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async updateOrganization(
    orgId: string,
    request: UpdateOrganizationRequest
  ): Promise<OrganizationResponse> {
    return this.request<OrganizationResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "PATCH",
      }
    );
  }

  async updatePlatformOrganization(
    orgId: string,
    request: UpdateOrganizationRequest
  ): Promise<OrganizationResponse> {
    return this.request<OrganizationResponse>(
      `/v1/platform/orgs/${encodeURIComponent(orgId)}`,
      {
        body: JSON.stringify(request),
        method: "PATCH",
      }
    );
  }

  async archivePlatformOrganization(
    orgId: string
  ): Promise<OrganizationResponse> {
    return this.request<OrganizationResponse>(
      `/v1/platform/orgs/${encodeURIComponent(orgId)}`,
      {
        method: "DELETE",
      }
    );
  }

  async setActiveOrg(orgId: string): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>(
      "/v1/auth/active-org",
      {
        body: JSON.stringify({ orgId } satisfies SetActiveOrgRequest),
        method: "POST",
      }
    );

    this.applyAuthUserResponse(response);
    return response;
  }

  async listPlatformOrganizations(): Promise<ListOrganizationsResponse> {
    return this.request<ListOrganizationsResponse>("/v1/platform/orgs");
  }

  async createPlatformOrganization(
    request: CreateOrganizationRequest
  ): Promise<CreateOrganizationResponse> {
    return this.request<CreateOrganizationResponse>("/v1/platform/orgs", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listOrgMembers(orgId: string): Promise<ListOrgMembersResponse> {
    return this.request<ListOrgMembersResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members`
    );
  }

  async addOrgMember(
    orgId: string,
    request: AddOrgMemberRequest
  ): Promise<AddOrgMemberResponse> {
    return this.request<AddOrgMemberResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async inviteOrgMember(
    orgId: string,
    request: InviteOrgMemberRequest
  ): Promise<OrgInviteCreatedResponse> {
    return this.request<OrgInviteCreatedResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/invites`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async updateOrgMember(
    orgId: string,
    userId: string,
    request: UpdateOrgMemberRequest
  ): Promise<OrgMemberResponse> {
    return this.request<OrgMemberResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      {
        body: JSON.stringify(request),
        method: "PATCH",
      }
    );
  }

  async removeOrgMember(orgId: string, userId: string): Promise<void> {
    await this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    );
  }

  async getOrgMemory(orgId: string): Promise<OrgMemoryResponse> {
    return this.request<OrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory`,
      {
        headers: { "X-Org-Id": orgId },
      }
    );
  }

  async updateOrgMemory(
    orgId: string,
    request: UpdateOrgMemoryRequest
  ): Promise<OrgMemoryResponse> {
    return this.request<OrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "PUT",
      }
    );
  }

  async addOrgMemoryFact(
    orgId: string,
    request: AddOrgMemoryFactRequest
  ): Promise<OrgMemoryResponse> {
    return this.request<OrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/facts`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async searchOrgMemory(
    orgId: string,
    request: OrgMemorySearchRequest
  ): Promise<OrgMemorySearchResponse> {
    return this.request<OrgMemorySearchResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/search`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async pinOrgMemoryFact(
    orgId: string,
    request: PinOrgMemoryRequest
  ): Promise<OrgMemoryResponse> {
    return this.request<OrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/pin`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async unpinOrgMemoryFact(
    orgId: string,
    request: UnpinOrgMemoryRequest
  ): Promise<OrgMemoryResponse> {
    return this.request<OrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/unpin`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async archiveOrgMemory(
    orgId: string,
    request: ArchiveOrgMemoryRequest
  ): Promise<ArchiveOrgMemoryResponse> {
    return this.request<ArchiveOrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/archive`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listOrgMemoryHistory(
    orgId: string
  ): Promise<ListOrgMemoryHistoryResponse> {
    return this.request<ListOrgMemoryHistoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async getOrgMemoryHistoryRevision(
    orgId: string,
    revisionId: string
  ): Promise<OrgMemoryHistoryRevisionResponse> {
    return this.request<OrgMemoryHistoryRevisionResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history/${encodeURIComponent(revisionId)}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async restoreOrgMemoryHistory(
    orgId: string,
    revisionId: string
  ): Promise<RestoreOrgMemoryHistoryResponse> {
    return this.request<RestoreOrgMemoryHistoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history/${encodeURIComponent(revisionId)}/restore`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async undoOrgMemoryChange(
    orgId: string
  ): Promise<RestoreOrgMemoryHistoryResponse> {
    return this.request<RestoreOrgMemoryHistoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history/undo`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listOrgMemoryProposals(
    orgId: string,
    status?: "pending" | "approved" | "rejected"
  ): Promise<ListOrgMemoryProposalsResponse> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<ListOrgMemoryProposalsResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/proposals${query}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async approveOrgMemoryProposal(
    orgId: string,
    proposalId: string,
    request: ApproveOrgMemoryProposalRequest = {}
  ): Promise<OrgMemoryProposalResponse> {
    return this.request<OrgMemoryProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/proposals/${encodeURIComponent(proposalId)}/approve`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async rejectOrgMemoryProposal(
    orgId: string,
    proposalId: string
  ): Promise<OrgMemoryProposalResponse> {
    return this.request<OrgMemoryProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listSkillProposals(
    orgId: string,
    options: {
      status?: "pending" | "approved" | "rejected";
      profileId?: string;
      sessionId?: string;
    } = {}
  ): Promise<ListSkillProposalsResponse> {
    const params = new URLSearchParams();
    if (options.status) {
      params.set("status", options.status);
    }
    if (options.profileId) {
      params.set("profileId", options.profileId);
    }
    if (options.sessionId) {
      params.set("sessionId", options.sessionId);
    }
    const query = params.toString();
    return this.request<ListSkillProposalsResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-proposals${query ? `?${query}` : ""}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async approveSkillProposal(
    orgId: string,
    proposalId: string
  ): Promise<SkillProposalResponse> {
    return this.request<SkillProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-proposals/${encodeURIComponent(proposalId)}/approve`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async rejectSkillProposal(
    orgId: string,
    proposalId: string
  ): Promise<SkillProposalResponse> {
    return this.request<SkillProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listSkillSuggestions(
    orgId: string,
    options: {
      sessionId?: string;
      status?: "pending" | "applied";
      profileId?: string;
    } = {}
  ): Promise<ListSkillSuggestionsResponse> {
    const params = new URLSearchParams();
    if (options.sessionId) {
      params.set("sessionId", options.sessionId);
    }
    if (options.status) {
      params.set("status", options.status);
    }
    if (options.profileId) {
      params.set("profileId", options.profileId);
    }
    const query = params.toString();
    return this.request<ListSkillSuggestionsResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-suggestions${query ? `?${query}` : ""}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async applySkillSuggestion(
    orgId: string,
    suggestionId: string
  ): Promise<ApplySkillSuggestionResponse> {
    return this.request<ApplySkillSuggestionResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-suggestions/${encodeURIComponent(suggestionId)}/apply`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async logout(): Promise<void> {
    await this.request("/v1/auth/logout", {
      method: "POST",
    });
  }

  async rotateLocalAuthToken(): Promise<RotateLocalAuthTokenResponse> {
    return this.request<RotateLocalAuthTokenResponse>(
      "/v1/auth/local-token/rotate",
      {
        method: "POST",
      }
    );
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    retried = false
  ): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = this.buildHeaders(method, init?.headers, {
      hasBody: init?.body != null,
    });

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      credentials: this.credentials,
      headers,
    });

    if (!response.ok) {
      if (
        response.status === 401 &&
        this.authToken &&
        !retried &&
        path !== "/v1/auth/local-token/rotate"
      ) {
        const freshToken = await loadLocalAuthToken();
        if (freshToken && freshToken !== this.authToken) {
          this.authToken = freshToken;
          return this.request(path, init, true);
        }
      }

      throw await createApiError(response, path);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async fetchRaw(
    path: string,
    init?: RequestInit,
    retried = false
  ): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = this.buildHeaders(method, init?.headers, {
      hasBody: false,
    });

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      credentials: this.credentials,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401 && this.authToken && !retried) {
        const freshToken = await loadLocalAuthToken();
        if (freshToken && freshToken !== this.authToken) {
          this.authToken = freshToken;
          return this.fetchRaw(path, init, true);
        }
      }

      throw await createApiError(response, path);
    }

    return response;
  }

  private buildHeaders(
    method: string,
    headers?: HeadersInit,
    options: { hasBody?: boolean } = {}
  ): Record<string, string> {
    const merged: Record<string, string> = {
      ...((headers as Record<string, string>) ?? {}),
    };

    if (options.hasBody && merged["Content-Type"] == null) {
      merged["Content-Type"] = "application/json";
    }

    if (this.authToken) {
      merged["Authorization"] = `Bearer ${this.authToken}`;
    }

    if (this.orgId && !merged["X-Org-Id"]) {
      merged["X-Org-Id"] = this.orgId;
    }

    if (isMutatingMethod(method)) {
      const csrfToken = readCookie("nakama_csrf");
      if (csrfToken) {
        merged["X-CSRF-Token"] = csrfToken;
      }
    }

    return merged;
  }
}
async function createApiError(
  response: Response,
  path: string
): Promise<NakamaApiError> {
  const message = await readApiErrorMessage(response);
  return new NakamaApiError(message, response.status, path);
}

function isMutatingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

async function encodeArchiveData(
  data: Blob | BinaryBufferSource | string
): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (isBlobLike(data)) {
    return encodeArchiveData(await data.arrayBuffer());
  }

  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}

function readContentDispositionFilename(headers: Headers): string | null {
  const contentDisposition = headers.get("content-disposition");
  const match = contentDisposition?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? null;
}

function isBlobLike(value: Blob | BinaryBufferSource): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}
