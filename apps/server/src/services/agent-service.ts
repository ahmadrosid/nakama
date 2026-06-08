import {
  createAgentHarness,
  draftTaskPromptFromFields,
  type AgentChatSession,
  type AgentHarness,
  type CompactionConfig,
} from "@tinyclaw/agent";
import type {
  AgentChannel,
  AgentTodo,
  AssignToolRequest,
  ChatMessage,
  CompactionResponse,
  CreateProfileRequest,
  CreateToolRequest,
  InitSoulResponse,
  InitUserContextResponse,
  ListProfilesResponse,
  ListToolsResponse,
  ListSessionsResponse,
  ModelsResponse,
  ProfileResponse,
  ToolResponse,
  ToolSourceResponse,
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CreateProviderRequest,
  CreateProviderResponse,
  DeleteProviderResponse,
  ImageAttachment,
  ListProvidersResponse,
  SetModelRequest,
  SetModelResponse,
  UpdateProviderRequest,
  UpdateProviderResponse,
  SoulStackResponse,
  SoulStatusResponse,
  TelegramSettingsResponse,
  ToolDefinition,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UpdateTelegramSettingsRequest,
  UpdateUserContextRequest,
  UserContextStatusResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  UpdateThinkingRequest,
  ProviderChatOptions,
  ProviderClient,
  type UserConfig,
} from "@tinyclaw/core";
import {
  buildThinkingProviderOptions,
  composeSoulSystemPrompt,
  createId,
  createSessionId,
  findProviderInstance,
  getActiveProviderInstance,
  getProfileSoulDir,
  getResolvedSoulStatus,
  getUserContextStatus,
  initSoulDirectory,
  initUserContext as initializeUserContext,
  isProviderConfigured,
  isWritableSoulFileKey,
  loadSoulStack,
  loadTelegramSettingsPublic,
  loadUserContext,
  loadUserTimezone,
  regenerateTelegramHandshake,
  resolveSoulStackForProfile,
  saveTelegramConfig,
  loadUserThinkingSettings,
  saveUserConfig,
  saveUserThinkingSettings,
  saveUserTimezone,
  writeSoulFile,
  writeUserContext as persistUserContext,
} from "@tinyclaw/core";
import {
  DEFAULT_PROFILE_ID,
  SUPER_BOT_TOOL_AUTHORING_RULES,
  type DatabaseAdapter,
  type StoredProfileRecord,
  type StoredTaskRunRecord,
} from "@tinyclaw/db";
import {
  createProviderFromActiveConfig,
  createProviderFromSources,
  fetchRemoteOpenAIModels,
  AVAILABLE_MODELS,
  getModelById,
  getModelsForProviderInstance,
  isCostEstimated,
  resolveModel,
} from "../providers";
import {
  applyProviderInstanceUpdate,
  buildProviderInstanceFromCreateRequest,
  countModelsForInstance,
  mergeModelsForConfig,
  modelExistsOnInstance,
  resolveDefaultModelForInstance,
  resolveInitialModel,
  toProviderInstanceSummary,
} from "./provider-instance-helpers";
import { createSuperBotTools } from "../tools/super-bot-tools";
import { createTodoTools } from "../tools/todo-tools";
import { AgentTodoState } from "./agent-todo-state";
import type { AutomationRunner } from "./automation-runner";
import {
  loadSessionHistory,
  replaceSessionHistory,
  wrapPersistedSession,
} from "./session-persistence";
import type { TaskRunner } from "./task-runner";
import { buildMcpToolDefinitions } from "./mcp-tool-bridge";
import type { McpClientManager } from "./mcp-client-manager";
import type { McpService } from "./mcp-service";
import { ProfileService } from "./profile-service";
import { SessionTitleService } from "./session-title-service";
import { SuperBotSessionState } from "./super-bot-session-state";
import { resolveToolsFromStorage } from "./tool-resolver";
import { wrapProviderWithUsageTracking } from "../providers/usage-tracking";
import type { LlmUsageTracker } from "./llm-usage-tracker";

interface StoredSession {
  channel: AgentChannel;
  profileId: string;
  session: AgentChatSession;
}

