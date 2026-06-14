import type {
  AgentChannel,
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
  SetModelRequest,
  SetModelResponse,
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
  UpdateTelegramSettingsRequest,
  UpdateTimezoneRequest,
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
  StoredTask,
  TaskRunRecord,
} from "@tinyclaw/core/contract";
import { readApiErrorMessage, TinyClawApiError } from "@tinyclaw/core/api-error";
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

  constructor(options: TinyClawClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveServerUrl()).replace(/\/$/, "");
    const fetchFn = options.fetch ?? fetch;
    this.fetchImpl = ((input, init) => fetchFn(input, init)) as typeof fetch;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  async getSystemStatus(): Promise<SystemStatusResponse> {
    return this.request<SystemStatusResponse>("/v1/system/status");
  }

  async getModels(options: { source?: "catalog" | "remote" } = {}): Promise<ModelsResponse> {
    const query =
      options.source === "remote" ? "?source=remote" : "";
    return this.request<ModelsResponse>(`/v1/models${query}`);
  }

  async discoverModels(request: {
    baseUrl: string;
    apiKey?: string;
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

  async setModel(request: SetModelRequest): Promise<SetModelResponse> {
    return this.request<SetModelResponse>("/v1/settings/model", {
      method: "PUT",
      body: JSON.stringify(request),
    });
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
        const response = await this.fetchImpl(
          `${this.baseUrl}/v1/sessions/${sessionId}/messages?stream=true`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify(body),
            signal: options?.signal,
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

  async listTimezones(): Promise<ListTimezonesResponse> {
    return this.request<ListTimezonesResponse>("/v1/timezones");
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw await createApiError(response, path);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
async function createApiError(response: Response, path: string): Promise<TinyClawApiError> {
  const message = await readApiErrorMessage(response);
  return new TinyClawApiError(message, response.status, path);
}
