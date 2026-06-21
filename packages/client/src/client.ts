import type {
  AgentChannel,
  BranchSessionRequest,
  BranchSessionResponse,
  AssignMcpServerRequest,
  AssignSkillRequest,
  AssignToolRequest,
  CreateMcpServerRequest,
  ListMcpServersResponse,
  McpServerResponse,
  TestMcpServerResponse,
  UpdateMcpServerRequest,
  CreateProfileRequest,
  CreateSkillRequest,
  CreateSessionResponse,
  CreateToolRequest,
  DeleteKnowledgeBaseResponse,
  DocumentAttachment,
  DraftAutomationResponse,
  HealthResponse,
  ImageAttachment,
  InitSoulResponse,
  InitUserContextResponse,
  ListKnowledgeBaseResponse,
  ListProfilesResponse,
  ListSkillsResponse,
  ListToolsResponse,
  SkillResponse,
  SyncSkillsResponse,
  ToolResponse,
  ToolSourceResponse,
  ListSessionsResponse,
  ModelsResponse,
  CreateProviderRequest,
  CreateProviderResponse,
  DeleteProviderResponse,
  ListProvidersResponse,
  UpdateProviderRequest,
  UpdateProviderResponse,
  ProfileResponse,
  SendMessageResponse,
  SessionMessagesResponse,
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CompactionResponse,
  SoulStackResponse,
  SoulStatusResponse,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UpdateUserContextRequest,
  UploadKnowledgeBaseRequest,
  UploadKnowledgeBaseResponse,
  UserContextStatusResponse,
  AutomationDefinition,
  AutomationRunRecord,
  CreateAutomationRequest,
  ListAutomationRunsResponse,
  ListAutomationsResponse,
  AutomationResponse,
  RunAutomationResponse,
  StoredAutomation,
  SystemStatusResponse,
  TelegramSettingsResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  TimezoneSettingsResponse,
  UpdateAutomationRequest,
  UpdateThinkingRequest,
  UpdateVisionRequest,
  UpdateTelegramSettingsRequest,
  UpdateWhatsAppSettingsRequest,
  UpdateTimezoneRequest,
  VisionSettings,
  VisionSettingsResponse,
  WhatsAppSettingsResponse,
  ListTimezonesResponse,
  CreateTaskRequest,
  DraftTaskPromptRequest,
  DraftTaskPromptResponse,
  UpdateTaskRequest,
  ListTasksResponse,
  TaskResponse,
  RunTaskResponse,
  ListTaskRunsResponse,
  TaskMessagesResponse,
  AuthUserResponse,
  SetupAuthRequest,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  ListOrganizationsResponse,
  ListUserOrgsResponse,
  SetActiveOrgRequest,
  AddOrgMemberRequest,
  AddOrgMemberResponse,
  InviteOrgMemberRequest,
  OrgInviteCreatedResponse,
  ListOrgMembersResponse,
  UpdateOrgMemberRoleRequest,
  OrgMemberResponse,
  StoredTask,
  TaskRunRecord,
  WorkerLogsResponse,
  RotateLocalAuthTokenResponse,
} from "@tinyclaw/core/contract";
import { readApiErrorMessage, TinyClawApiError } from "@tinyclaw/core/api-error";
import { loadLocalAuthToken } from "@tinyclaw/core/local-auth";
import { resolveServerUrl } from "@tinyclaw/core/runtime";
import {
  normalizeStreamHandlers,
  readStreamEvents,
  resolveSendMessageBody,
} from "./stream";
import type {
  RemoteChatSession,
  SendMessageArg,
  SendStreamOptions,
  StreamHandler,
  StreamHandlers,
  TinyClawClientOptions,
} from "./types";