export class AgentService {
  private harness: AgentHarness;
  private userConfig: UserConfig | null;
  private readonly db: DatabaseAdapter;
  private readonly profileService: ProfileService;
  private readonly superBotSessionState = new SuperBotSessionState();
  private readonly agentTodoState: AgentTodoState;
  private readonly superBotTools: ToolDefinition[];
  private automationTools: ToolDefinition[] = [];
  private todoTools: ToolDefinition[] = [];
  private automationRunner: AutomationRunner | null = null;
  private taskRunner: TaskRunner | null = null;
  private mcpClientManager: McpClientManager | null = null;
  private mcpService: McpService | null = null;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly sessionTitleService: SessionTitleService;
  private _providerConfigured: boolean;

  constructor(
    userConfig: UserConfig | null,
    provider: ProviderClient | null,
    db: DatabaseAdapter,
    private readonly llmUsageTracker?: LlmUsageTracker,
  ) {
    this.userConfig = userConfig;
    this.db = db;
    this.profileService = new ProfileService(db);
    this.sessionTitleService = new SessionTitleService(
      db,
      () => this.userConfig,
      () => this._providerConfigured,
    );
    this.agentTodoState = new AgentTodoState(db);
    this.todoTools = createTodoTools(this.agentTodoState);
    this.superBotTools = createSuperBotTools(this.profileService, this.superBotSessionState);
    this._providerConfigured = isProviderConfigured(userConfig) && provider !== null;
    this.harness = this.createHarness(provider);
  }

  get profiles(): ProfileService {
    return this.profileService;
  }

  setAutomationTools(tools: ToolDefinition[]): void {
    this.automationTools = tools;
    this.sessions.clear();
  }

  setAutomationRunner(runner: AutomationRunner): void {
    this.automationRunner = runner;
  }

  setTaskRunner(runner: TaskRunner): void {
    this.taskRunner = runner;
  }

  setMcpClientManager(manager: McpClientManager): void {
    this.mcpClientManager = manager;
    this.sessions.clear();
  }

  setMcpService(service: McpService): void {
    this.mcpService = service;
  }

  getMcpService(): McpService {
    if (!this.mcpService) {
      throw new Error("MCP service is not configured.");
    }

    return this.mcpService;
  }

  async getUserTimezone(): Promise<string> {
    return this.userConfig?.timezone ?? loadUserTimezone();
  }

  async setUserTimezone(timezone: string): Promise<string> {
    await saveUserTimezone(timezone);

    if (this.userConfig) {
      this.userConfig = { ...this.userConfig, timezone };
    }

    return timezone;
  }

  async getThinkingSettings(): Promise<ThinkingSettingsResponse> {
    const thinking = await this.resolveThinkingSettings();
    return { thinking };
  }

  async setThinkingSettings(
    input: UpdateThinkingRequest,
  ): Promise<ThinkingSettingsResponse> {
    const effort = input.effort ?? (await this.resolveThinkingSettings()).effort;
    const thinking: ThinkingSettings = {
      enabled: input.enabled,
      effort,
    };

    await saveUserThinkingSettings(thinking);

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        thinkingEnabled: thinking.enabled,
        thinkingEffort: thinking.effort,
      };
    }

    this.harness = this.createHarness(
      createProviderFromSources(process.env, this.userConfig),
    );
    this.sessions.clear();

    return { thinking };
  }

  private async resolveThinkingSettings(): Promise<ThinkingSettings> {
    if (
      this.userConfig?.thinkingEnabled !== undefined ||
      this.userConfig?.thinkingEffort !== undefined
    ) {
      return {
        enabled: this.userConfig.thinkingEnabled ?? true,
        effort: this.userConfig.thinkingEffort ?? "medium",
      };
    }

    return loadUserThinkingSettings();
  }

  private resolveChatProviderOptions(
    overrides?: Partial<ProviderChatOptions>,
  ): ProviderChatOptions | undefined {
    const active = getActiveProviderInstance(this.userConfig);
    const thinking =
      active?.type === "openai_compatible"
        ? undefined
        : buildThinkingProviderOptions(this.userConfig);
    const webSearch = overrides?.webSearch;
    const mergedThinking = overrides?.thinking ?? thinking;

    if (!webSearch && !mergedThinking) {
      return undefined;
    }

    return {
      ...(webSearch ? { webSearch } : {}),
      ...(mergedThinking ? { thinking: mergedThinking } : {}),
    };
  }

  async getTelegramSettings(): Promise<TelegramSettingsResponse> {
    return loadTelegramSettingsPublic();
  }

  async setTelegramSettings(
    input: UpdateTelegramSettingsRequest,
  ): Promise<TelegramSettingsResponse> {
    const existing = await loadTelegramSettingsPublic();
    const botToken =
      input.botToken !== undefined && input.botToken.trim()
        ? input.botToken.trim()
        : undefined;

    if (!botToken && !existing.configured) {
      throw new Error("Bot token is required.");
    }

    return saveTelegramConfig({
      ...(botToken ? { botToken } : {}),
      ...(input.allowedUserIds !== undefined
        ? { allowedUserIds: input.allowedUserIds }
        : existing.allowedUserIds.length > 0
          ? { allowedUserIds: existing.allowedUserIds.join(",") }
          : {}),
      ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
    });
  }

  async regenerateTelegramHandshake(): Promise<TelegramSettingsResponse> {
    return regenerateTelegramHandshake();
  }

  async runAutomationPrompt(profileId: string, prompt: string): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const profile = await this.requireProfile(profileId);
    const tools = await this.resolveProfileTools(profile, {
      includeAutomationTools: false,
      includeTodoTools: false,
    });
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      profileId,
      profile.systemPrompt,
    );
    const userTimezone = await this.getUserTimezone();
    const userContext = await loadUserContext();

    const session = this.harness.createChatSession({
      channel: "automation",
      tools,
      systemPrompt,
      userContext,
      enableToolLoop: true,
      soul: soulActive,
      userTimezone,
    });

    return session.send(prompt);
  }

  async runTaskPrompt(taskId: string, profileId: string, prompt: string): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const sessionId = await this.ensureTaskSession(taskId, profileId);
    const session = await this.resolveSession(sessionId);

    if (!session) {
      throw new Error("Session not found.");
    }

    return session.send(prompt);
  }

  async ensureTaskSession(taskId: string, profileId: string): Promise<string> {
    const record = await this.db.getTask(taskId);

    if (!record) {
      throw new Error("Task not found.");
    }

    if (record.sessionId) {
      const existing = await this.db.getSession(record.sessionId);

      if (existing) {
        return record.sessionId;
      }
    }

    const sessionId = await this.createSession("task", profileId);

    await this.db.upsertTask({
      ...record,
      sessionId,
      updatedAt: new Date().toISOString(),
    });

    return sessionId;
  }

  async getTaskChatMessages(
    taskId: string,
  ): Promise<{ sessionId: string; messages: ChatMessage[] } | null> {
    const record = await this.db.getTask(taskId);

    if (!record) {
      return null;
    }

    let sessionId = record.sessionId;

    if (sessionId) {
      const existing = await this.db.getSession(sessionId);

      if (!existing) {
        sessionId = null;
      }
    }

    if (!sessionId) {
      sessionId = await this.ensureTaskSession(taskId, record.profileId);
    }

    let messages = await loadSessionHistory(this.db, sessionId);

    if (messages.length === 0) {
      const runs = await this.db.listTaskRuns(taskId, 1);
      const latestRun = runs[0];

      if (latestRun && latestRun.status !== "running") {
        await this.seedTaskSessionFromRun(record.prompt, latestRun, sessionId);
        messages = await loadSessionHistory(this.db, sessionId);
      }
    }

    return { sessionId, messages };
  }

  private async seedTaskSessionFromRun(
    prompt: string,
    run: StoredTaskRunRecord,
    sessionId: string,
  ): Promise<void> {
    const history: ChatMessage[] = [{ role: "user", content: prompt }];

    if (run.status === "failed") {
      history.push({
        role: "assistant",
        content: run.error ?? "Task run failed.",
      });
    } else if (run.output) {
      history.push({
        role: "assistant",
        content: run.output,
      });
    }

    await replaceSessionHistory(this.db, sessionId, history);
  }

  async runAutomation(automationId: string) {
    if (!this.automationRunner) {
      throw new Error("Automation runner is not configured.");
    }

    return this.automationRunner.run(automationId);
  }

  async runTask(taskId: string) {
    if (!this.taskRunner) {
      throw new Error("Task runner is not configured.");
    }

    return this.taskRunner.run(taskId);
  }

  get providerConfigured(): boolean {
    return this._providerConfigured;
  }

  async createSession(
    channel: AgentChannel,
    profileId = DEFAULT_PROFILE_ID,
  ): Promise<string> {
    const sessionId = createSessionId();

    await this.db.upsertSession({
      id: sessionId,
      profileId,
      channel,
      createdAt: new Date().toISOString(),
      title: null,
      agentTodos: [],
    });

    const session = await this.buildChatSession(channel, profileId, sessionId);

    this.sessions.set(sessionId, { channel, profileId, session });

    return sessionId;
  }

  async getSessionTodos(sessionId: string): Promise<AgentTodo[] | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    return this.agentTodoState.listActive(sessionId);
  }

  async getSessionMessages(sessionId: string): Promise<ChatMessage[] | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    return loadSessionHistory(this.db, sessionId);
  }

  async listSessions(
    profileId: string,
    channel: AgentChannel,
  ): Promise<ListSessionsResponse> {
    await this.requireProfile(profileId);

    const sessions = await this.db.listSessionSummaries(profileId, channel);

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        profileId: session.profileId,
        channel: parseAgentChannel(session.channel) ?? channel,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        title: session.title,
        preview: session.preview,
      })),
    };
  }

  scheduleSessionTitleGeneration(sessionId: string): void {
    this.sessionTitleService.scheduleSessionTitleGeneration(sessionId);
  }

  async purgeSession(sessionId: string): Promise<boolean> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return false;
    }

    this.sessions.delete(sessionId);
    this.superBotSessionState.clearSession(sessionId);
    this.agentTodoState.clearSession(sessionId);
    await this.db.deleteSession(sessionId);
    return true;
  }

  async resolveSession(sessionId: string): Promise<AgentChatSession | null> {
    const stored = this.sessions.get(sessionId);

    if (stored) {
      return stored.session;
    }

    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      return null;
    }

    const session = await this.buildChatSession(
      channel,
      record.profileId,
      sessionId,
    );

    this.sessions.set(sessionId, {
      channel,
      profileId: record.profileId,
      session,
    });

    return session;
  }

  async clearSession(sessionId: string): Promise<boolean> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return false;
    }

    const stored = this.sessions.get(sessionId);

    if (stored) {
      stored.session.clear();
    }

    await this.db.deleteMessagesForSession(sessionId);
    return true;
  }

  async compactSession(
    sessionId: string,
    options: { force?: boolean } = {},
  ): Promise<CompactionResponse | null> {
    const session = await this.resolveSession(sessionId);

    if (!session) {
      return null;
    }

    return session.compact(options);
  }

  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);

    if (deleted) {
      this.agentTodoState.clearSession(sessionId);
      void this.db.deleteSession(sessionId);
    }

    return deleted;
  }

  async draftAutomation(prompt: string, channel: AgentChannel) {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    return this.harness.createAutomationFromPrompt({ prompt, channel });
  }

  async draftTaskPrompt(title: string, description?: string): Promise<string> {
    const provider = createProviderFromSources(process.env, this.userConfig);

    return draftTaskPromptFromFields(
      { title, description },
      { provider: provider ?? undefined },
    );
  }

  async discoverModels(baseUrl: string, apiKey = ""): Promise<ModelsResponse> {
    const entries = await fetchRemoteOpenAIModels(baseUrl, apiKey);
    const probeInstance = {
      id: "discover",
      type: "openai_compatible" as const,
      label: "Discover",
      apiKey,
      baseUrl,
      customModels: entries,
      createdAt: new Date(0).toISOString(),
    };
    const models = getModelsForProviderInstance(probeInstance);

    return {
      currentProviderId: null,
      currentModel: null,
      defaultModel: entries[0]?.id ?? null,
      providers: [],
      models,
      provider: "openai_compatible",
      displayName: null,
      customModels: entries,
    };
  }

  async listProviders(): Promise<ListProvidersResponse> {
    const providers = this.userConfig?.providers ?? [];

    return {
      providers: providers.map((instance) =>
        toProviderInstanceSummary(instance, countModelsForInstance(instance)),
      ),
      defaultProviderId: this.userConfig?.defaultProviderId ?? null,
      defaultModel: this.userConfig?.defaultModel ?? null,
    };
  }

  async createProvider(request: CreateProviderRequest): Promise<CreateProviderResponse> {
    const existing = this.userConfig?.providers ?? [];
    const instance = buildProviderInstanceFromCreateRequest(request, existing);
    const model = resolveInitialModel(instance, request.model);
    const providers = [...existing, instance];
    const isFirst = providers.length === 1;
    const thinking = await this.resolveThinkingSettings();
    const baseConfig = this.userConfig ?? {
      defaultProviderId: null,
      defaultModel: null,
      providers: [],
      thinkingEnabled: thinking.enabled,
      thinkingEffort: thinking.effort,
    };

    this.userConfig = {
      ...baseConfig,
      providers,
      defaultProviderId:
        isFirst || !baseConfig.defaultProviderId ? instance.id : baseConfig.defaultProviderId,
      defaultModel: isFirst || !baseConfig.defaultModel ? model : baseConfig.defaultModel,
    };

    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    if (isFirst) {
      await this.ensureSoulScaffolded();
    }

    return {
      provider: toProviderInstanceSummary(instance, countModelsForInstance(instance)),
      defaultProviderId: this.userConfig.defaultProviderId!,
      defaultModel: this.userConfig.defaultModel!,
    };
  }

  async updateProvider(
    providerId: string,
    request: UpdateProviderRequest,
  ): Promise<UpdateProviderResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const current = findProviderInstance(this.userConfig, providerId);

    if (!current) {
      throw new Error("Provider not found.");
    }

    const updated = applyProviderInstanceUpdate(current, request);
    const providers = this.userConfig.providers.map((instance) =>
      instance.id === providerId ? updated : instance,
    );

    this.userConfig = { ...this.userConfig, providers };
    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    return {
      provider: toProviderInstanceSummary(updated, countModelsForInstance(updated)),
    };
  }

  async deleteProvider(providerId: string): Promise<DeleteProviderResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const providers = this.userConfig.providers.filter((instance) => instance.id !== providerId);

    if (providers.length === this.userConfig.providers.length) {
      throw new Error("Provider not found.");
    }

    let defaultProviderId = this.userConfig.defaultProviderId;
    let defaultModel = this.userConfig.defaultModel;

    if (defaultProviderId === providerId) {
      const next = providers[0];

      if (next) {
        defaultProviderId = next.id;
        defaultModel = resolveDefaultModelForInstance(next);
      } else {
        defaultProviderId = null;
        defaultModel = null;
      }
    }

    this.userConfig = {
      ...this.userConfig,
      providers,
      defaultProviderId,
      defaultModel,
    };

    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    return { defaultProviderId, defaultModel };
  }

  async getModels(options: { source?: "catalog" | "remote" } = {}): Promise<ModelsResponse> {
    const active = getActiveProviderInstance(this.userConfig);
    const currentProviderId = this.userConfig?.defaultProviderId ?? null;
    const currentModel = this.userConfig?.defaultModel ?? null;
    const configuredProviders = this.userConfig?.providers ?? [];
    const providers = configuredProviders.map((instance) =>
      toProviderInstanceSummary(instance, countModelsForInstance(instance)),
    );

    if (configuredProviders.length === 0) {
      return this.buildModelsResponse({
        active: null,
        currentProviderId: null,
        currentModel: null,
        providers: [],
        models: AVAILABLE_MODELS,
      });
    }

    if (
      options.source === "remote" &&
      active?.type === "openai_compatible" &&
      active.baseUrl
    ) {
      const remote = await fetchRemoteOpenAIModels(active.baseUrl, active.apiKey);
      const remoteInstance = { ...active, customModels: remote };
      const models = mergeModelsForConfig(
        (this.userConfig?.providers ?? []).map((instance) =>
          instance.id === active.id ? remoteInstance : instance,
        ),
        currentProviderId,
        currentModel,
      );

      return this.buildModelsResponse({
        active,
        currentProviderId,
        currentModel,
        providers,
        models,
        customModels: remote,
      });
    }

    const models = mergeModelsForConfig(
      this.userConfig?.providers ?? [],
      currentProviderId,
      currentModel,
    );

    return this.buildModelsResponse({
      active,
      currentProviderId,
      currentModel,
      providers,
      models,
    });
  }

  private buildModelsResponse(options: {
    active: ReturnType<typeof getActiveProviderInstance>;
    currentProviderId: string | null;
    currentModel: string | null;
    providers: ReturnType<typeof toProviderInstanceSummary>[];
    models: ModelsResponse["models"];
    customModels?: ModelsResponse["customModels"];
  }): ModelsResponse {
    const { active, currentProviderId, currentModel, providers, models, customModels } =
      options;

    return {
      currentProviderId,
      currentModel,
      defaultModel: currentModel,
      providers,
      models,
      provider: active?.type ?? null,
      displayName: active?.type === "openai_compatible" ? active.label : null,
      baseUrl: active?.type === "openai_compatible" ? (active.baseUrl ?? null) : null,
      customModels:
        customModels ??
        (active && (active.type === "openrouter" || active.type === "openai_compatible")
          ? active.customModels
          : undefined),
    };
  }

  getLlmUsageStats() {
    return (
      this.llmUsageTracker?.getStats() ?? {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        trackedSince: new Date().toISOString(),
      }
    );
  }

  async setModel(request: SetModelRequest): Promise<SetModelResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const instance = findProviderInstance(this.userConfig, request.providerId);

    if (!instance) {
      throw new Error("Provider not found.");
    }

    const trimmedModel = request.model.trim();

    if (!modelExistsOnInstance(instance, trimmedModel)) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    this.userConfig = {
      ...this.userConfig,
      defaultProviderId: instance.id,
      defaultModel: trimmedModel,
    };

    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    return {
      providerId: instance.id,
      provider: instance.type,
      currentModel: trimmedModel,
    };
  }

  async configureProvider(
    request: ConfigureProviderRequest,
  ): Promise<ConfigureProviderResponse> {
    const result = await this.createProvider({
      type: request.provider,
      apiKey: request.apiKey,
      model: request.model,
      label: request.displayName,
      baseUrl: request.baseUrl,
      customModels: request.customModels,
    });

    const instance = findProviderInstance(this.userConfig, result.defaultProviderId);

    return {
      provider: result.provider.type,
      currentModel: result.defaultModel,
      displayName:
        instance?.type === "openai_compatible" ? (instance.label ?? null) : null,
    };
  }

  private refreshHarness(): void {
    const provider = createProviderFromActiveConfig(this.userConfig);
    this._providerConfigured = isProviderConfigured(this.userConfig);
    this.harness = this.createHarness(provider);
    this.sessions.clear();
  }

  async listProfiles(): Promise<ListProfilesResponse> {
    return this.profileService.listProfiles();
  }

  async getProfile(profileId: string): Promise<ProfileResponse> {
    return this.profileService.getProfile(profileId);
  }

  async createProfile(request: CreateProfileRequest): Promise<ProfileResponse> {
    return this.profileService.createProfile(request);
  }

  async updateProfile(
    profileId: string,
    request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    return this.profileService.updateProfile(profileId, request);
  }

  async deleteProfile(profileId: string): Promise<void> {
    return this.profileService.deleteProfile(profileId);
  }

  async listTools(): Promise<ListToolsResponse> {
    return this.profileService.listTools();
  }

  async getTool(toolId: string): Promise<ToolResponse> {
    return this.profileService.getTool(toolId);
  }

  async getToolSource(toolId: string): Promise<ToolSourceResponse> {
    return this.profileService.getToolSource(toolId);
  }

  async createTool(request: CreateToolRequest) {
    const tool = await this.profileService.createTool(request);
    return { tool };
  }

  async deleteTool(toolId: string): Promise<void> {
    return this.profileService.deleteTool(toolId);
  }

  async listProfileTools(profileId: string): Promise<ListToolsResponse> {
    return this.profileService.listProfileTools(profileId);
  }

  async assignTool(
    profileId: string,
    request: AssignToolRequest,
  ): Promise<ProfileResponse> {
    return this.profileService.assignTool(profileId, request);
  }

  async unassignTool(profileId: string, toolId: string): Promise<ProfileResponse> {
    return this.profileService.unassignTool(profileId, toolId);
  }

  async assignMcpServer(
    profileId: string,
    request: { serverId: string },
  ): Promise<ProfileResponse> {
    return this.profileService.assignMcpServer(profileId, request);
  }

  async unassignMcpServer(profileId: string, serverId: string): Promise<ProfileResponse> {
    return this.profileService.unassignMcpServer(profileId, serverId);
  }

  async uploadProfileAvatar(
    profileId: string,
    attachment: ImageAttachment,
  ): Promise<ProfileResponse> {
    return this.profileService.uploadProfileAvatar(profileId, attachment);
  }

  async getProfileAvatar(
    profileId: string,
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    return this.profileService.getProfileAvatar(profileId);
  }

  async deleteProfileAvatar(profileId: string): Promise<void> {
    return this.profileService.deleteProfileAvatar(profileId);
  }

  async getProfileSoulStatus(
    profileId: string,
    includeContents = false,
  ): Promise<SoulStatusResponse> {
    await this.requireProfile(profileId);
    const status = await getResolvedSoulStatus(profileId);

    if (!includeContents) {
      return { ...status, profileId };
    }

    const stack = await loadSoulStack(getProfileSoulDir(profileId));
    return { ...status, profileId, contents: stack.files };
  }

  async ensureSoulScaffolded(): Promise<void> {
    const profiles = await this.db.listProfiles();

    for (const profile of profiles) {
      await initSoulDirectory(getProfileSoulDir(profile.id));
    }
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResponse> {
    await this.requireProfile(profileId);
    const result = await initSoulDirectory(getProfileSoulDir(profileId));
    return { ...result, profileId };
  }

  async getProfileSoulStack(profileId: string): Promise<SoulStackResponse> {
    await this.requireProfile(profileId);
    const stack = await loadSoulStack(getProfileSoulDir(profileId));
    return { ...stack, profileId };
  }

  async writeProfileSoulFile(
    profileId: string,
    key: string,
    request: UpdateSoulFileRequest,
  ): Promise<void> {
    await this.requireProfile(profileId);

    if (!isWritableSoulFileKey(key)) {
      throw new Error(`Invalid soul file key: ${key}`);
    }

    await writeSoulFile(getProfileSoulDir(profileId), key, request.content);
  }

  async getUserContext(includeContent = false): Promise<UserContextStatusResponse> {
    const status = await getUserContextStatus();

    if (!includeContent) {
      const { content: _content, ...rest } = status;
      return rest;
    }

    return status;
  }

  async initUserContext(): Promise<InitUserContextResponse> {
    return initializeUserContext();
  }

  async writeUserContext(request: UpdateUserContextRequest): Promise<void> {
    await persistUserContext(request.content);
  }

  private createHarness(provider: ProviderClient | null): AgentHarness {
    const active = getActiveProviderInstance(this.userConfig);
    const modelId =
      provider && active && this.userConfig?.defaultModel
        ? resolveModel(active.type, this.userConfig.defaultModel, active.customModels)
        : null;

    this.syncUsagePricingContext(active);

    const trackedProvider =
      provider && this.llmUsageTracker && modelId
        ? wrapProviderWithUsageTracking(provider, this.llmUsageTracker, modelId)
        : provider;

    return createAgentHarness({
      provider: trackedProvider ?? undefined,
      chatOptions: this.resolveChatProviderOptions(),
    });
  }

  private syncUsagePricingContext(
    active: ReturnType<typeof getActiveProviderInstance>,
  ): void {
    this.llmUsageTracker?.setPricingContext({
      provider: active?.type ?? null,
      providerInstance: active,
    });
  }

  getUsageStatusFields(): {
    displayName: string | null;
    costEstimated: boolean;
  } {
    const active = getActiveProviderInstance(this.userConfig);
    const currentModel = this.userConfig?.defaultModel ?? null;

    return {
      displayName: active?.type === "openai_compatible" ? (active.label ?? null) : null,
      costEstimated: isCostEstimated(active?.type ?? null, currentModel, active),
    };
  }

  private async requireProfile(profileId: string): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    return profile;
  }

  private async resolveProfileTools(
    profile: StoredProfileRecord,
    options: { includeAutomationTools?: boolean; includeTodoTools?: boolean } = {},
  ): Promise<ToolDefinition[]> {
    const storedTools = await this.db.listToolsForProfile(profile.id);
    const tools = await resolveToolsFromStorage(storedTools);
    const includeAutomationTools = options.includeAutomationTools ?? true;
    const includeTodoTools = options.includeTodoTools ?? true;

    let resolved = [...tools];

    if (this.mcpClientManager) {
      const mcpServers = await this.db.listMcpServersForProfile(profile.id);
      resolved = [
        ...resolved,
        ...buildMcpToolDefinitions(mcpServers, this.mcpClientManager, profile.id),
      ];
    }

    if (includeAutomationTools && this.automationTools.length > 0) {
      resolved = [...resolved, ...this.automationTools];
    }

    if (includeTodoTools && this.todoTools.length > 0) {
      resolved = [...resolved, ...this.todoTools];
    }

    if (profile.isSuper) {
      resolved = [...resolved, ...this.superBotTools];
    }

    return resolved;
  }

  private async buildChatSession(
    channel: AgentChannel,
    profileId: string,
    sessionId: string,
  ): Promise<AgentChatSession> {
    const profile = await this.requireProfile(profileId);
    const tools = await this.resolveProfileTools(profile);
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      profileId,
      profile.systemPrompt,
    );
    const resolvedSystemPrompt = profile.isSuper
      ? `${systemPrompt.trim()}\n\n${SUPER_BOT_TOOL_AUTHORING_RULES}`
      : systemPrompt;
    const initialHistory = await loadSessionHistory(this.db, sessionId);
    const userTimezone = await this.getUserTimezone();
    const userContext = await loadUserContext();
    const compaction = this.resolveCompactionConfig(profile);

    const session = this.harness.createChatSession({
      channel,
      tools,
      systemPrompt: resolvedSystemPrompt,
      userContext,
      enableToolLoop: true,
      soul: soulActive,
      initialHistory,
      userTimezone,
      compaction,
      toolContext: {
        profileId,
        sessionId,
      },
      resolvePromptContext: () => this.agentTodoState.formatForPrompt(sessionId),
    });

    return wrapPersistedSession(sessionId, session, this.db, {
      onBeginTurn: (id) => this.superBotSessionState.beginTurn(id),
    });
  }

  private async resolveProfileSystemPrompt(
    profileId: string,
    profilePrompt: string,
  ): Promise<{ systemPrompt: string; soulActive: boolean }> {
    const stack = await resolveSoulStackForProfile(profileId);

    if (!stack) {
      return { systemPrompt: profilePrompt, soulActive: false };
    }

    return {
      systemPrompt: composeSoulSystemPrompt(stack, { profilePrompt }),
      soulActive: true,
    };
  }

  private resolveCompactionConfig(
    profile: StoredProfileRecord,
  ): CompactionConfig | undefined {
    if (!this.userConfig) {
      return undefined;
    }

    const active = getActiveProviderInstance(this.userConfig);

    if (!active) {
      return undefined;
    }

    const modelId = resolveModel(
      active.type,
      profile.model ?? this.userConfig.defaultModel ?? "",
      active.customModels,
    );
    const model = getModelById(modelId);

    if (!model) {
      return undefined;
    }

    return {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    };
  }
}

function parseAgentChannel(value: string): AgentChannel | null {
  if (value === "cli" || value === "web" || value === "telegram" || value === "automation") {
    return value;
  }

  return null;
}