export class TinyClawClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly credentials: RequestCredentials;
  private authToken: string | null;
  private orgId: string | null;

  constructor(options: TinyClawClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveServerUrl()).replace(/\/$/, "");
    const fetchFn = options.fetch ?? fetch;
    this.fetchImpl = ((input, init) => fetchFn(input, init)) as typeof fetch;
    this.credentials = options.credentials ?? "include";
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

  async startWorker(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/workers/${encodeURIComponent(name)}/start`, {
      method: "POST",
    });
  }

  async stopWorker(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/workers/${encodeURIComponent(name)}/stop`, {
      method: "POST",
    });
  }

  async restartWorker(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/workers/${encodeURIComponent(name)}/restart`, {
      method: "POST",
    });
  }

  async getWorkerLogs(name: string, lines?: number): Promise<WorkerLogsResponse> {
    const query = lines !== undefined ? `?lines=${lines}` : "";
    return this.request<WorkerLogsResponse>(`/v1/workers/${encodeURIComponent(name)}/logs${query}`);
  }

  async clearWorkerLogs(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/workers/${encodeURIComponent(name)}/clear-logs`, {
      method: "POST",
    });
  }

  async getModels(options: { source?: "catalog" | "remote" } = {}): Promise<ModelsResponse> {
    const query =
      options.source === "remote" ? "?source=remote" : "";
    return this.request<ModelsResponse>(`/v1/models${query}`);
  }

  async discoverModels(request: {
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
  }): Promise<ModelsResponse> {
    return this.request<ModelsResponse>("/v1/models/discover", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async listProviders(): Promise<ListProvidersResponse> {
    return this.request<ListProvidersResponse>("/v1/providers");
  }

  async createProvider(request: CreateProviderRequest): Promise<CreateProviderResponse> {
    return this.request<CreateProviderResponse>("/v1/providers", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async updateProvider(
    providerId: string,
    request: UpdateProviderRequest,
  ): Promise<UpdateProviderResponse> {
    return this.request<UpdateProviderResponse>(
      `/v1/providers/${encodeURIComponent(providerId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(request),
      },
    );
  }

  async deleteProvider(providerId: string): Promise<DeleteProviderResponse> {
    return this.request<DeleteProviderResponse>(
      `/v1/providers/${encodeURIComponent(providerId)}`,
      { method: "DELETE" },
    );
  }

  async configureProvider(
    request: ConfigureProviderRequest,
  ): Promise<ConfigureProviderResponse> {
    return this.request<ConfigureProviderResponse>("/v1/settings/provider", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  async createSession(
    channel: AgentChannel,
    options: { profileId?: string } = {},
  ): Promise<RemoteChatSession> {
    const response = await this.request<CreateSessionResponse>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ channel, profileId: options.profileId }),
    });

    return this.createChatSession(response.sessionId, channel);
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
    return this.request<SessionMessagesResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
  }

  async branchSession(
    sessionId: string,
    request: BranchSessionRequest,
  ): Promise<BranchSessionResponse> {
    return this.request<BranchSessionResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/branch`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async listSessions(
    profileId: string,
    channel: AgentChannel = "web",
  ): Promise<ListSessionsResponse> {
    const query = new URLSearchParams({ profileId, channel });
    return this.request<ListSessionsResponse>(`/v1/sessions?${query.toString()}`);
  }

  async listProfiles(): Promise<ListProfilesResponse> {
    return this.request<ListProfilesResponse>("/v1/profiles");
  }

  async getProfile(profileId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(`/v1/profiles/${encodeURIComponent(profileId)}`);
  }

  async createProfile(request: CreateProfileRequest): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("/v1/profiles", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async updateProfile(
    profileId: string,
    request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}`,
      {
        method: "PUT",
        body: JSON.stringify(request),
      },
    );
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.request(`/v1/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
  }

  async uploadProfileAvatar(
    profileId: string,
    attachment: ImageAttachment,
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/avatar`,
      {
        method: "PUT",
        body: JSON.stringify(attachment),
      },
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
    return this.request<ToolResponse>(`/v1/tools/${encodeURIComponent(toolId)}`);
  }

  async getToolSource(toolId: string): Promise<ToolSourceResponse> {
    return this.request<ToolSourceResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}/source`,
    );
  }

  async createTool(request: CreateToolRequest) {
    return this.request<{ tool: ListToolsResponse["tools"][number] }>("/v1/tools", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async deleteTool(toolId: string): Promise<void> {
    await this.request(`/v1/tools/${encodeURIComponent(toolId)}`, {
      method: "DELETE",
    });
  }

  async assignTool(profileId: string, request: AssignToolRequest): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async unassignTool(profileId: string, toolId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools/${encodeURIComponent(toolId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async listMcpServers(): Promise<ListMcpServersResponse> {
    return this.request<ListMcpServersResponse>("/v1/mcp/servers");
  }

  async getMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}`,
    );
  }

  async createMcpServer(request: CreateMcpServerRequest): Promise<McpServerResponse> {
    return this.request<McpServerResponse>("/v1/mcp/servers", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async updateMcpServer(
    serverId: string,
    request: UpdateMcpServerRequest,
  ): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(request),
      },
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
      { method: "POST" },
    );
  }

  async syncMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}/sync`,
      { method: "POST" },
    );
  }

  async testMcpServer(request: CreateMcpServerRequest): Promise<TestMcpServerResponse> {
    return this.request<TestMcpServerResponse>("/v1/mcp/servers/test", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async assignMcpServer(
    profileId: string,
    request: AssignMcpServerRequest,
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/mcp-servers`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async unassignMcpServer(profileId: string, serverId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/mcp-servers/${encodeURIComponent(serverId)}`,
      { method: "DELETE" },
    );
  }

  async listSkills(): Promise<ListSkillsResponse> {
    return this.request<ListSkillsResponse>("/v1/skills");
  }

  async createSkill(request: CreateSkillRequest): Promise<SkillResponse> {
    return this.request<SkillResponse>("/v1/skills", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getSkill(skillId: string): Promise<SkillResponse> {
    return this.request<SkillResponse>(`/v1/skills/${encodeURIComponent(skillId)}`);
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

  async assignSkill(profileId: string, request: AssignSkillRequest): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/skills`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async unassignSkill(profileId: string, skillId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
      { method: "DELETE" },
    );
  }

  async getProfileSoulStatus(
    profileId: string,
    options: { includeContents?: boolean } = {},
  ): Promise<SoulStatusResponse> {
    const query = options.includeContents ? "?contents=true" : "";
    return this.request<SoulStatusResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul${query}`,
    );
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResponse> {
    return this.request<InitSoulResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/init`,
      {
        method: "POST",
      },
    );
  }

  async getProfileSoulStack(profileId: string): Promise<SoulStackResponse> {
    return this.request<SoulStackResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/stack`,
    );
  }

  async writeProfileSoulFile(
    profileId: string,
    fileKey: string,
    content: string,
  ): Promise<void> {
    await this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/files/${encodeURIComponent(fileKey)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content } satisfies UpdateSoulFileRequest),
      },
    );
  }

  async listKnowledgeBase(profileId: string): Promise<ListKnowledgeBaseResponse> {
    return this.request<ListKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base`,
    );
  }

  async uploadKnowledgeBaseDocument(
    profileId: string,
    document: DocumentAttachment,
  ): Promise<UploadKnowledgeBaseResponse> {
    return this.request<UploadKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base`,
      {
        method: "POST",
        body: JSON.stringify({ document } satisfies UploadKnowledgeBaseRequest),
      },
    );
  }

  async deleteKnowledgeBaseDocument(
    profileId: string,
    documentId: string,
  ): Promise<DeleteKnowledgeBaseResponse> {
    return this.request<DeleteKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
  }

  async getUserContext(
    options: { includeContent?: boolean } = {},
  ): Promise<UserContextStatusResponse> {
    const query = options.includeContent ? "?content=true" : "";
    return this.request<UserContextStatusResponse>(`/v1/user/context${query}`);
  }

  async writeUserContext(content: string): Promise<void> {
    await this.request("/v1/user/context", {
      method: "PUT",
      body: JSON.stringify({ content } satisfies UpdateUserContextRequest),
    });
  }

  async initUserContext(): Promise<InitUserContextResponse> {
    return this.request<InitUserContextResponse>("/v1/user/context/init", {
      method: "POST",
    });
  }

  createChatSession(sessionId: string, channel: AgentChannel): RemoteChatSession {
    return {
      id: sessionId,
      send: async (input: SendMessageArg) => {
        const body = resolveSendMessageBody(input);
        const response = await this.request<SendMessageResponse>(
          `/v1/sessions/${sessionId}/messages`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );

        return response.reply;
      },
      sendStream: async (
        input: SendMessageArg,
        handler: StreamHandler | StreamHandlers,
        options?: SendStreamOptions,
      ) => {
        const handlers = normalizeStreamHandlers(handler);
        const body = { ...resolveSendMessageBody(input), stream: true };
        const headers = this.buildHeaders("POST", {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        });
        const response = await this.fetchImpl(
          `${this.baseUrl}/v1/sessions/${sessionId}/messages?stream=true`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: options?.signal,
            credentials: this.credentials,
          },
        );

        if (!response.ok) {
          throw await createApiError(response, `/v1/sessions/${sessionId}/messages`);
        }

        if (!response.body) {
          throw new Error("Server returned an empty stream.");
        }

        return readStreamEvents(response.body, handlers, options?.signal);
      },
      compact: async (options = {}) => {
        return this.request<CompactionResponse>(
          `/v1/sessions/${sessionId}/compact`,
          {
            method: "POST",
            body: JSON.stringify(options),
          },
        );
      },
      clear: async () => {
        await this.request(`/v1/sessions/${sessionId}`, {
          method: "DELETE",
        });
      },
      purge: async () => {
        await this.request(`/v1/sessions/${sessionId}?purge=true`, {
          method: "DELETE",
        });
      },
      getMessages: async () => {
        const response = await this.getSessionMessages(sessionId);
        return response.messages;
      },
      createAutomation: async (prompt: string) => {
        const response = await this.request<DraftAutomationResponse>(
          "/v1/automations/draft",
          {
            method: "POST",
            body: JSON.stringify({ prompt, channel }),
          },
        );

        return response.automation;
      },
    };
  }

  async draftAutomation(
    prompt: string,
    channel: AgentChannel,
  ): Promise<AutomationDefinition> {
    const response = await this.request<DraftAutomationResponse>(
      "/v1/automations/draft",
      {
        method: "POST",
        body: JSON.stringify({ prompt, channel }),
      },
    );

    return response.automation;
  }

  async listAutomations(): Promise<StoredAutomation[]> {
    const response = await this.request<ListAutomationsResponse>("/v1/automations");
    return response.automations;
  }

  async getAutomation(automationId: string): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`,
    );
    return response.automation;
  }

  async createAutomation(request: CreateAutomationRequest): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>("/v1/automations", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return response.automation;
  }

  async updateAutomation(
    automationId: string,
    request: UpdateAutomationRequest,
  ): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`,
      {
        method: "PUT",
        body: JSON.stringify(request),
      },
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
      { method: "POST" },
    );
    return response.run;
  }

  async listAutomationRuns(automationId: string): Promise<AutomationRunRecord[]> {
    const response = await this.request<ListAutomationRunsResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs`,
    );
    return response.runs;
  }

  async listTasks(): Promise<StoredTask[]> {
    const response = await this.request<ListTasksResponse>("/v1/tasks");
    return response.tasks;
  }

  async getTask(taskId: string): Promise<StoredTask> {
    const response = await this.request<TaskResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
    );
    return response.task;
  }

  async draftTaskPrompt(request: DraftTaskPromptRequest): Promise<string> {
    const response = await this.request<DraftTaskPromptResponse>("/v1/tasks/draft-prompt", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return response.prompt;
  }

  async createTask(request: CreateTaskRequest): Promise<StoredTask> {
    const response = await this.request<TaskResponse>("/v1/tasks", {
      method: "POST",
      body: JSON.stringify(request),
    });
    return response.task;
  }

  async updateTask(taskId: string, request: UpdateTaskRequest): Promise<StoredTask> {
    const response = await this.request<TaskResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "PUT",
        body: JSON.stringify(request),
      },
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
      { method: "POST" },
    );
    return response.run;
  }

  async listTaskRuns(taskId: string): Promise<TaskRunRecord[]> {
    const response = await this.request<ListTaskRunsResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}/runs`,
    );
    return response.runs;
  }

  async getTaskMessages(taskId: string): Promise<TaskMessagesResponse> {
    return this.request<TaskMessagesResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}/messages`,
    );
  }

  async getTimezone(): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>("/v1/settings/timezone");
    return response.timezone;
  }

  async setTimezone(timezone: string): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>("/v1/settings/timezone", {
      method: "PUT",
      body: JSON.stringify({ timezone } satisfies UpdateTimezoneRequest),
    });
    return response.timezone;
  }

  async getThinkingSettings(): Promise<ThinkingSettings> {
    const response = await this.request<ThinkingSettingsResponse>("/v1/settings/thinking");
    return response.thinking;
  }

  async setThinkingSettings(
    settings: UpdateThinkingRequest,
  ): Promise<ThinkingSettings> {
    const response = await this.request<ThinkingSettingsResponse>("/v1/settings/thinking", {
      method: "PUT",
      body: JSON.stringify(settings satisfies UpdateThinkingRequest),
    });
    return response.thinking;
  }

  async getVisionSettings(): Promise<VisionSettings> {
    const response = await this.request<VisionSettingsResponse>("/v1/settings/vision");
    return response.vision;
  }

  async setVisionSettings(model: string | null): Promise<VisionSettings> {
    const response = await this.request<VisionSettingsResponse>("/v1/settings/vision", {
      method: "PUT",
      body: JSON.stringify({ model } satisfies UpdateVisionRequest),
    });
    return response.vision;
  }

  async getTelegramSettings(): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram");
  }

  async setTelegramSettings(
    request: UpdateTelegramSettingsRequest,
  ): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  async regenerateTelegramHandshake(): Promise<TelegramSettingsResponse> {
    return this.request<TelegramSettingsResponse>("/v1/settings/telegram/handshake", {
      method: "POST",
    });
  }

  async getWhatsAppSettings(): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>("/v1/settings/whatsapp");
  }

  async setWhatsAppSettings(
    request: UpdateWhatsAppSettingsRequest,
  ): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>("/v1/settings/whatsapp", {
      method: "PUT",
      body: JSON.stringify(request),
    });
  }

  async regenerateWhatsAppPairingCode(): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>("/v1/settings/whatsapp/pairing-code", {
      method: "POST",
    });
  }

  async reconnectWhatsApp(): Promise<WhatsAppSettingsResponse> {
    return this.request<WhatsAppSettingsResponse>("/v1/settings/whatsapp/reconnect", {
      method: "POST",
    });
  }

  async listTimezones(): Promise<ListTimezonesResponse> {
    return this.request<ListTimezonesResponse>("/v1/timezones");
  }

  async setupUser(request: SetupAuthRequest): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/setup", {
      method: "POST",
      body: JSON.stringify(request),
    });

    this.applyAuthUserResponse(response);
    return response;
  }

  async login(email: string, password: string): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    this.applyAuthUserResponse(response);
    return response;
  }

  async getMe(): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/me");
    this.applyAuthUserResponse(response);
    return response;
  }

  async listUserOrgs(): Promise<ListUserOrgsResponse> {
    return this.request<ListUserOrgsResponse>("/v1/auth/orgs");
  }

  async createUserOrganization(
    request: Pick<CreateOrganizationRequest, "name" | "slug">,
  ): Promise<CreateOrganizationResponse> {
    return this.request<CreateOrganizationResponse>("/v1/auth/orgs", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async setActiveOrg(orgId: string): Promise<AuthUserResponse> {
    const response = await this.request<AuthUserResponse>("/v1/auth/active-org", {
      method: "POST",
      body: JSON.stringify({ orgId } satisfies SetActiveOrgRequest),
    });

    this.applyAuthUserResponse(response);
    return response;
  }

  async listPlatformOrganizations(): Promise<ListOrganizationsResponse> {
    return this.request<ListOrganizationsResponse>("/v1/platform/orgs");
  }

  async createPlatformOrganization(
    request: CreateOrganizationRequest,
  ): Promise<CreateOrganizationResponse> {
    return this.request<CreateOrganizationResponse>("/v1/platform/orgs", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async listOrgMembers(orgId: string): Promise<ListOrgMembersResponse> {
    return this.request<ListOrgMembersResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members`,
    );
  }

  async addOrgMember(
    orgId: string,
    request: AddOrgMemberRequest,
  ): Promise<AddOrgMemberResponse> {
    return this.request<AddOrgMemberResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async inviteOrgMember(
    orgId: string,
    request: InviteOrgMemberRequest,
  ): Promise<OrgInviteCreatedResponse> {
    return this.request<OrgInviteCreatedResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/invites`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async updateOrgMemberRole(
    orgId: string,
    userId: string,
    request: UpdateOrgMemberRoleRequest,
  ): Promise<OrgMemberResponse> {
    return this.request<OrgMemberResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(request),
      },
    );
  }

  async removeOrgMember(orgId: string, userId: string): Promise<void> {
    await this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  }

  async logout(): Promise<void> {
    await this.request("/v1/auth/logout", {
      method: "POST",
    });
  }

  async rotateLocalAuthToken(): Promise<RotateLocalAuthTokenResponse> {
    return this.request<RotateLocalAuthTokenResponse>("/v1/auth/local-token/rotate", {
      method: "POST",
    });
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    retried = false,
  ): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = this.buildHeaders(method, init?.headers);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: this.credentials,
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

  private buildHeaders(method: string, headers?: HeadersInit): Record<string, string> {
    const merged: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers as Record<string, string> ?? {}),
    };

    if (this.authToken) {
      merged["Authorization"] = `Bearer ${this.authToken}`;
    }

    if (this.orgId) {
      merged["X-Org-Id"] = this.orgId;
    }

    if (isMutatingMethod(method)) {
      const csrfToken = readCookie("tinyclaw_csrf");
      if (csrfToken) {
        merged["X-CSRF-Token"] = csrfToken;
      }
    }

    return merged;
  }
}
async function createApiError(response: Response, path: string): Promise<TinyClawApiError> {
  const message = await readApiErrorMessage(response);
  return new TinyClawApiError(message, response.status, path);
}

function isMutatingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length) || null;
    }
  }

  return null;
}
